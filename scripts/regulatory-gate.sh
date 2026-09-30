#!/usr/bin/env bash
# regulatory-gate.sh — 越南 2026 法务 P0 门槛的**一键**核实。
#
# 存在的理由：R16.7 的 P0 清单（docs/compliance/R16.7-LEGAL-COMPLIANCE-PLAN.md）里
# 每一条都对应一个 e2e 脚本，但它们散在 scripts/ 下、命名不成体系（lc06 / lc28 /
# p1e / l16.7 / legal / privacy / location-consent / benefit / kill-switch），
# 而且**全都需要一个活的 API**（127.0.0.1:4100）。没人记得跑，于是「LC-28 免费单盖章」
# 这类阻断性回归可以静悄悄地活很久 —— 2026-09-30 就发现过：迁移 146 撤掉
# policy_decisions 的 UPDATE 权限后，外键检查所需的 FOR KEY SHARE 锁拿不到，
# 于是**每一张 PLATFORM_PAY 订单都无法确认**，接口只回
# {"error":"command_transaction_failed"}（一个不指向任何东西的字符串）。
#
# 这个脚本做两件事：
#   1. 确认 API 活着并已应用全部迁移（迁移漂移 = 未验证）；
#   2. 逐个跑 P0 对应的 e2e，任何一个红就整体红。
#
# 只读性质：这些 e2e 自己创建匿名账号 / 自己的订单，不碰生产或他人数据。
# 用法：bash scripts/regulatory-gate.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
BASE="${PROXY_API_BASE:-http://127.0.0.1:4100}"
export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"

pass=0; fail=0; skip=0
declare -a failed_names=()

note()  { printf '  %s\n' "$*"; }
ok()    { printf '  \033[32mPASS\033[0m  %s\n' "$*"; pass=$((pass+1)); }
bad()   { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; fail=$((fail+1)); failed_names+=("$*"); }
skipt() { printf '  \033[33mSKIP\033[0m  %s\n' "$*"; skip=$((skip+1)); }

run_suite() {
  local script="$1" name="$2"
  [[ -f "scripts/$script" ]] || { skipt "${name}（scripts/$script 不存在）"; return; }
  local log; log="$(mktemp)"
  if bash "scripts/$script" >"$log" 2>&1; then
    ok "$name"
  else
    bad "$name —— $(tail -n 3 "$log" | tr '\n' ' ' | cut -c1-150)"
  fi
  rm -f "$log"
}

echo "======================================================================"
echo "Regulatory gate — 越南 2026 法务 P0"
echo "  baseline: docs/compliance/R16.7-LEGAL-COMPLIANCE-PLAN.md"
echo "======================================================================"

# ── 0. 前置：API 活着 + 迁移已应用 ─────────────────────────────────────────
health=$(curl --noproxy '*' -s -o /dev/null -m 5 -w '%{http_code}' "${BASE}/health/live" 2>/dev/null || echo 000)
if [[ "$health" != "200" ]]; then
  echo
  echo "  \033[31mABORT\033[0m API 不在 ${BASE}（health=${health}）。"
  echo "        这些 e2e 全部需要一个活的 API；先把它起起来："
  echo "          launchctl kickstart -k gui/\$(id -u)/com.user.kake-dev-api"
  echo "        （或 pnpm --filter @proxy/mobile ios 那一侧的 dev-api）"
  exit 69
fi
ok "API 活着（${BASE}）"

# 迁移漂移 = 用旧 schema 跑出来的绿不可信。迁移文件比库里记录的多就是漂移。
newest_file=$(ls apps/api-go/migrations/*.sql 2>/dev/null | sed 's#.*/##' | sort | tail -1)
if [[ -n "$newest_file" ]]; then
  applied=$(psql "$(grep -o '^DATABASE_URL=.*' .env 2>/dev/null | sed 's/^DATABASE_URL=//')" -tAc \
    'SELECT max(version) FROM public.schema_migrations' 2>/dev/null || echo "")
  # 文件名带 .sql 后缀，schema_migrations.version 不带 —— 先剥再比，
  # 否则两边明明同一个版本也会被判成漂移（我第一次写就踩了这个）。
  newest_ver="${newest_file%.sql}"
  if [[ -n "$applied" && "$applied" != "$newest_ver" ]]; then
    bad "迁移漂移：最新文件 ${newest_file}，库里只到 ${applied:-<无记录>} —— 用旧 schema 验法务是不可信的"
  elif [[ -n "$applied" ]]; then
    ok "迁移已应用（${applied}）"
  else
    skipt "迁移状态未知（读不到 DATABASE_URL 或迁移表）"
  fi
fi

echo
echo "-- P0 门槛 --"

# ── 1. 文本与同意 ─────────────────────────────────────────────────────────
run_suite legal-e2e.sh               "LC-07/08 Terms & Privacy 版本化可取（只读）"
run_suite privacy-e2e.sh             "LC-15 隐私请求中心：导出/删除/撤回/跨用户隔离"

# ── 2. 年龄与辖区（LC-12 / LC-28 / LC-30 的前置）──────────────────────────
run_suite p1e-jurisdiction-e2e.sh    "LC-28/30 换辖区 → PLATFORM_PAY 必须产出不同决策 id"
run_suite lc28-policy-decision-e2e.sh "LC-28/30 付费单盖章：复用决策 + 变更重新评估 + 审计"
run_suite location-consent-e2e.sh    "精确位置同意：有效期上限 / 撤销 / 跨用户隔离"

# ── 3. 治理开关 ───────────────────────────────────────────────────────────
run_suite kill-switch-e2e.sh         "全局 kill switch 可用且对未授权操作者关闭"
run_suite benefit-eligibility-e2e.sh "权益核销：未知活动/未知券必须拒绝（不可静默通过）"

# ── 4. 需要接单权限的 AI 分身（ORDER-PERMISSION-TWIN-001）─────────────────
# 这条**预期可能红**：脚本直接建 USER_TWIN，而数字分身只对有接单权限的人开。
# 那是正确的门禁（order_permission_required），红的是**测试前置条件没跟上**，
# 不是产品缺陷。要绿需先给测试账号走 providerapp Submit + Review(approve)。
# lc06 需要一个管理员 DB 句柄来 seed 一份「已通过的接单申请」（数字分身只对有接单
# 权限的人开，ORDER-PERMISSION-TWIN-001）。2026-09-30 另一路已经把脚本改成自己 seed，
# 并要求 PROXY_E2E_ADMIN_PSQL —— 所以它现在**能跑**，只是缺环境变量。
#
# 这里不把「缺环境变量」报成 P0 红项（那会把每个没配变量的开发者卡在门外），但也
# **不静默 PASS** —— 明确告诉人要配什么。
# 该句柄的正确来源是 scripts/e2e-isolated.sh —— 它会起隔离库、生成
# $WORK/fixture-psql.sh 并 export PROXY_E2E_ADMIN_PSQL（2026-09-30 另一路加的）。
# 所以**不要**让用户手搓 psql 命令行；要么已经跑过 e2e-isolated（变量在环境里），
# 要么直接用 `bash scripts/e2e-isolated.sh` 跑整套。
lc06_env="${PROXY_E2E_ADMIN_PSQL:-}"
if [[ -z "$lc06_env" ]]; then
  skipt "AI 分身（lc06）需 PROXY_E2E_ADMIN_PSQL（只用于 seed 已通过的接单申请 —— 审核接口要 operator 身份，而套件的用户 id 是运行时生成的，配不进去）。用 bash scripts/e2e-isolated.sh 跑，它会生成这个句柄"
elif [[ ! -x "$lc06_env" ]]; then
  bad "AI 分身（lc06）：PROXY_E2E_ADMIN_PSQL 指向 ${lc06_env}，但它不可执行 —— fixture 句柄坏了，跑出来的红不可信"
else
  run_suite lc06-ai-media-e2e.sh     "AI 分身与肖像授权"
fi

echo
echo "======================================================================"
printf 'REGULATORY GATE: %d PASS / %d FAIL / %d SKIP\n' "$pass" "$fail" "$skip"
if (( fail > 0 )); then
  echo
  echo "  红项："
  for n in "${failed_names[@]}"; do echo "    - $n"; done
  echo
  echo "  任一 P0 红项都是上线阻断（越南 2026-07-01 已生效）。别改门禁让它绿 ——"
  echo "  找到根因修掉，或确认这是环境问题后再更新本脚本。"
fi
echo "======================================================================"
exit $(( fail > 0 ? 1 : 0 ))
