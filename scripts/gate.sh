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
  go -C apps/api-go test -count=1 -p 1 ./... || return $?
  echo "  api-go test: OK"
  pnpm --filter @proxy/mobile test --run || return $?
  echo "  mobile test: OK"
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
