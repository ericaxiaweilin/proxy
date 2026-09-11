# PR Summary: fix/engagement-constraint-map (R16.12)

engagement 写路径约束违例 → 业务码映射。审计发现的 P1 修复。

## 缺陷（audit 2026-09-03 实证）

对同一帖文重复点赞、或对不存在的帖文点赞，API 返回 **500
command_transaction_failed**，而不是业务拒绝。

根因链（三层叠加）：

1. `engagement.reactions` 有 `UNIQUE(post_id, actor_id)` + `FK(post_id →
   localnet.posts)`；冲突时 pgx 返 23505 / 23503。
2. `postgres/network.go` 的 `AddReaction/AddReply/AddRepost/AddBookmark`
   把原始错误直接上抛——外层 command dispatch 事务已被这条失败的 INSERT
   **毒死**（进入 aborted 状态）。
3. `command_dispatch.go executeCommand` 在**同一事务**里调
   `Idempotency.Complete` 写幂等记录 → 撞 25P02（transaction is
   aborted）→ `executeCommand` 返 err → 500 吞掉 service 层本该返回的
   REJECTED。

用户可见影响：换设备/重登后再点同一帖 →「互动没有提交成功，请检查连接后重试」——
误导性提示，实为服务端缺陷。repost / bookmark / reply 同类。

## 修复

对齐两个既有先例：PinPost 的幂等返回（R15.56）+ fulfillment 的
`isUniqueViolation` → domain error 映射。

### engagement/service.go
- 新增域哨兵错误：`ErrReactionAlreadyExists` / `ErrRepostAlreadyExists` /
  `ErrBookmarkAlreadyExists` / `ErrPostNotFound`。
- `react/repost/bookmark/reply` 四个 handler 识别哨兵 → 业务码：
  - dup → `ALREADY_REACTED` / `ALREADY_REPOSTED` / `ALREADY_BOOKMARKED`
    （BUSINESS_STATE, AFTER_USER_ACTION）
  - ghost post → `POST_NOT_FOUND`
- `MemoryRepository.Add{Reaction,Repost,Bookmark}` 按 (post, actor) 查重，
  与 PG 仓语义对齐（测试路径与真实路径产出相同业务码）。

### postgres/network.go
- 新增 `insertEngagementRow` helper：**SAVEPOINT 包住 INSERT**。违例时
  `ROLLBACK TO SAVEPOINT` 救活外层事务（幂等记录能落库），同时把
  pgconn.PgError 翻译成域哨兵：
  - 23505 → alreadyExistsErr（调用方指定）
  - 23503 → `engagement.ErrPostNotFound`
- `AddReaction/AddReply/AddRepost/AddBookmark` 全部走该 helper。

## 验证（真实执行）

1. `go build ./...` 通过；`go vet` 干净。
2. `go test -count=1 ./...` 34 包全绿（含新增 5 个用例：
   dup-like / ghost-like / dup-repost / ghost-repost / dup-bookmark +
   ghost-bookmark）。
3. **e2e 复现**：worktree 构建产物起 API（:4199，同一 dev 库 74
   migrations up-to-date），跑 /tmp/e2e_proxy_audit.py：
   - 重复点赞：500 → **409 ALREADY_REACTED**
   - 不存在帖文：500 → **409 POST_NOT_FOUND**
   - 14/14 断言 PASS（含对话链回归：Start/Send/List/MarkRead/inbox 全通）
4. **幂等落库铁证**（修复前正是这一步 25P02 炸掉）：
   `integration.idempotency_records` 中 dup-like 记录 =
   `status=COMPLETED, outcome=REJECTED, errorCode=ALREADY_REACTED,
   completed_at IS NOT NULL`。
5. 测试数据已清理（conversations/messages/reactions 归零，
   post_stats 计数 trigger 同步归零），4199 进程已停。

## 风险与兼容

- 409 由 statusFor(REJECTED) 全局映射产生（conversation 域
  CONVERSATION_NOT_FOUND 同模式），无新增 HTTP 语义。
- mobile 客户端 `commitEngagement` 已对 REJECTED 走 mapEngagementError
  通用错误路径，无需客户端改动。
- MemoryRepository 语义变化：同 (post,actor) 二次写入从静默成功变为返
  哨兵错误——与真实 PG 行为一致，属测试语义修正。
- SAVEPOINT 只包单条 INSERT，嵌套安全（随机 token），非事务上下文退化为
  直接 Exec（保留旧行为）。
