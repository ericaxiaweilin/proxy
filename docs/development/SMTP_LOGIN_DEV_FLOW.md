# SMTP Passwordless Login — Dev Flow (R15.27)

Captures `feat/facet` commit `a4a4fd1` ("fix(identity): wire SMTP email
resolver to PG identity repo"). After this lands, running
`BeginPasswordlessAuthentication{ channel: EMAIL }` against the local
PG-backed API actually sends a one-time code to the address on file
— captured by Mailpit on `127.0.0.1:8025` for local dev.

## Why this exists

`SMTPLoginChallengeProvider.Request` needs to turn a `LoginIdentityID`
into an email recipient. The provider stored nothing of its own; the
mapping lived in `login_identities.identifier`. Earlier wiring only
registered a resolver when `PROXY_SMTP_TEST_RECIPIENT` was non-empty,
which made every "production-shaped" `BeginPasswordlessAuthentication`
fall through to `ErrLoginChallengeProviderNotReady` and surface to the
client as `LOGIN_PROVIDER_NOT_CONFIGURED`. The fix in `a4a4fd1`
exposes `identity.Service.Repository()` and calls
`wireIdentityEmailResolver(identityService)` from `cmd/api/main.go`
inside the PG branch (right after `SetDisplayIdentityRepository`),
registering a closure that does the PG lookup with a 3 s timeout.

## Boot order (canonical)

```bash
# 1. PG running locally with DATABASE_URL=postgres://proxy:proxy@localhost:5432/proxy
#    (proxy user needs USAGE/CREATE on schema public + ALL on schema_migrations)

# 2. Mailpit (local fake SMTP + web UI for inspecting captured mail)
mailpit           # SMTP 127.0.0.1:1025, Web http://127.0.0.1:8025/

# 3. API (must source .env, must set PROXY_MIGRATIONS_DIR)
PROXY_MIGRATIONS_DIR=$(pwd)/apps/api-go/migrations \
  nohup ./scripts/dev-api.sh > /tmp/api.log 2>&1 &
```

> **`scripts/dev-api.sh` is the only blessed startup path** — it sources
> `.env`. Calling `go -C apps/api-go run ./cmd/api` directly skips the
> env source and the API silently boots in in-memory mode, which is
> the easiest way to lose newly registered accounts on every restart.

## `.env` shape (PG + SMTP)

```ini
DATABASE_URL=postgres://proxy:proxy@localhost:5432/proxy
PROXY_MIGRATIONS_DIR=/absolute/path/to/kake/apps/api-go/migrations

PROXY_LOGIN_PROVIDER=smtp
PROXY_SMTP_HOST=127.0.0.1
PROXY_SMTP_PORT=1025
PROXY_SMTP_FROM=noreply@proxy.local            # plain addr, no display name
PROXY_SMTP_TLS=none

# Optional smoke override — when set, every EMAIL challenge routes to
# this address instead of looking the LoginIdentity up in PG.
# PROXY_SMTP_TEST_RECIPIENT=qa@proxy.local
```

> **MAIL FROM must be a bare address.** RFC 5321 `MAIL FROM:<…>` rejects
> display-name forms (`"Proxy Dev <noreply@proxy.local>"`). Mailpit logs
> `501 5.5.4 Syntax error in parameters or arguments (invalid FROM
> parameter)` and the provider surfaces
> `ErrLoginChallengeProviderNotReady` → `LOGIN_PROVIDER_NOT_CONFIGURED`.

## End-to-end (curl)

```bash
# 1. Issue a challenge (mail lands in Mailpit immediately)
curl -s -X POST http://127.0.0.1:4100/v1/commands/BeginPasswordlessAuthentication \
  -H 'Content-Type: application/json' \
  -d '{
    "commandId":     "<uuid1>",
    "commandType":   "BeginPasswordlessAuthentication",
    "commandVersion": 1,
    "actor":         { "type": "USER", "id": "<deviceId>" },
    "principal":     { "type": "INDIVIDUAL", "id": "<deviceId>" },
    "target":        { "type": "LoginChallenge", "id": "new" },
    "idempotencyKey":"idem-1-<uuid1>",
    "authContext":   {},
    "purpose":       "passwordless_login",
    "correlationId": "corr-1-<uuid1>",
    "requestedAt":   "<iso-8601-utc>",
    "payload": {
      "channel":    "EMAIL",
      "identifier": "weilinxia511@gmail.com",
      "deviceId":   "<deviceId>",
      "platform":   "IOS"
    }
  }'
# → outcome PENDING, operationRef = challenge_<hex>

# 2. Read the OTP from Mailpit (or open http://127.0.0.1:8025/ in a browser)
curl -s http://127.0.0.1:8025/api/v1/messages | jq -r '.messages[0].ID' \
  | xargs -I{} curl -s "http://127.0.0.1:8025/api/v1/message/{}" | jq -r .Text

# 3. Verify the challenge
curl -s -X POST http://127.0.0.1:4100/v1/commands/VerifyLoginChallenge \
  -H 'Content-Type: application/json' \
  -d '{
    "commandId":     "<uuid2>",
    "commandType":   "VerifyLoginChallenge",
    "commandVersion": 1,
    "actor":         { "type": "USER", "id": "<deviceId>" },
    "principal":     { "type": "INDIVIDUAL", "id": "<deviceId>" },
    "target":        { "type": "LoginChallenge", "id": "<challengeId>" },
    "idempotencyKey":"idem-2-<uuid2>",
    "authContext":   {},
    "purpose":       "passwordless_login",
    "correlationId": "corr-2-<uuid2>",
    "requestedAt":   "<iso-8601-utc>",
    "payload": {
      "challengeId": "<challengeId>",
      "code":        "<otp>",
      "channel":     "EMAIL",
      "identifier":  "weilinxia511@gmail.com"
    }
  }'
# → outcome ACCEPTED, aggregate.state = VERIFIED

# 4. Promote the challenge to a session
curl -s -X POST http://127.0.0.1:4100/v1/commands/CreateSession \
  -H 'Content-Type: application/json' \
  -d '{
    "commandId":     "<uuid3>",
    "commandType":   "CreateSession",
    "commandVersion": 1,
    "actor":         { "type": "USER", "id": "<deviceId>" },
    "principal":     { "type": "INDIVIDUAL", "id": "<deviceId>" },
    "target":        { "type": "Session", "id": "new" },
    "idempotencyKey":"idem-3-<uuid3>",
    "authContext":   {},
    "purpose":       "passwordless_login",
    "correlationId": "corr-3-<uuid3>",
    "requestedAt":   "<iso-8601-utc>",
    "payload": {
      "userAccountId":      "user_…",
      "loginIdentityId":    "login_…",
      "deviceId":           "<deviceId>",
      "challengeId":        "<challengeId>",
      "requestedPrincipal": { "type": "INDIVIDUAL", "id": "user_…" }
    }
  }'
# → outcome ACCEPTED, auth.sessionId = session_<hex>
#   auth.accessExpiresAt  = now + 15 min
#   auth.refreshExpiresAt = now + 30 days
```

## Switching to real Gmail (when the user supplies an app password)

```ini
PROXY_SMTP_HOST=smtp.gmail.com
PROXY_SMTP_PORT=587
PROXY_SMTP_TLS=starttls
PROXY_SMTP_USERNAME=weilinxia511@gmail.com
PROXY_SMTP_PASSWORD=<16-char-gmail-app-password>
PROXY_SMTP_FROM=weilinxia511@gmail.com       # must be a bare address
# PROXY_SMTP_TEST_RECIPIENT unset
```

Pre-req: Gmail account has 2FA enabled, then create an App Password at
<https://myaccount.google.com/apppasswords>. Without 2FA the SMTP login
fails and the challenge surfaces as `LOGIN_PROVIDER_NOT_CONFIGURED`
again (provider stays fail-closed).

## Common failure modes

| Symptom in `BeginPasswordlessAuthentication`        | Likely cause                                                                                              | Fix                                                                                                  |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `LOGIN_PROVIDER_NOT_CONFIGURED` (no log noise)      | API running from cached `go-build` binary while a fresh one is still on disk; or `go run` not using `.env` | `pkill -9 -f "exe/api"` then restart via `scripts/dev-api.sh`; confirm boot log shows `smtp=true`     |
| `LOGIN_PROVIDER_NOT_CONFIGURED` (resolver not hit)  | API in in-memory mode (no `DATABASE_URL` / no `PROXY_LOGIN_PROVIDER=smtp`)                                | Confirm `.env` is sourced; restart; check boot log                                                   |
| Mailpit logs `501 5.5.4 … invalid FROM parameter`   | `PROXY_SMTP_FROM` has display-name form (`"Proxy Dev <…>"`)                                              | Use a bare `addr@domain`                                                                             |
| Mailpit logs `AUTH` not advertised, `535` auth fail | Real Gmail + missing/wrong App Password, or `PROXY_SMTP_TLS=starttls` not set against port 587            | Enable 2FA, mint App Password, ensure `PROXY_SMTP_TLS=starttls` for port 587                          |
| `LOGIN_CHALLENGE_INVALID` on `VerifyLoginChallenge` | Used wrong OTP / wrong challengeId / wrong channel-identifier triple                                     | Read the latest Mailpit message; every `BeginPasswordlessAuthentication` issues a new code            |
| Mailpit sees the email but no OTP regex match       | `mailpit` message body uses indentation (e.g. `code:\n\n    205442`)                                     | Strip whitespace, search `(\d{6})`                                                                   |
