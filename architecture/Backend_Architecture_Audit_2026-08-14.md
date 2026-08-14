# Backend Architecture Audit — 2026-08-14

## Scope

Go API command boundary, Identity, Demand, PostgreSQL adapters, idempotency, transactional Outbox, and the mobile Requester Demand flow were reviewed against the accepted ADRs and the Requester Experience contract.

## Findings closed in this change

### P0 — Protected commands could fail open without an authenticator

The API only authenticated protected commands when an authenticator happened to be configured. In local-memory mode, clients could therefore supply authoritative `actor` and `principal` fields.

Resolution:

- protected commands now return `AUTHENTICATION_UNAVAILABLE` when no authenticator exists;
- local and PostgreSQL API wiring both use the Identity service as the authenticator;
- authenticated session actor, principal, and auth context continue to override client hints.

### P0 — Idempotency completion was outside the domain transaction

The PostgreSQL path committed aggregate state and Outbox events before storing the completed idempotency result. A completion failure could leave the client with an unknown result after a successful mutation.

Resolution:

- added an ambient PostgreSQL command Unit of Work;
- idempotency claim/completion, domain reads/writes, token rotation, and Outbox publication now share the same transaction;
- repository-local transactions reuse the ambient transaction and retain standalone behavior for direct adapter use.

### P1 — Preview incorrectly required irreversible publish confirmations

`PreviewTaskDraft` required scope, material-change, and funding confirmations, coupling exploration to publication.

Resolution:

- preview validates executable demand fields only;
- `PublishTask` remains fail-closed until all explicit confirmations are present;
- material changes continue to reset prior confirmations.

### P1 — Command transport accepted oversized and ambiguous JSON

Resolution:

- command bodies are capped at 1 MiB;
- unknown envelope fields and trailing JSON values are rejected.

### P1 — Mobile App stopped at an authenticated shell

Resolution:

- implemented Requester Cockpit, truthful empty states, contextual inspiration, Need Capture, solution preview, explicit confirmation, and honest `PENDING`/`COMMITTED` progress;
- implemented an authenticated Demand client using the Keychain/Keystore-backed session identity;
- added pure form-to-contract translation and tests.

## Remaining production gates

- Add PostgreSQL integration tests proving rollback across idempotency, aggregate, and Outbox tables.
- Add a server-backed Requester Home read model so in-progress needs survive app restarts.
- Replace in-memory mobile Draft persistence with approved SQLite storage.
- Add canonical Task / TaskSlot tables rather than retaining committed slots in draft JSON.
- Configure production login, Admission, Funding, notification, and downstream event delivery providers.
- Add OpenAPI generation/drift checks and device-level E2E tests.

These are explicitly tracked as production-readiness work; the UI does not represent them as completed capabilities.
