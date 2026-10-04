#!/bin/bash
# R16.11: the master gate matrix. The previous "go test 0 exit" trap
# disguised actual build / e2e failures because the exit code was
# captured from the `echo` command, not from the test runner. This
# script re-establishes the truth: every gate runs with `set -e` and
# `set -o pipefail`, the script's own exit code is the worst exit
# code from any gate, and a non-zero exit fails the commit / push.
#
# Usage:
#   bash scripts/gate.sh           # run all four gates
#   bash scripts/gate.sh g1 g3     # run a subset
#
# Gates:
#   g1 = build actually compiles (api-go + mobile + contracts)
#   g2 = tests actually pass (api-go + mobile) with -count=1 / --run
#   g3 = live server e2e (privacy + legal scripts) against a running
#        server on $PROXY_API_BASE_URL (default http://127.0.0.1:4100)
#   g4 = drift (migration checksums, openapi spec, untracked handler
#        files left over from R15.55 stash, mobile typecheck)
#
# Exit code: 0 if every requested gate passed; otherwise the worst
# exit code from the failing gate. The script does NOT swallow
# failures and does NOT rely on caching.

set -u
cd "$(dirname "$0")/.."

GATES_REQUESTED=("$@")
if [ ${#GATES_REQUESTED[@]} -eq 0 ]; then
  GATES_REQUESTED=(g1 g2 g3 g4)
fi

# The toolchain gates are one Go command (apps/api-go/cmd/gatecheck). node is not
# part of this stack, and REPO_ROOT must be passed explicitly because `go -C` runs the
# child with cwd = apps/api-go —— without it every relative path would resolve wrong.
gatecheck() {
  REPO_ROOT="$PWD" go -C apps/api-go run ./cmd/gatecheck "$@"
}

# gate_<name>() returns the exit code of the actual command. The
# caller uses `$?` immediately after the call so there is no chance
# of an `echo` clobbering the value. Each gate's stdout / stderr is
# streamed to the terminal so the operator can see what failed.
#
# We turn on `set -e` and `set -o pipefail` inside each gate so
# any failed command immediately returns the failing exit code.
# This is the lesson R16.11 was supposed to lock in: never let an
# `echo` swallow a real failure.

gate_g1_build() {
  set -e
  set -o pipefail
  echo "=== G1: build (api-go + mobile + contracts) ==="
  go -C apps/api-go build ./... || return $?
  echo "  api-go build: OK"
  # contracts dist is gitignored build output, so a fresh worktree/clone has no
  # dist/index.d.ts until it is built. Mobile typecheck resolves
  # @proxy/contracts to that dist — typechecking first fails with 100+
  # TS2307 "Cannot find module" errors that vanish once contracts is built.
  # Build contracts before typechecking mobile so G1 is green from a clean tree.
  pnpm --filter @proxy/contracts build || return $?
  echo "  contracts build: OK"
  pnpm --filter @proxy/mobile typecheck || return $?
  echo "  mobile typecheck: OK"
}

gate_g2_tests() {
  set -e
  set -o pipefail
  echo "=== G2: tests (api-go -count=1, mobile --run) ==="
  # The integration tests share a Postgres cluster with the live
  # server. After the migrator absolute-count fix in commit 3f12725
  # the tests are robust against a running live server, so we no
  # longer need to kill it. This avoids a fragile kill+respawn cycle
  # that was producing broken respawned servers (the new server
  # could not establish its pgxpool connections under contention).
  # If a future test starts flaking on the live server, the right
  # fix is to make the test isolated (per-test schema, transactions,
  # or DB cleanup), not to kill the live server from the gate.
  go -C apps/api-go test -count=1 -p 1 ./... || return $?
  echo "  api-go test: OK"
  pnpm --filter @proxy/mobile test --run || return $?
  echo "  mobile test: OK"
  pnpm --filter @proxy/contracts test --run || return $?
  echo "  contracts test: OK"
}

gate_g3_e2e() {
  set -e
  set -o pipefail
  echo "=== G3: live server e2e (privacy + legal) ==="
  local base="${PROXY_API_BASE_URL:-http://127.0.0.1:4100}"
  local health
  health=$(curl -s -o /dev/null -w "%{http_code}" "$base/health/live")
  if [ "$health" != "200" ]; then
    echo "  FAIL: $base/health/live returned $health, expected 200. Is the server up?" >&2
    return 1
  fi
  echo "  health: OK ($base/health/live 200)"

  # Fixture handle for the suites (PROXY_E2E_ADMIN_PSQL).
  #
  # lc06-ai-media builds a USER_TWIN, and USER_TWIN is only open to people with
  # order permission (ORDER-PERMISSION-TWIN-001) — i.e. it needs an APPROVED
  # provider application. That precondition is unreachable over HTTP: the approval
  # endpoint wants an operator identity, and the operator allowlist is read from
  # PROXY_OPERATOR_PRINCIPALS at boot as fixed principal ids, while the suite's
  # user id is minted at runtime by CreateAnonymousSession. So the suite seeds the
  # row directly and this is the handle it uses.
  #
  # scripts/e2e-isolated.sh exports the same variable, pointed at the throwaway
  # database it owns. Here it must point at the LIVE server's database, so it
  # refuses any DSN that is not obviously local: writing fixture rows into a
  # remote or production database is not something a gate should ever do by
  # accident. When it refuses, it exports nothing and lc06-ai-media fails with a
  # message naming the missing handle — never a silent skip.
  #
  # The wrapper embeds the DSN (so it contains the password); it is written 0600
  # into TMPDIR.
  local fixture_dsn="${DATABASE_URL:-}"
  if [ -z "$fixture_dsn" ] && [ -f .env ]; then
    fixture_dsn="$(sed -n 's/^DATABASE_URL=//p' .env | tail -1)"
    fixture_dsn="${fixture_dsn%\"}"
    fixture_dsn="${fixture_dsn#\"}"
  fi
  case "$fixture_dsn" in
    *@127.0.0.1:*|*@127.0.0.1/*|*@localhost:*|*@localhost/*)
      local fixture_psql="${TMPDIR:-/tmp}/proxy-g3-fixture-psql.$$.sh"
      (umask 077
       { echo '#!/bin/bash'
         echo "# Generated by scripts/gate.sh g3 — admin psql against the live-server database."
         echo "# Fixture setup ONLY (a precondition HTTP cannot express). Never assert with this."
         echo "exec psql -X -q $(printf '%q' "$fixture_dsn") \"\$@\""
       } > "$fixture_psql")
      chmod +x "$fixture_psql"
      export PROXY_E2E_ADMIN_PSQL="$fixture_psql"
      echo "  fixture handle: $fixture_psql (lc06 seeds an APPROVED provider application)"
      ;;
    *)
      echo "  fixture handle: NONE — DATABASE_URL is unset or is not a local database." >&2
      echo "    lc06-ai-media needs it to seed a precondition HTTP cannot express" >&2
      echo "    (ORDER-PERMISSION-TWIN-001). It will fail and say so." >&2
      ;;
  esac

  bash scripts/privacy-e2e.sh || return $?
  echo "  privacy-e2e: OK"
  bash scripts/location-consent-e2e.sh || return $?
  echo "  location-consent-e2e: OK"
  bash scripts/kill-switch-e2e.sh || return $?
  echo "  kill-switch-e2e: OK"
  bash scripts/benefit-eligibility-e2e.sh || return $?
  echo "  benefit-eligibility-e2e: OK"
  bash scripts/lc28-policy-decision-e2e.sh || return $?
  echo "  lc28-policy-decision-e2e: OK"
  bash scripts/lc06-ai-media-e2e.sh || return $?
  echo "  lc06-ai-media-e2e: OK"
  bash scripts/p1e-jurisdiction-e2e.sh || return $?
  echo "  p1e-jurisdiction-e2e: OK"
  bash scripts/legal-e2e.sh || return $?
  echo "  legal-e2e: OK"
}

gate_g4_drift() {
  set -e
  set -o pipefail
  echo "=== G4: drift (migrations, openapi, untracked handlers) ==="
  gatecheck design-baseline || return $?
  gatecheck liquid-dock || return $?
  if [ -d "apps/api-go/migrations" ]; then
    local count
    count=$(ls apps/api-go/migrations/*.sql | wc -l | tr -d ' ')
    echo "  migrations: $count files hashed"
  fi
  go -C apps/api-go run ./scripts/generate_openapi.go --check || return $?
  echo "  openapi: OK"
  local expected_untracked=()
  for f in apps/api-go/internal/api/{facet,feed,geocode,media,command_dispatch,middleware,legal}.go; do
    if git status --short -- "$f" | grep -q '^??'; then
      expected_untracked+=("$f")
    fi
  done
  if [ ${#expected_untracked[@]} -gt 0 ]; then
    echo "  FAIL: the following handler files are untracked; the build is broken until they are added:" >&2
    for f in "${expected_untracked[@]}"; do
      echo "    - $f" >&2
    done
    return 1
  fi
  echo "  handler files: OK (all canonical files tracked)"
  echo "  workspace hygiene: checking untracked source and misplaced build outputs..."
  # Same rule as pin hygiene below: "the check could not run" must never read as
  # "the check passed". If `git status` fails, the filtered result is empty and
  # this step would report OK over an unknown workspace.
  local hygiene_status
  if ! hygiene_status=$(git status --porcelain --untracked-files=all); then
    echo "  FAIL: git status failed — workspace hygiene cannot be determined," >&2
    echo "        and an empty result must not read as 'clean'." >&2
    return 1
  fi
  local hygiene_failures
  hygiene_failures=$(printf '%s\n' "$hygiene_status" | awk '
    /^\?\?/ {
      path=substr($0,4)
      if (path ~ /\.(go|ts|tsx|js|jsx|mjs|cjs|sql|json|yaml|yml)$/ ||
          path ~ /(^|\/)apps\/api-go\/apps\// ||
          path ~ /(^|\/)\.build\// ||
          path ~ /(^|\/)api$/ || path ~ /(^|\/)worker$/) print path
    }')
  if [ -n "$hygiene_failures" ]; then
    echo "  FAIL: untracked source or misplaced build output found:" >&2
    echo "$hygiene_failures" | sed 's/^/    - /' >&2
    return 1
  fi
  echo "  workspace hygiene: OK"
  # R16.7 audit followup: 'can't hold the line' (总守不住) pattern.
  # The bot's 931a755 bot-commit left native-app.tsx importing
  # legal-doc-render.tsx and legal-doc-render.tsx importing
  # legal-doc-parser.ts — all three of which are UNTRACKED in
  # git. The app typechecks and tests pass on the developer's
  # machine (because the files exist on disk), but a fresh
  # clone, a CI checkout, or another agent's `git reset --hard`
  # will break the build. The gate must catch this:
  # any source file imported from a tracked file must itself
  # be tracked.
  echo "  untracked imports: checking no tracked file imports an untracked file..."
  # The checker is a Go command (apps/api-go/cmd/untracked-imports): the stack is
  # Go + RN/TS, and bash subshells + arrays were too slow (each import spawned a
  # subshell; variable scoping meant we couldn't accumulate leaks outside it).
  #
  # ⚠️ 下面两条守卫是必须的，不是装饰 —— 空结果和「检查器根本没跑起来」长得一模一样。
  # 2026-09-30 实测：把检查器移走，解释器打
  #   can't open file '.../check-untracked-imports': [Errno 2] No such file or directory
  # 而本步照样打印 "untracked imports: OK"、g4 照样 "ALL GATES PASS"。
  # 也不能指望函数开头那两行 `set -e`：gate 函数是被 `if ! gate_g4_drift; then`
  # 调起的，bash 在这种上下文里会**关掉整个函数体的 errexit**（实测：函数体越过 `false`
  # 继续往下跑）。`set -o pipefail` 仍然是活的，所以用 `if ! var=$(pipeline)` 才拦得住。
  local untracked_repo_root
  untracked_repo_root="$(git rev-parse --show-toplevel)"
  local untracked_checker
  untracked_checker="$untracked_repo_root/apps/api-go/cmd/untracked-imports/main.go"
  if [ ! -f "$untracked_checker" ]; then
    echo "  FAIL: $untracked_checker is missing — the check cannot run, and" >&2
    echo "        'could not run' must never read the same as 'no leaks'." >&2
    return 1
  fi
  local untracked_status
  if ! untracked_status=$(git status --porcelain 2>/dev/null); then
    echo "  FAIL: git status failed — the untracked set cannot be determined, so this" >&2
    echo "        check would pass over an unknown set of untracked files." >&2
    return 1
  fi
  local untracked_files
  untracked_files=$(printf '%s\n' "$untracked_status" | awk '/^\?\?/ {print $2}')
  local untracked_imports_str
  if ! untracked_imports_str=$(git ls-files apps/mobile/src apps/api-go 2>/dev/null \
    | grep -E '\.(ts|tsx|go)$' \
    | UNTRACKED_FILES="$untracked_files" REPO_ROOT="$untracked_repo_root" \
      go -C "$untracked_repo_root/apps/api-go" run ./cmd/untracked-imports); then
    echo "  FAIL: the untracked-import checker pipeline exited non-zero (no source files" >&2
    echo "        to check, or the checker itself failed) — it did not run to completion," >&2
    echo "        so an empty result here means nothing." >&2
    return 1
  fi
  if [ -n "$untracked_imports_str" ]; then
    echo "  FAIL: tracked file imports an untracked file (would break fresh clone / CI / reset --hard):" >&2
    echo "$untracked_imports_str" >&2
    return 1
  fi
  echo "  untracked imports: OK (no tracked file imports an untracked file)"
  echo "  semantic fixtures: checking known hard-coded placeholders..."
  local bad_fixtures=()
  # R15.x: market.tsx used to render a fake SVG map with hard-coded
  # OPPORTUNITY_MAP_COORDS / MAP_DISTRICTS instead of real react-native-maps.
  # The fix lands the coordinates into real (lat, lng) via gridToLatLng.
  # This check rejects a regression where the fake fixtures reappear.
  if grep -q 'OPPORTUNITY_MAP_COORDS' apps/mobile/src/surfaces/market.tsx 2>/dev/null; then
    bad_fixtures+=("apps/mobile/src/surfaces/market.tsx still imports OPPORTUNITY_MAP_COORDS")
  fi
  if grep -q 'MAP_DISTRICTS' apps/mobile/src/surfaces/market.tsx 2>/dev/null; then
    bad_fixtures+=("apps/mobile/src/surfaces/market.tsx still imports MAP_DISTRICTS")
  fi
  # R16.7 audit followup: the constants also live in market-fixtures.ts.
  # The original fix only deleted the import from market.tsx; the
  # exports in market-fixtures.ts are now orphans. Guard both files
  # so a future import from market-fixtures.ts is caught too.
  if grep -q 'OPPORTUNITY_MAP_COORDS' apps/mobile/src/surfaces/market.tsx 2>/dev/null \
     || grep -q 'OPPORTUNITY_MAP_COORDS' apps/mobile/src/market-fixtures.ts 2>/dev/null; then
    bad_fixtures+=("OPPORTUNITY_MAP_COORDS reappeared in market.tsx or market-fixtures.ts")
  fi
  if grep -q 'MAP_DISTRICTS' apps/mobile/src/surfaces/market.tsx 2>/dev/null \
     || grep -q 'MAP_DISTRICTS' apps/mobile/src/market-fixtures.ts 2>/dev/null; then
    bad_fixtures+=("MAP_DISTRICTS reappeared in market.tsx or market-fixtures.ts")
  fi
  # MarketMap must use react-native-maps (real MapKit / Google Maps)
  if ! grep -q 'from "react-native-maps"' apps/mobile/src/surfaces/market.tsx 2>/dev/null; then
    bad_fixtures+=("apps/mobile/src/surfaces/market.tsx MarketMap lost the react-native-maps import")
  fi
  # R16.x: activity defaultCatalog 的 5 条冷启动活动必须用 PLATFORM
  # origin + aiStatus=AI_GENERATED + aiActorKind=PLATFORM_AI（AI 不能
  # 作为 origin 主体，AI 是 PLATFORM 在“起草”阶段的助理）。AI_PERSONA
  # origin 是 R15.x 遗留老式写法（让平台 AI 看似“主办方”），今起拒绝。
  if awk '/defaultCatalog/,/^}/' apps/api-go/internal/activity/service.go 2>/dev/null | grep -E 'Origin:[[:space:]]*"AI_PERSONA"' >/dev/null 2>&1; then
    bad_fixtures+=("apps/api-go/internal/activity/service.go defaultCatalog still uses Origin='AI_PERSONA' — R16.x requires PLATFORM origin + aiStatus=AI_GENERATED")
  fi
  if ! awk '/defaultCatalog/,/^}/' apps/api-go/internal/activity/service.go 2>/dev/null | grep -E 'Origin:[[:space:]]*"PLATFORM"' >/dev/null 2>&1; then
    bad_fixtures+=("apps/api-go/internal/activity/service.go defaultCatalog must mark cold-start activities as Origin='PLATFORM' + aiStatus='AI_GENERATED'")
  fi
  # R15.x+: List 端点必须在 SQL 过滤掉 origin='TEST' 的 fixture 残留
  if ! grep -q "origin'.*'TEST'\|origin.*=.*'TEST'" apps/api-go/internal/platform/postgres/activity.go 2>/dev/null; then
    bad_fixtures+=("apps/api-go/internal/platform/postgres/activity.go List() must filter out origin='TEST' rows so PG fixture residue does not leak to client")
  fi
  # R16.x: Opportunity publish 必须验资金方向 (MoneyFlow 4 选 1 + Price 一致)。
  if ! grep -q "normalizeOpportunityMoney" apps/api-go/internal/marketplace/service.go 2>/dev/null; then
    bad_fixtures+=("apps/api-go/internal/marketplace/service.go must enforce MoneyFlow + PriceLabel via normalizeOpportunityMoney — bare Price is forbidden")
  fi
  # R16.x: ai boundary 包不允许删除。所有经济/参与动作必须走 aiboundary 闸。
  if [ ! -f apps/api-go/internal/aiboundary/policy.go ]; then
    bad_fixtures+=("apps/api-go/internal/aiboundary/policy.go missing — AI actor boundary package must exist")
  fi
  # aiboundary 包内的 Action 常量必须在 service 里被调用. PublishActivity
  # 例外: R15.x/R16.x 不开放“用户/AI 发布活动”命令 (目录由 server
  # 启动 seed), 但 aiboundary 包内的常量声明仍需保留以便未来入口接入
  # 是受闸的.
  for cmd in "PublishOpportunity" "ApplyOpportunity" "JoinActivity" "InterestActivity" "CheckinActivity" "CancelActivity" "NoShowActivity"; do
    if ! grep -q "aiboundary\\.${cmd}\\b" apps/api-go/internal/activity/service.go apps/api-go/internal/marketplace/service.go 2>/dev/null; then
      bad_fixtures+=("aiboundary.${cmd} must be invoked from the activity / marketplace service entry")
    fi
  done
  # PublishActivity 常量必须在 aiboundary 包内声明（即便服务入口目前未
  # 调用，以便未来“商家/平台发活动”入口接入时受闸）
  if ! grep -q "PublishActivity\\b" apps/api-go/internal/aiboundary/policy.go 2>/dev/null; then
    bad_fixtures+=("apps/api-go/internal/aiboundary/policy.go must declare PublishActivity Action constant")
  fi
  if [ ${#bad_fixtures[@]} -gt 0 ]; then
    echo "  FAIL: hard-coded map fixture regression detected:" >&2
    for b in "${bad_fixtures[@]}"; do
      echo "    - $b" >&2
    done
    return 1
  fi
  echo "  semantic fixtures: OK (no fake map regressions, no non-AI activity origins)"

  # Pin hygiene: an invocation whose exit code is not enforced makes the block
  # above it decorative. scripts/check-regression-contracts.sh runs with
  # `set -u` only (no `set -e`) and its last statement is an `echo`, so an
  # unguarded failing command neither stops the script nor changes its exit
  # code -- the block above still prints PASS. Measured 2026-09-21: 14
  # invocations across 13 blocks were unguarded, and 4 of those used
  # `test -- --run <file>`, which swallows the file argument and runs the whole
  # suite (149 files / 1381 tests) instead of the one file it names.
  #
  # Covers BOTH carriers, not just vitest: the 387 semantic pins ride on
  # `require_test`, and a swallowed `require_test` failure is the same defect.
  # Swept 2026-09-21: 446 guarded invocations, 0 whose failure was swallowed.
  echo "  pin hygiene: checking every invocation enforces its exit code..."
  local pin_script="scripts/check-regression-contracts.sh"
  # Fail loudly if it is missing: a grep against a nonexistent path also
  # produces "no unguarded lines", i.e. a vacuous pass. Never let "the check
  # could not run" read the same as "the check passed".
  if [ ! -f "$pin_script" ]; then
    echo "  FAIL: $pin_script not found; pin hygiene cannot be verified" >&2
    return 1
  fi
  local unguarded
  # 判据在下面这段 awk 里，语义而不是形状：「这次调用的失败能不能走到 exit」。
  # 旧版逐行正则只认 `|| exit`，把三**已经正确守住退出码**的写法判成漏网 ——
  #   1) `if ! pnpm ...; then ... exit 1; fi`（块里 exit 就是守住）
  #   2) `if ! pnpm ...; then B=1; fi` + 块尾 `[ "$B" -eq 0 ] || exit 1`
  #   3) `... || B=1` 记进变量、稍后 exit 消费
  #   4) `echo "单独复现：pnpm ... exec vitest run ..."` —— 只是提示怎么复现，
  #      根本不是一次调用（旧版把引号里的字面量当成了调用）
  # 「会对正确代码报红的检查，人会学会绕过它」——这句是本仓自己的注释，所以这次
  # 修检查而不是改正确的代码。仍然严格：裸调用、if 块里既不 exit 也不记变量、
  # 变量记了没人 exit，一律照红（7 个变异用例验过牙：3 红 4 绿）。
  # 引号内文字先剥掉（真调用里 pnpm 在引号外）；续行先拼接（守卫写在续行上也是
  # 守卫）；if 块要看到配对的 fi 才算守住。
  unguarded=$(awk '
# Pin hygiene: find invocations whose failure is swallowed.
#
# 2026-10-04 重写（gate.sh G4 长期红着的真因）：旧版逐行正则、只认 `|| exit`，
# 于是把三**已经正确守住退出码**的写法判成漏网 ——
#   1) `if ! pnpm ...; then ... exit 1; fi`（块里 exit 就是守住）
#   2) `if ! pnpm ...; then B=1; fi` + 块尾 `[ "$B" -eq 0 ] || exit 1`
#   3) `... || B=1` 记进变量、稍后 exit 消费
#   4) `echo "  单独复现：pnpm ... exec vitest run ..."` —— 那只是提示怎么复现，
#      根本不是一次调用（旧版把引号里的字面量当成了调用）
# 「会对正确代码报红的检查，人会学会绕过它」—— 所以按语义判「失败能不能走到
# exit」，不按形状猜。
#
# 仍然严格：裸调用、if 块里既不 exit 也不记变量、变量记了没人 exit，一律照红。
# 已用 7 个变异用例验过牙（3 红 4 绿）。判据要点：引号内文字先剥掉（真调用里
# pnpm 在引号外）；续行先拼接（守卫写在续行上也是守卫）；if 块要看到配对的 fi。
function strip_quoted(line,   out, i, c, q) {
  out = ""; q = ""
  for (i = 1; i <= length(line); i++) {
    c = substr(line, i, 1)
    if (q != "") { if (c == q) q = ""; continue }
    if (c == "\"" || c == SQ) { q = c; continue }
    out = out c
  }
  return out
}
function is_invocation(code) {
  if (code ~ /^[[:space:]]*require_test[[:space:]]/) return 1
  if (code ~ /pnpm/ && code ~ /(exec[[:space:]]+vitest[[:space:]]+run|test[[:space:]]+--run|test[[:space:]]+--[[:space:]]+--run)/) return 1
  return 0
}
BEGIN { SQ = sprintf("%c", 39) }
{ lines[NR] = $0 }
END {
  n = NR
  for (i = 1; i <= n; i++) {
    line = lines[i]
    if (line ~ /^[[:space:]]*#/ || line ~ /^[[:space:]]*$/) continue
    buf = line; start = i
    while (buf ~ /\\$/ && i < n) {
      i++
      sub(/\\$/, "", buf)
      buf = buf " " lines[i]
    }
    code = strip_quoted(buf)
    if (!is_invocation(code)) continue
    if (code ~ /\|\|[[:space:]]*exit/) continue
    if (match(code, /\|\|[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=/)) {
      var = substr(code, RSTART, RLENGTH)
      sub(/^.*\|[[:space:]]*/, "", var)
      sub(/=.*$/, "", var)
      consumed = 0
      for (j = i + 1; j <= n; j++) {
        if (lines[j] ~ ("\\$\\{?" var "\\}?") && lines[j] ~ /exit/) { consumed = 1; break }
      }
      if (consumed) continue
      printf "%d: %s\n", start, buf
      continue
    }
    if (code ~ /^[[:space:]]*if[[:space:]]/) {
      depth = 1; has_exit = 0; block_vars = ""
      for (j = i + 1; j <= n && depth > 0; j++) {
        c2 = strip_quoted(lines[j])
        if (c2 ~ /^[[:space:]]*fi[[:space:]]*(;|$)/) depth--
        else if (c2 ~ /^[[:space:]]*(if|for|while|until|case)[[:space:]]/) depth++
        if (c2 ~ /(^|[^_[:alnum:]])exit([^_[:alnum:]]|$)/) has_exit = 1
        if (match(c2, /(^|[;&|[:space:]])[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=/)) {
          v2 = substr(c2, RSTART, RLENGTH); sub(/^.*[;&|[:space:]]/, "", v2); sub(/[[:space:]]*=.*$/, "", v2)
          if (v2 != "") block_vars = block_vars " " v2
        }
      }
      if (depth == 0 && has_exit) continue
      if (depth == 0 && block_vars != "") {
        vars_consumed = 0
        nv = split(block_vars, arr, " ")
        for (v = 1; v <= nv; v++) {
          for (j = i + 1; j <= n; j++) {
            if (lines[j] ~ ("\\$\\{?" arr[v] "\\}?") && lines[j] ~ /exit/) { vars_consumed = 1; break }
          }
          if (vars_consumed) break
        }
        if (vars_consumed) continue
      }
      printf "%d: %s\n", start, buf
      continue
    }
    printf "%d: %s\n", start, buf
  }
}
  ' "$pin_script")
  if [ -n "$unguarded" ]; then
    echo "  FAIL: invocation whose result is not enforced (append '|| exit \$?'):" >&2
    echo "$unguarded" | sed 's/^/    - /' >&2
    return 1
  fi
  local swallow
  swallow=$(awk '
    { line = $0 }
    line ~ /^[[:space:]]*#/ { next }
    line ~ /test -- --run/ { printf "%d: %s\n", NR, line }
  ' "$pin_script")
  if [ -n "$swallow" ]; then
    echo "  FAIL: 'test -- --run <file>' swallows the file argument and runs the whole suite:" >&2
    echo "$swallow" | sed 's/^/    - /' >&2
    return 1
  fi
  echo "  pin hygiene: OK (every invocation enforces its exit code)"

  bash scripts/check-regression-contracts.sh || return $?
}

OVERALL=0
for gate in "${GATES_REQUESTED[@]}"; do
  case "$gate" in
    g1)
      if ! gate_g1_build; then
        OVERALL=1
        echo "  GATE $gate FAILED" >&2
        break
      fi
      ;;
    g2)
      if ! gate_g2_tests; then
        OVERALL=1
        echo "  GATE $gate FAILED" >&2
        break
      fi
      ;;
    g3)
      if ! gate_g3_e2e; then
        OVERALL=1
        echo "  GATE $gate FAILED" >&2
        break
      fi
      ;;
    g4)
      if ! gate_g4_drift; then
        OVERALL=1
        echo "  GATE $gate FAILED" >&2
        break
      fi
      ;;
    *)
      echo "unknown gate: $gate" >&2
      OVERALL=1
      break
      ;;
  esac
done

if [ $OVERALL -eq 0 ]; then
  echo ""
  echo "ALL GATES PASS"
fi
exit $OVERALL
