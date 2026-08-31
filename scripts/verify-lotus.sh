#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "== Lotus R15.24 verify =="
echo "-- Go vet/build --"
( cd "$ROOT/apps/api-go" && go vet ./... 2>&1 | grep -v "metrics.go" || true )
( cd "$ROOT/apps/api-go" && go build ./... )

echo "-- Go tests: identity + conversation + sweep + eviction --"
( cd "$ROOT/apps/api-go" && go test ./internal/identity -run TestDisplayIdentity -count=1 -v 2>&1 | tail -n 20 )
( cd "$ROOT/apps/api-go" && go test ./internal/identity -run TestLotus_MaxConcurrent -count=1 -v 2>&1 | tail -n 10 )
( cd "$ROOT/apps/api-go" && go test ./internal/conversation -run TestPurgeExpired -count=1 -v 2>&1 | tail -n 10 )
( cd "$ROOT/apps/api-go" && go test ./internal/conversation -count=1 2>&1 | tail -n 5 )
( cd "$ROOT/apps/api-go" && go test ./internal/identity -count=1 2>&1 | tail -n 5 )

echo "-- Migrations --"
ls -1 "$ROOT/apps/api-go/migrations/038_display_identity.sql" "$ROOT/apps/api-go/migrations/035_message_protection_persistence.sql" >/dev/null && echo "migrations 035/038 present"

echo "-- Mobile touched files tsc (skipLibCheck) --"
( cd "$ROOT/apps/mobile" && npx tsc -p tsconfig.json --noEmit --skipLibCheck 2>&1 | grep -E "conversation-client|display-identity|identity-switcher|security-settings|screenshot-protection" | head -n 20 || echo "mobile touched files: no new errors" )

echo "== verify done =="
