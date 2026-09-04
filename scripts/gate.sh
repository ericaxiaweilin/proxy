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
  pnpm --filter @proxy/mobile typecheck || return $?
  echo "  mobile typecheck: OK"
  pnpm --filter @proxy/contracts build || return $?
  echo "  contracts build: OK"
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
  local hygiene_failures
  hygiene_failures=$(git status --porcelain --untracked-files=all | awk '
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
  # Use the dedicated Python helper. bash subshells + arrays were
  # too slow (each import spawned a subshell; variable scoping
  # meant we couldn't accumulate leaks outside the subshell).
  local untracked_files
  untracked_files=$(git status --porcelain 2>/dev/null | awk '/^\?\?/ {print $2}')
  local untracked_imports_str
  untracked_imports_str=$(git ls-files apps/mobile/src apps/api-go 2>/dev/null \
    | grep -E '\.(ts|tsx|go)$' \
    | UNTRACKED_FILES="$untracked_files" \
      python3 "$(dirname "$0")/check-untracked-imports.py")
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
  # R15.x+: activity defaultCatalog 不该出现 PLATFORM / MERCHANT / USER
  # origin (那是硬编码 "假人假活动" 伪装成平台/商家/用户发起)。R15.x
  # 原则：平台没有 mock 数据，所有占位都明确标 AI_PERSONA (合规) 或
  # TEST (server 端 filter 掉)。回归拦：defaultCatalog 块内出现
  # Origin: "PLATFORM" / "MERCHANT" / "USER" 任意一个都拒绝 commit。
  if awk '/defaultCatalog/,/^}/' apps/api-go/internal/activity/service.go 2>/dev/null | grep -E 'Origin:[[:space:]]*"(PLATFORM|MERCHANT|USER)"' >/dev/null 2>&1; then
    bad_fixtures+=("apps/api-go/internal/activity/service.go defaultCatalog has non-AI origin (PLATFORM/MERCHANT/USER) — must be AI_PERSONA or TEST")
  fi
  # R15.x+: List 端点必须在 SQL 过滤掉 origin='TEST' 的 fixture 残留
  if ! grep -q "origin'.*'TEST'\|origin.*=.*'TEST'" apps/api-go/internal/platform/postgres/activity.go 2>/dev/null; then
    bad_fixtures+=("apps/api-go/internal/platform/postgres/activity.go List() must filter out origin='TEST' rows so PG fixture residue does not leak to client")
  fi
  if [ ${#bad_fixtures[@]} -gt 0 ]; then
    echo "  FAIL: hard-coded map fixture regression detected:" >&2
    for b in "${bad_fixtures[@]}"; do
      echo "    - $b" >&2
    done
    return 1
  fi
  echo "  semantic fixtures: OK (no fake map regressions, no non-AI activity origins)"

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
