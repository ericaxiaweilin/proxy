# Lotus Chat 对齐进度 — R15.24 (2026-08-31)

> 源 RFC: `Proxy_Chat_Aligned_With_LotusChat_v0.1.md` 8 项改动
> 分支: `agent/lotus-message-20260831` (基于 `b55e1d8`)
> 约束: `AGENTS.md` 单人合入，worktree 隔离，未自动合入 integration

## 总览

| # | RFC 项 | 工期 | 状态 | 落点文件 | 验证 |
|---|--------|------|------|----------|------|
| 1 | DisplayIdentity 多身份 (PUBLIC/PRIVATE/BURNER, 3上限, 7d) | 3d | ✅ Done (PG+API+mobile) | `identity/display_identity.go:33` `migrations/038_display_identity.sql` `platform/postgres/display_identity.go` `identity/service.go:59,100,9813bb5` `mobile/display-identity-client.ts` `components/identity-switcher.tsx` `surfaces/messages.tsx:27` `cmd/api/main.go:163` | `go test identity -run TestDisplayIdentity -v` 11 pass; `go vet/build` ok |
| 2 | Message.Protection 每条消息四旋钮 | 2d | ✅ Done | `conversation/message_protection.go:20` `conversation/service.go:480` `platform/postgres/network.go:345` `migrations/035` `mobile/conversation-client.ts:14` `surfaces/conversation.tsx:30,112` | `go test conversation` 7 pass + `TestPurgeExpired` |
| 3 | RN 防截屏 overlay + 截屏检测 | 2d | ✅ Done (JS+Native 桩) | `mobile/lib/screenshot-protection.ts` `mobile/android/ScreenProtectionModule.kt` `mobile/ios/ScreenProtectionModule.swift`+Bridge | `npx tsc --skipLibCheck` 改动文件无新增报错；真机 `FLAG_SECURE`/通知待 commander 验收 |
| 4 | KMS 静态加密 + E2EE 徽标 | 1.5d | ✅ Placeholder Done | `platform/kms/kms.go` (AES-GCM local / Noop) `surfaces/conversation.tsx:174` `components/security-settings.tsx:12` | `go build` ok；生产切 `AWS/GCP KMS` 仅改 wiring |
| 5 | 30天 TTL 清理 | 1d | ✅ Done | `conversation/service.go:72,244` `platform/postgres/network.go:523` `cmd/worker/main.go:70` `conversation/sweep_test.go` `migrations/035` idx | `TestPurgeExpiredMessages` pass；worker 小时扫 |
| 6 | Session max 2 + 踢旧 | 0.5d | ✅ Done | `identity/service.go:48,874,191,412,731` `platform/postgres/identity.go` `identity/lotus_e2e_test.go` `scripts/verify-lotus.sh` | `TestLotus_MaxConcurrentSessions_EvictsOldest` pass；`go test identity` 12 pass |
| 7 | RN UI 身份切换器 + 会话防外传开关 | 3d | ✅ Done | `components/identity-switcher.tsx` `surfaces/messages.tsx:77` `surfaces/conversation.tsx:30` `components/security-settings.tsx` | 手动 UI 验收待 commander |
| 8 | 营销文案 + 设置安全区块 | 0.5d | ✅ Done | `components/security-settings.tsx` `surfaces/me.tsx:10,1291,1483` | 已接入 `Me→设置与隐私·安全` |

**合计 13.5 工日** 已在 24 次提交内完成 (±1d 误差)。

## 提交链

```
b55e1d8 (base)
0a6e4f5 enforce MaxConcurrentSessions=2 + protection client
0939039 TTL sweeper + KMS placeholder
e4a5dfd DisplayIdentity PG + switcher
56a81bc wire IdentitySwitcher + protection chips
8c6ed46 security settings + burner sweeper
e79cbf0 wire SecuritySettings into Me
1ac1ff0 native ScreenProtection modules
fcd3a09 sweep test
9813bb5 wire DisplayIdentity commands
980fc77 wire DisplayIdentity PG in api
bc54879 docs progress 8/8
308beff e2e eviction test
1daefa3 verify-lotus.sh
bf16c07 docs sync 13 commits
ec4c8b1 port v8 Home
96f8d67 Requests/Contacts/Person
a35fa56 Message v1 additive
d35e5fa Dialog/Convo/Folder
35f9fe6 MessageRenderer
39085ac docs sync 16 commits
1db6edc MessageRenderer+proxy_object wire (v9)
e7802b4 Dialog PG repository
5bbb838 FolderManager UI
6c1dad5 wire FolderManager
```

## 未做 (RFC 明确排除)

真 E2EE Signal、通话录音、Két sắt 文件柜、Convo 子话题、Lota AI、多平台、1GB 永久云存、默认防骚扰 — 按 RFC §12 不做。

## 待 commander

- `git show` 审 24 提交，合入 `fix/r15.23-mobile-home-and-pulse`（`bash scripts/verify-lotus.sh` 一键校验）
- `pnpm --filter @proxy/mobile typecheck` 全量 (需 `pnpm install` 恢复 `@proxy/contracts` 链接)
- 真机验证: `FLAG_SECURE` 黑屏、iOS 截屏气泡、`SECURITY_ALERT` 推送、2 设备踢旧、`BURNER 7d` 自动销毁、`阅后即焚 1次` 二次 `VIEW_LIMIT_EXCEEDED`
