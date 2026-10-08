#!/bin/bash
set -u
cd "$(dirname "$0")/.."
require_test() {
  local bug_id="$1"
  local package="$2"
  local test_name="$3"
  local test_file="$4"

  if ! grep -q "func ${test_name}(" "$test_file"; then
    echo "  FAIL [$bug_id]: required test $test_name is missing from $test_file" >&2
    return 1
  fi
  go -C apps/api-go test -count=1 -run "^${test_name}$" "$package" || return $?
  echo "    $bug_id: PASS ($test_name)"
}
# NOTIF-PIPELINE-001（2026-10-01，用户「有问题就解决 建立统一的通知管线」）：
# 通知只有**一条**写入管线，两个生产者（outbox worker 与 SendInboxNotification 命令）
# 都经过 notification.Pipeline.Emit。
#
# 改之前这个域有两条互不相干、各做一半的写路径：
#   · worker（cmd/worker/main.go 的 businessInboxDelivery）自己拼 SQL 直连
#     notification.inbox_items 落库 —— 现网 845 行真数据**全部**来自它 ——
#     但**从来不推送**（PushProvider 在那条路上根本不存在）。
#   · 命令 sendInbox 有推送、有 Repository，但用**随机 item id** ⇒ 不幂等，
#     而且 App 侧零调用。
# 合起来看：真实事件一条推送都没发过，而两条路径各自看起来都是对的。
# 更隐蔽的是它们会**各自漂移** —— 「重复投递算不算一条」两边答案相反。
#
# ⚠️ 本脚本不剥注释，所以反向臂全部走 `_notif_code_lines`：它把以 // 、* 、/*
#    开头的行滤掉再看。这不是洁癖 —— 上面那段注释本身就在引用被删掉的
#    旧 SQL（那是这条钉存在的理由），不滤的话钉会被自己的说明文档喂红。
#    正因如此，这里**只查代码行**；「注释里的说明」不构成违规。
_notif_code_lines() {
  # grep -n 先给每行加行号，第二条 grep 才能用「行首是不是注释起始」判断。
  grep -n '^' "$1" 2>/dev/null | grep -vE '^[0-9]+:[[:space:]]*(//|\*|/\*)' || true
}
NOTIF_WORKER=apps/api-go/cmd/worker/main.go
NOTIF_SERVICE=apps/api-go/internal/notification/service.go
NOTIF_PIPELINE=apps/api-go/internal/notification/pipeline.go
NOTIF_PG_REPO=apps/api-go/internal/platform/postgres/notification.go
if [ -f "$NOTIF_WORKER" ] && [ -f "$NOTIF_SERVICE" ] && [ -f "$NOTIF_PIPELINE" ]; then
  # ---- 正向臂：两个生产者都接到管线上 ----
  if ! grep -qF 'producer.Emit(ctx, notification.Notification{' "$NOTIF_WORKER"; then
    echo "  FAIL [NOTIF-PIPELINE-001]: worker 不再经过统一管线写通知 ——" >&2
    echo "        它一旦自己写 SQL，推送就又只剩命令那半知道（真实事件静默）。" >&2
    exit 1
  fi
  if ! grep -qF 'notification.EventDedupeKey(e.EventID)' "$NOTIF_WORKER"; then
    echo "  FAIL [NOTIF-PIPELINE-001]: worker 丢了事件的幂等键 ——" >&2
    echo "        outbox 会重放整批，没有它重放就是用户 inbox 里的第二条「订单已成立」。" >&2
    exit 1
  fi
  if ! grep -qF 'notification.NewPipeline(' "$NOTIF_WORKER"; then
    echo "  FAIL [NOTIF-PIPELINE-001]: worker 没有建管线（推送通道在 worker 侧不存在了）。" >&2
    exit 1
  fi
  if ! grep -qF 'notification.PushProviderFromEnv(os.Getenv)' "$NOTIF_WORKER"; then
    echo "  FAIL [NOTIF-PIPELINE-001]: worker 不再用与 API 同一个推送通道判定 ——" >&2
    echo "        两边各判一次就会出现「API 认为推送开着、worker 认为关着」这种看不见的分叉。" >&2
    exit 1
  fi
  if ! grep -qF 's.pipeline.Emit(ctx, Notification{' "$NOTIF_SERVICE"; then
    echo "  FAIL [NOTIF-PIPELINE-001]: sendInbox 不再走管线（命令侧又变回第二条写路径）。" >&2
    exit 1
  fi
  # 用 [[:space:]]* 而不是写死空格：gofmt 会按最长的字段名重新填充整段，
  # 写死空格的钉会在一次无关的格式化后突然变红（SAFETY-GATE-001 踩过）。
  if ! grep -qE 'DedupeKey:[[:space:]]*CommandDedupeKey\(dedupe\),' "$NOTIF_SERVICE"; then
    echo "  FAIL [NOTIF-PIPELINE-001]: 命令侧丢了幂等键 ——" >&2
    echo "        重试一次就多一行（对超时重发很常见的后台口来说那是必然发生的）。" >&2
    exit 1
  fi
  if ! grep -qF 'func (p *Pipeline) Emit(ctx context.Context, n Notification) (InboxItem, bool, error) {' "$NOTIF_PIPELINE"; then
    echo "  FAIL [NOTIF-PIPELINE-001]: 管线唯一的写入口 Emit 的签名变了。" >&2
    exit 1
  fi
  if ! grep -qF 'return tag.RowsAffected() == 1, nil' "$NOTIF_PG_REPO"; then
    echo "  FAIL [NOTIF-PIPELINE-001]: PG 的 inbox 写入不再回答「这次插没插进去」——" >&2
    echo "        管线靠它决定推不推送，写死 true 会让重放也推（用户收到两条一样的）。" >&2
    exit 1
  fi
  if ! grep -qF 'ON CONFLICT (id) DO NOTHING' "$NOTIF_PG_REPO"; then
    echo "  FAIL [NOTIF-PIPELINE-001]: PG 的 inbox 写入丢了 ON CONFLICT —— 幂等没了。" >&2
    exit 1
  fi

  # ---- 反向臂：第二条写路径不许回来 ----
  if _notif_code_lines "$NOTIF_WORKER" | grep -qF 'INSERT INTO notification.inbox_items'; then
    echo "  FAIL [NOTIF-PIPELINE-001]: worker 又在自己写 SQL 落库了 ——" >&2
    echo "        那条路不推送。请把映射结果交给 notification.Producer。" >&2
    exit 1
  fi
  if [ -f apps/api-go/internal/notification/orchestrator.go ]; then
    echo "  FAIL [NOTIF-PIPELINE-001]: notification.Orchestrator 又回来了 ——" >&2
    echo "        它是第三套重叠的去重（另两套是 inbox.processed_events 和 item 主键），" >&2
    echo "        而且 seen map 无上限、进程活得越久越大。别把它接上，直接删。" >&2
    exit 1
  fi
  if _notif_code_lines "$NOTIF_SERVICE" | grep -qF 'CreateInboxItem('; then
    echo "  FAIL [NOTIF-PIPELINE-001]: 无脑 INSERT 的 CreateInboxItem 又回来了 ——" >&2
    echo "        Repository 的 inbox 写侧只该有 InsertInboxItemOnce（它回答 created）。" >&2
    exit 1
  fi
  # 不写死单行形式：gofmt 会把 `if push == nil { push = LogPushProvider{} }`
  # 拆成多行，写死单行的话多行版重引入就抓不到了。
  if _notif_code_lines "$NOTIF_SERVICE" | grep -qE 'push = LogPushProvider\{\}'; then
    echo "  FAIL [NOTIF-PIPELINE-001]: NewWithPushProvider 又开始把 nil 兜成 LogPushProvider ——" >&2
    echo "        那样 NOTIFICATION_PUSH=off 就是个空开关（曾经真的空转过）。" >&2
    exit 1
  fi

  # ---- 行为臂：幂等与「只有新增才推送」在 Go 侧断言（注释已剥） ----
  require_test "NOTIF-PIPELINE-001" "./internal/notification" \
    "TestPipelineEmitWritesOneRowAndPushesOnce" \
    "apps/api-go/internal/notification/pipeline_test.go" || exit $?
  require_test "NOTIF-PIPELINE-001" "./internal/notification" \
    "TestPipelineEmitIsIdempotentByDedupeKey" \
    "apps/api-go/internal/notification/pipeline_test.go" || exit $?
  require_test "NOTIF-PIPELINE-001" "./internal/notification" \
    "TestPipelineEmitRejectsIncompleteNotifications" \
    "apps/api-go/internal/notification/pipeline_test.go" || exit $?
  require_test "NOTIF-PIPELINE-001" "./internal/notification" \
    "TestNewWithPushProviderHonoursExplicitNil" \
    "apps/api-go/internal/notification/pipeline_test.go" || exit $?
  require_test "NOTIF-PIPELINE-001" "./internal/notification" \
    "TestSendInboxIsIdempotentPerIdempotencyKey" \
    "apps/api-go/internal/notification/pipeline_test.go" || exit $?
  # 接线臂：映射对了但没接上管线，用户依然收不到推送 —— 而那种回归在
  # inboxForEvent 的单测里完全看不见（函数本身仍然全绿）。
  require_test "NOTIF-PIPELINE-001" "./cmd/worker" \
    "TestWorkerDeliveryGoesThroughPipeline" \
    "apps/api-go/cmd/worker/main_test.go" || exit $?
  # SQL 臂：内存仓的幂等是 map 查询，PG 的是 ON CONFLICT + RowsAffected，
  # 两个实现的失败方式完全不同（后者写错是抛 duplicate key）。
  require_test "NOTIF-PIPELINE-001" "./internal/platform/postgres" \
    "TestNotificationInboxInsertIsIdempotent" \
    "apps/api-go/internal/platform/postgres/notification_integration_test.go" || exit $?
  echo "    NOTIF-PIPELINE-001: PASS (通知只有一条管线：worker 与命令都走 Pipeline.Emit，幂等 + 只有新增才推送)"
fi
