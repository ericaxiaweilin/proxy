# Proxy API — Production Environment

This document is the canonical reference for the environment variables
the `apps/api-go` binary honors on a production deployment. The dev
defaults live in `.env.example`; this file is what an SRE/operator
needs to put a real instance into production.

The binary **fails closed** on every provider below: if the env that
gates a domain is not set, the corresponding adapter returns
"unconfigured" and the domain's commands become no-ops or reject with
`PROVIDER_UNCONFIGURED`. There are no silent fallbacks to mock
implementations in production.

## Core process

| Variable          | Required | Default | Notes |
|-------------------|----------|---------|-------|
| `API_HOST`        | no       | `0.0.0.0` | bind address |
| `API_PORT`        | no       | `4100`  | listen port |
| `DATABASE_URL`    | yes (prod) | unset (in-memory) | `postgres://user:pass@host:5432/db`. When unset, services fall back to the in-memory repository (dev/test only). |
| `PROXY_DB_MAX_CONNS` | no | `20` | Per-process PostgreSQL connection ceiling (1–200). Lower this behind Hyperdrive/another pooler. |
| `PROXY_DB_MIN_CONNS` | no | `2` | Warm connections (0–`PROXY_DB_MAX_CONNS`). Invalid values fail back to the safe default. |
| `PROXY_TRUST_CLOUDFLARE_IP` | no | `false` | When true, rate limiting uses a validated `CF-Connecting-IP`. Enable only after firewall/Tunnel rules make the origin unreachable except through Cloudflare. `X-Forwarded-For` is deliberately ignored. |
| `PROXY_CURSOR_HMAC_KEY` | no | `DATABASE_URL` derived | HMAC key for feed cursor signing. Set a stable 32+ char secret in production; rotation invalidates all outstanding cursors. |
| `PROXY_MIN_APP_VERSION` | no | unset (no enforcement) | e.g. `1.0.0`. When set, `X-Proxy-App-Version` below this receives `426 Upgrade Required` (`/health` + `facet` exempt). |

The anonymous feed read projection has a four-second origin deadline, signed
cursors (HMAC, `PROXY_CURSOR_HMAC_KEY`), bounded page size (`25-50`) and
cursor length (`1024`), per-IP rate limiting (`120/min` via `RateLimiter`),
and `no-store` on failures. `ETag` is `sha256(payload)` with
`Cache-Control: public, max-age=15, stale-while-revalidate=120`.
These controls prevent a slow database or attacker-controlled cache keys from
exhausting the API while allowing successful pages to be cached at the edge.
Media originals are verified for size/checksum before `PROCESSING→READY`; a
dataless iCloud placeholder fails `integrity` and lands `FAILED/REJECTED_TECHNICAL`.

## Login / Identity

The login provider is selected by `PROXY_LOGIN_PROVIDER`. The
production-shipped providers are SMTP (email OTP) and SMS (phone OTP).
A `simulated` provider exists for local development and the smoke
scripts under `apps/api-go/scripts/`.

### SMTP (email OTP)

| Variable                  | Required | Notes |
|---------------------------|----------|-------|
| `PROXY_SMTP_HOST`         | yes      | hostname |
| `PROXY_SMTP_PORT`         | no       | default 587 |
| `PROXY_SMTP_USERNAME`     | no       | for authenticated relay |
| `PROXY_SMTP_PASSWORD`     | no       | for authenticated relay |
| `PROXY_SMTP_FROM`         | yes      | RFC 5322 From address |
| `PROXY_SMTP_TLS`          | no       | `starttls` / `tls` / `none` |
| `PROXY_SMTP_TEST_RECIPIENT` | no     | dev-only: redirect all mail here |

### SMS (phone OTP)

| Variable              | Required | Notes |
|-----------------------|----------|-------|
| `PROXY_SMS_URL`       | yes      | provider HTTP endpoint |
| `PROXY_SMS_FROM`      | yes      | sender id / short code |
| `PROXY_SMS_TOKEN`     | yes      | bearer token |
| `PROXY_SMS_TEST_PHONE` | no      | dev-only: redirect all SMS here |

### Simulated (dev only)

`PROXY_LOGIN_PROVIDER=simulated` + `PROXY_SIMULATED_OTP_CODE=123456`.
Never enable this provider in production. The simulated provider
exists so the mobile dev shell can run end-to-end without burning
real OTP quota; turning it on in production would let any caller log
in as any user.

## Operator gate

| Variable                     | Required | Notes |
|------------------------------|----------|-------|
| `PROXY_OPERATOR_PRINCIPALS`  | no (fail-closed) | comma-separated principal ids allowed to execute privileged commands (capability review, contribution moderation, payout authorization, media readiness override). Unset = every operator command rejected. |

### Customer-service number lookup (PUBLIC-NO-LOOKUP-001)

Users read order / signup / demand / invitation / activity numbers (16+ all-digit
numbers, one global sequence) to customer service. The operator command
`LookupPublicNumber` resolves a number back to its entity. It is a cross-party
read, so it needs the operator gate **and** the `CASE` scope, and it requires a
written reason. (Today every principal in `PROXY_OPERATOR_PRINCIPALS` holds all
scopes: the per-principal scope parser `PROXY_OPERATOR_SCOPES` exists in
`internal/api/operator_scopes.go` but is not wired in `cmd/api/main.go` yet, so
a customer-service principal added to `PROXY_OPERATOR_PRINCIPALS` also gets every
other operator power until it is.)

Every lookup (found, not found, bad number) appends one row to
`operator.number_lookups` in the command's own transaction; if that row cannot
be written the command returns no data. The console page is "编号查询".

## Database roles (ORDER-ROLE-001)

| Variable                            | Required | Notes |
|-------------------------------------|----------|-------|
| `PROXY_ENFORCE_DB_ROLE_SEPARATION`  | no       | `true` / `1`: refuse to start unless the runtime database role satisfies the preconditions below. Unset = log the findings only. |

Order and audit protection is triggers **plus** privileges (migration 138):

* `proxy.guard_override` (the order/offer guard bypass) is honoured only for members of
  `proxy_breakglass` and superusers. Any other role that sets it and then writes an
  order gets an error. Never grant `proxy_breakglass` to the application role.
* `fulfillment.audit_log`, `policy.policy_decisions`, `policy.order_decisions` and
  `operator.number_lookups` have `UPDATE` / `DELETE` / `TRUNCATE` revoked from `PUBLIC`,
  their owner and `proxy` (`fulfillment.harden_append_only(regclass)`).

Break-glass correction (a DBA, never the app): grant `proxy_breakglass` to your personal login
role, then in one transaction set the reason (it lands in `audit_log.override_reason` together
with your `db_user`):

    BEGIN;
    SELECT set_config('proxy.guard_override', 'ticket-1234 why', true),
           set_config('proxy.audit_actor', 'your-name', true);
    -- the correcting statement
    COMMIT;

The runtime role must **not** be a superuser, must not be a `proxy_breakglass` member and must
not be able to rewrite the audit tables. Because migrations currently run as the same role as
the API (owner == runtime), an owner can still drop the triggers or re-grant itself, so the
posture check also reports `RUNTIME_OWNS_AUDIT_TABLE`. To fully satisfy it:

1. Create `proxy_owner` (owns the schemas/tables, runs migrations from CI) and `proxy_app`
   (login role the API uses); leave `PROXY_MIGRATIONS_DIR` unset on the API.
2. As `proxy_owner`: grant `proxy_app` USAGE on the schemas and SELECT/INSERT/UPDATE (and DELETE
   only where the code deletes, e.g. own reversals) on the tables, then re-harden the audit
   tables: `REVOKE UPDATE, DELETE, TRUNCATE ON fulfillment.audit_log, policy.policy_decisions,
   policy.order_decisions, operator.number_lookups FROM proxy_app;`
3. Start the API with `PROXY_ENFORCE_DB_ROLE_SEPARATION=true`; the log lines
   `db role posture: ...` list anything still open.

## Model Stack (AI)

`apps/api-go` integrates with the platform Model Stack for the
Experience Runtime. The control plane and gateway must both be
configured; otherwise the AI features are unavailable and the
runtime falls back to the in-domain deterministic path.

| Variable                       | Required | Notes |
|--------------------------------|----------|-------|
| `MODELSTACK_CONTROL_PLANE_URL` | yes      | routing + failover control plane |
| `MODELSTACK_GATEWAY_URL`       | yes      | business gateway (OpenAI-compatible) |
| `MODELSTACK_GATEWAY_API_KEY`   | yes      | never commit, never log |

Any one of the three missing → `modelstack.Unconfigured{}` is wired
in and every Experience surface returns `PROVIDER_UNCONFIGURED`.

## Client version gate

| Variable | Required | Notes |
|----------|----------|-------|
| `PROXY_MIN_APP_VERSION` | no | When set, every `POST /v1/commands/*` and `GET /v1/feed` must carry `X-Proxy-App-Version >= min`; otherwise `426 Upgrade Required` (`/health` + `facet` exempt). Mobile sends `1.0.0` via `Constants.expoConfig.version`. |

## Object storage + Redis

These are read by libraries the API links against, not the binary
itself.

| Variable                  | Required | Notes |
|---------------------------|----------|-------|
| `REDIS_URL`               | yes (idempotency, rate limit, outbox leases) | `redis://host:6379/0` |
| `OBJECT_STORAGE_ENDPOINT` | yes (media upload + playback) | S3-compatible |
| `OBJECT_STORAGE_BUCKET`   | yes      | media quarantine / ready bucket |
| `OBJECT_STORAGE_ACCESS_KEY` | yes    | S3 access key |
| `OBJECT_STORAGE_SECRET_KEY` | yes    | S3 secret key |

## Smoke checks

| Script | Purpose |
|--------|---------|
| `apps/api-go/scripts/smoke_smtp_login.sh` | send a real OTP email and read it back, asserting the full SMTP loop |
| `apps/api-go/scripts/smoke_realdevice_login.sh` | drive the mobile keychain restore end-to-end on a real device |
| `apps/api-go/scripts/smoke_realdevice_keychain.sh` | variant that exercises only the keychain restore path |

## Health probes

| Path | Use |
|------|-----|
| `GET /health/live`  | liveness — process is up |
| `GET /health/ready` | readiness — database pool pinged, idempotency store ready |

The readiness probe degrades to `200 ready` (with `checks` map) when
optional dependencies (Redis) are missing, so a fresh deploy is not
marked unready just because Redis has not been wired. The response
is the source of truth: inspect `checks` before promoting the
instance behind a load balancer.

## Recommended production topology

1. `DATABASE_URL` points at a managed PostgreSQL ≥15 (read replica
   can be added later; the API is single-writer today).
   The API bounds every process pool and periodically checks idle connections;
   use `PROXY_DB_MAX_CONNS` to keep the total across replicas below the database
   or Hyperdrive connection budget.
2. `REDIS_URL` points at a managed Redis ≥6 with persistence off
   (idempotency store is recoverable from `command_id`).
3. SMTP and SMS providers both configured; one is sufficient for
   `BeginPasswordlessAuthentication` to accept users, but having
   both prevents a single provider outage from locking out new
   logins.
4. `PROXY_OPERATOR_PRINCIPALS` is set to a short list of
   human-rotation-on-call principal ids, reviewed quarterly.
5. `MODELSTACK_*` is set; without it the Experience Runtime falls
   back to deterministic stubs and the Market Intelligence Console
   loses its model-routed rankings.
6. `OBJECT_STORAGE_*` points at a private bucket; the API never
   serves public-URL media — every URL is signed at request time.
7. If `PROXY_TRUST_CLOUDFLARE_IP=true`, block direct origin ingress first.
   Otherwise a client can forge the header and evade per-IP controls.

## Rollback

The binary does not migrate the database on startup; migrations are
applied out of band (CI step before the deploy). To roll back the
binary without rolling back the database, re-deploy the previous
binary image. The new image is forward-only with respect to schema
additions: removing a column is gated on a separate migration
version so a previous binary can still read the new schema.
