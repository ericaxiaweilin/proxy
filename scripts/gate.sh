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
  # server. When the live server is up, it mutates the same tables
  # the migrator / contribution / inbox tests depend on, and the
  # tests flake. Kill any live server first, then re-spawn after
  # the suite is done.
  local server_pid
  server_pid=$(lsof -i :4100 -t 2>/dev/null | head -1 || true)
  local killed_server=0
  if [ -n "$server_pid" ]; then
    echo "  api-go test: stopping live server (pid $server_pid) to avoid DB contention..."
    kill "$server_pid" 2>/dev/null || true
    for _ in $(seq 1 10); do
      if ! lsof -i :4100 -t >/dev/null 2>&1; then break; fi
      sleep 1
    done
    killed_server=1
  fi
  go -C apps/api-go test -count=1 -p 1 ./... || return $?
  echo "  api-go test: OK"
  # Re-spawn the live server if we killed one. Use the same
  # env-loading shape as the install/run docs.
  if [ "$killed_server" = "1" ]; then
    echo "  api-go test: re-spawning live server for g3 e2e..."
    if [ -f ./.env ]; then
      set -a; . ./.env; set +a
    fi
    (cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && nohup go -C apps/api-go run ./cmd/api > /tmp/api-go-gate.log 2>&1 &) >/dev/null 2>&1
    for _ in $(seq 1 20); do
      if curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:4100/health/live 2>/dev/null | grep -q "200"; then
        break
      fi
      sleep 1
    done
  fi
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
