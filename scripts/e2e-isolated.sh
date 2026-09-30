#!/usr/bin/env bash
# e2e-isolated.sh — run the compliance e2e suites against THIS checkout, on a throwaway
# database.
#
# Why this exists
# ---------------
# `gate.sh`'s g3 hits http://127.0.0.1:4100. On a machine where that port is served by a
# *different checkout* — or by nothing — g3 either cannot run or, worse, silently tests
# the other tree. Measured 2026-09-30: g3 failed with ONLY_AGENT_CONFIRMS and the only
# honest conclusion available was "environmental". That means the eight compliance
# suites (privacy / legal / kill-switch / benefit-eligibility / lc28 / lc06 / p1e /
# location-consent) were giving zero signal about this branch.
#
# What it does
# ------------
#   1. clones the schema of a source database into a throwaway one
#      (`pg_dump --schema-only` keeps ownership and ACLs; `schema_migrations` is copied
#      as DATA so the boot migrator finds nothing pending)
#   2. boots THIS checkout's API on a free port against that database
#   3. runs the e2e suites with PROXY_API_BASE_URL pointed at that port
#   4. tears the server down and drops the database
#
# Usage
# -----
#   scripts/e2e-isolated.sh                       # all suites
#   scripts/e2e-isolated.sh privacy legal         # a subset
#   scripts/e2e-isolated.sh --keep                # leave the DB up for inspection
#   E2E_SOURCE_DSN=postgres://... scripts/e2e-isolated.sh
#   scripts/e2e-isolated.sh --dump-dsn 'postgres://super@host/db'   # remote source
#
# Source DSN resolution: --source-dsn > $E2E_SOURCE_DSN > $DATABASE_URL, where
# DATABASE_URL may come from ./.env (sourced with `set -a` if the file exists). If none
# of the three is set the script exits 2 with instructions. The DSN must be a
# postgres:// URI (only the database name is rewritten).
#
# Two different roles are involved on purpose:
#   * the API connects with the SOURCE credentials, so the runtime role matches
#     production posture (a non-superuser, e.g. `proxy`);
#   * admin work (createdb / pg_dump / restore / dropdb) runs over the local socket as
#     the current OS user, because the runtime role deliberately cannot read every
#     table — measured 2026-09-30: `pg_dump` as `proxy` dies with
#     "permission denied for table global_person". Use --dump-dsn for a remote source.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# localhost must bypass any brokered/HTTP proxy or every curl in the suites 502s.
# Re-asserted again after .env is sourced below, so a future NO_PROXY= line in .env
# cannot silently undo this.
export NO_PROXY="${NO_PROXY:-},127.0.0.1,localhost,0.0.0.0,::1"
export no_proxy="$NO_PROXY"

SUITES=(privacy location-consent kill-switch benefit-eligibility \
        lc28-policy-decision lc06-ai-media p1e-jurisdiction legal)

SOURCE_DSN=""
DUMP_DSN=""
KEEP=0
REQUESTED=()

while [ $# -gt 0 ]; do
  case "$1" in
    --source-dsn) SOURCE_DSN="${2:-}"; shift 2 ;;
    --dump-dsn)   DUMP_DSN="${2:-}"; shift 2 ;;
    --keep)       KEEP=1; shift ;;
    -h|--help)    sed -n '1,50p' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*)           echo "e2e-isolated: unknown flag $1" >&2; exit 2 ;;
    *)            REQUESTED+=("$1"); shift ;;
  esac
done

# ---------------------------------------------------------------------------
# tooling
# ---------------------------------------------------------------------------
if ! command -v pg_dump >/dev/null 2>&1; then
  for d in /opt/homebrew/opt/postgresql@15/bin /usr/local/opt/postgresql@15/bin; do
    if [ -x "$d/pg_dump" ]; then PATH="$d:$PATH"; export PATH; break; fi
  done
fi
for tool in pg_dump psql createdb dropdb go curl; do
  command -v "$tool" >/dev/null 2>&1 || { echo "e2e-isolated: $tool not on PATH" >&2; exit 2; }
done

# ---------------------------------------------------------------------------
# source DSN
# ---------------------------------------------------------------------------
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  # .env is untrusted input for this variable: re-assert the localhost bypass.
  export NO_PROXY="${NO_PROXY:-},127.0.0.1,localhost,0.0.0.0,::1"
  export no_proxy="$NO_PROXY"
fi
SOURCE_DSN="${SOURCE_DSN:-${E2E_SOURCE_DSN:-${DATABASE_URL:-}}}"
if [ -z "$SOURCE_DSN" ]; then
  cat >&2 <<'EOF'
e2e-isolated: no source database.

  This checkout has no .env, so DATABASE_URL is unset. Point it at the database whose
  schema you want to clone:

      scripts/e2e-isolated.sh --source-dsn 'postgres://user:pw@127.0.0.1:5432/proxy'

  or set E2E_SOURCE_DSN. The database is only READ (pg_dump); the suites run against a
  throwaway copy.
EOF
  exit 2
fi
case "$SOURCE_DSN" in
  postgres://*|postgresql://*) ;;
  *) echo "e2e-isolated: source DSN must be a postgres:// URI (got something else)" >&2; exit 2 ;;
esac

# ---------------------------------------------------------------------------
# DSN helpers
# ---------------------------------------------------------------------------
rewrite_db() {  # rewrite_db <dsn> <newdb>
  printf '%s' "$1" | sed -E "s#^(postgres(ql)?://[^/]*/)[^?]*(.*)\$#\1$2\3#"
}
dsn_db() {
  printf '%s' "$1" | sed -nE 's#^[a-z]+://[^/]*/([^?]*).*$#\1#p'
}
dsn_port() {
  printf '%s' "$1" | sed -nE 's#^[a-z]+://[^/]*@[^:/]*:([0-9]+)/.*$#\1#p'
}

SRC_DB="$(dsn_db "$SOURCE_DSN")"
SRC_PORT="$(dsn_port "$SOURCE_DSN")"; SRC_PORT="${SRC_PORT:-5432}"
if [ -z "$SRC_DB" ]; then
  echo "e2e-isolated: could not read a database name out of the source DSN." >&2
  exit 2
fi

STAMP="$(date +%Y%m%d%H%M%S)"
SCRATCH_DB="proxy_e2e_${STAMP}_$$"
SCRATCH_DSN="$(rewrite_db "$SOURCE_DSN" "$SCRATCH_DB")"
if [ "$SCRATCH_DSN" = "$SOURCE_DSN" ]; then
  echo "e2e-isolated: could not rewrite the database name in the source DSN." >&2
  exit 2
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/proxy-e2e.XXXXXX")"
API_LOG="$WORK/api.log"
API_PID=""

OS_USER="$(id -un)"

admin_psql() {  # admin_psql <dbname> [psql args...]
  local db="$1"; shift
  if [ -n "$DUMP_DSN" ]; then
    psql -X -q "$(rewrite_db "$DUMP_DSN" "$db")" "$@"
  else
    psql -X -q -p "$SRC_PORT" -U "$OS_USER" -d "$db" "$@"
  fi
}
admin_dump() {  # admin_dump <dbname> [pg_dump args...]
  local db="$1"; shift
  if [ -n "$DUMP_DSN" ]; then
    pg_dump "$(rewrite_db "$DUMP_DSN" "$db")" "$@"
  else
    pg_dump -p "$SRC_PORT" -U "$OS_USER" -d "$db" "$@"
  fi
}
admin_createdb() {
  if [ -n "$DUMP_DSN" ]; then createdb "$(rewrite_db "$DUMP_DSN" "$1")"
  else createdb -p "$SRC_PORT" -U "$OS_USER" "$1"; fi
}
admin_dropdb() {
  if [ -n "$DUMP_DSN" ]; then dropdb --if-exists "$(rewrite_db "$DUMP_DSN" "$1")"
  else dropdb --if-exists -p "$SRC_PORT" -U "$OS_USER" "$1"; fi
}

cleanup() {
  local rc=$?
  if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
  if [ "$KEEP" = "1" ]; then
    echo ""
    echo "  --keep: database $SCRATCH_DB left in place."
    echo "          API log: $API_LOG"
    echo "          drop it with: dropdb $SCRATCH_DB"
  else
    admin_dropdb "$SCRATCH_DB" >/dev/null 2>&1 || true
    rm -rf "$WORK"
  fi
  exit $rc
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# 1. throwaway database
# ---------------------------------------------------------------------------
echo "=== e2e-isolated ==="
echo "  source db : $(printf '%s' "$SOURCE_DSN" | sed -E 's#://[^@]*@#://***@#')"
echo "  scratch db: $SCRATCH_DB"
if [ -n "$DUMP_DSN" ]; then
  echo "  admin as  : $(printf '%s' "$DUMP_DSN" | sed -E 's#://[^@]*@#://***@#')"
else
  echo "  admin as  : $OS_USER over the local socket (port $SRC_PORT)"
fi

if ! admin_createdb "$SCRATCH_DB" 2>"$WORK/createdb.err"; then
  echo "e2e-isolated: createdb $SCRATCH_DB failed:" >&2
  sed 's/^/    /' "$WORK/createdb.err" >&2
  echo "    If the source is remote, pass --dump-dsn with credentials that can create" >&2
  echo "    databases and read every table." >&2
  exit 1
fi

echo "  cloning schema ..."
if ! admin_dump "$SRC_DB" --schema-only > "$WORK/schema.sql" 2>"$WORK/dump.err"; then
  echo "e2e-isolated: pg_dump --schema-only failed:" >&2
  sed 's/^/    /' "$WORK/dump.err" >&2
  # Name the actual cause. A generic "check your privileges" hint on a
  # "database does not exist" error sends the reader down the wrong path.
  if grep -qiE 'does not exist|connection to server|no such host|could not connect' "$WORK/dump.err"; then
    echo "    The SOURCE database or connection is wrong (see the message above)." >&2
    echo "    Check the DSN: $SRC_DB on port $SRC_PORT." >&2
  elif grep -qiE 'permission denied' "$WORK/dump.err"; then
    echo "    pg_dump needs a role that can read EVERY table. The application role" >&2
    echo "    deliberately cannot, so use --dump-dsn for a remote source." >&2
  else
    echo "    Unrecognised pg_dump failure — read the message above." >&2
  fi
  exit 1
fi
if ! admin_psql "$SCRATCH_DB" -v ON_ERROR_STOP=1 -f "$WORK/schema.sql" >"$WORK/restore.log" 2>&1; then
  echo "e2e-isolated: restoring the schema failed:" >&2
  tail -25 "$WORK/restore.log" | sed 's/^/    /' >&2
  exit 1
fi

# Copy schema_migrations as DATA. Without this the boot migrator would think every
# migration is pending and try to re-apply all of them onto an already-current schema.
echo "  copying schema_migrations ..."
if ! admin_dump "$SRC_DB" --data-only --table=public.schema_migrations \
     | admin_psql "$SCRATCH_DB" -v ON_ERROR_STOP=1 >"$WORK/mig.log" 2>&1; then
  echo "e2e-isolated: copying schema_migrations failed:" >&2
  tail -25 "$WORK/mig.log" | sed 's/^/    /' >&2
  exit 1
fi
APPLIED="$(admin_psql "$SCRATCH_DB" -t -A -c 'select count(*) from public.schema_migrations' 2>/dev/null || echo '?')"
echo "  schema_migrations rows: $APPLIED"

# ---------------------------------------------------------------------------
# 2. free port + boot this checkout's API
# ---------------------------------------------------------------------------
PORT=""
for candidate in $(seq 4200 4260); do
  if ! curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$candidate/health/live"; then
    PORT="$candidate"
    break
  fi
done
if [ -z "$PORT" ]; then
  echo "e2e-isolated: no free port in 4200-4260" >&2
  exit 1
fi

echo "  building api ..."
if ! go -C apps/api-go build -o "$WORK/api" ./cmd/api >"$WORK/build.log" 2>&1; then
  echo "e2e-isolated: go build failed:" >&2
  tail -30 "$WORK/build.log" | sed 's/^/    /' >&2
  exit 1
fi

echo "  booting api on :$PORT (log: $API_LOG)"
(
  cd "$REPO"
  API_PORT="$PORT" \
  DATABASE_URL="$SCRATCH_DSN" \
  PROXY_MEDIA_STORE_DIR="$WORK/media" \
  exec "$WORK/api"
) >"$API_LOG" 2>&1 &
API_PID=$!

BASE="http://127.0.0.1:$PORT"
healthy=0
for _ in $(seq 1 90); do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "e2e-isolated: the API exited during boot. Last 40 log lines:" >&2
    tail -40 "$API_LOG" | sed 's/^/    /' >&2
    echo "" >&2
    echo "    A boot failure here is usually a MIGRATION failure: cmd/api/main.go applies" >&2
    echo "    pending migrations and log.Fatalf's on error. Check the log for the failing" >&2
    echo "    migration and its SQLSTATE." >&2
    exit 1
  fi
  if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$BASE/health/live" || true)" = "200" ]; then
    healthy=1
    break
  fi
  sleep 1
done
if [ "$healthy" != "1" ]; then
  echo "e2e-isolated: $BASE/health/live never returned 200. Last 40 log lines:" >&2
  tail -40 "$API_LOG" | sed 's/^/    /' >&2
  exit 1
fi
echo "  health: OK ($BASE/health/live 200)"

# ---------------------------------------------------------------------------
# 3. suites
# ---------------------------------------------------------------------------
if [ ${#REQUESTED[@]} -gt 0 ]; then
  SUITES=("${REQUESTED[@]}")
fi

FAILED=()
for suite in "${SUITES[@]}"; do
  script="scripts/${suite}-e2e.sh"
  if [ ! -f "$script" ]; then
    echo ""
    echo "--- $suite: SKIP (no $script) ---"
    continue
  fi
  echo ""
  echo "--- $suite ---"
  if PROXY_API_BASE_URL="$BASE" bash "$script"; then
    echo "  $suite: OK"
  else
    echo "  $suite: FAILED"
    FAILED+=("$suite")
  fi
done

echo ""
echo "=== e2e-isolated summary ==="
echo "  suites run : ${#SUITES[@]}"
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "  result     : ALL PASS"
  exit 0
fi
echo "  FAILED     : ${FAILED[*]}"
echo ""
echo "  These ran against THIS checkout ($(git rev-parse --short HEAD 2>/dev/null || echo '?')),"
echo "  on $SCRATCH_DB — not against whatever happens to be on :4100."
exit 1
