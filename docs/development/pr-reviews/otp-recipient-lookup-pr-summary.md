# PR Summary: Thread LoginIdentity.Identifier through the OTP delivery chain

- **Branch**: `hermes/otp-recipient-lookup` (based on `365c761`; clean apply on `2fcf682` — zero overlap with R15.29)
- **Author**: hermes (isolated worktrees; integration area untouched)
- **Patch**: `/tmp/otp-recipient-lookup.patch` (335 lines)

## TL;DR

Both OTP channels were **silently dead in production**. The SMS and EMAIL
challenge providers resolved the delivery recipient via global var lookup
stubs — `lookupPhoneForLoginIdentity` (sms_http_provider.go:259) and
`lookupEmailForLoginIdentity` (otp_helpers.go:95) — both defaulting to
`("", false)`. The registration hooks (`RegisterLookupPhoneHook`,
`RegisterLoginIdentityEmailResolver`) have **zero callers outside tests**
across the whole repo, so the stubs were never swapped for real lookups.
Every production `RequestLoginChallenge` hit the stub → `ok=false` →
fail-closed `ErrLoginChallengeProviderNotReady` → user saw
`LOGIN_PROVIDER_NOT_CONFIGURED`. No code ever got delivered, on either
channel.

The providers' own doc comments state the intended design ("production
callers are expected to thread it through LoginChallengeRequest … The
service layer resolves the address from the LoginIdentity row before
calling") — the service layer just never did it.

## Fix

1. **challenge.go** — `LoginChallengeRequest` gains an `Identifier` field
   (the verified address / E.164 number).
2. **service.go** — both `Request` call sites (`beginPasswordlessAuthentication`
   :251, `requestLoginChallenge` :284) thread `identity.Identifier` /
   `loginIdentity.Identifier` into the provider call. The row is already
   fetched at both sites; no extra queries.
3. **email_smtp_provider.go / email_smtp_multi.go / sms_http_provider.go** —
   `Request` takes the recipient from `req.Identifier` first; the global
   lookup hooks are demoted to a fallback that only direct provider tests
   ever hit. Fail-closed behavior preserved: no identifier + no hook →
   `ErrLoginChallengeProviderNotReady`, never a guess.

No interface changes; `RequestWithRecipient` untouched; channel router
passes the struct through unchanged.

## Tripwires (otp_delivery_tripwire_test.go)

4 tests pin the bug class from both directions:

- `TestRequestLoginChallengeDeliversSMSToUpstream` — full
  service→router→SMS provider→upstream chain: PENDING requires the E.164
  identifier to actually reach the upstream webhook payload.
- `TestRequestLoginChallengeFailsLoudWithoutIdentifier` — blank identifier
  must REJECT, never a silent no-delivery PENDING; upstream must not be
  called.
- `TestRequestLoginChallengeDeliversEmailPastLookup` — EMAIL-side
  `provider.Request` with threaded identifier must pass the old lookup
  choke point and reach the SMTP sink with a 6-digit code.
- `TestRequestWithoutIdentifierFailsClosed` — no identifier + no hook →
  fail-closed error, not a guess.

RED-proven: removing the identifier threading from service.go makes the
SMS chain tripwire fail with REJECTED (the exact production symptom).

## Verification

- `go build ./...` clean; identity package green; full repo `go test ./...`
  29 packages green.
- `go vet`: the only complaints are pre-existing baseline copylocks in
  `internal/experience/runtime/metrics.go` — fixed in the pending
  `hermes/voucher-pg-test-v2` branch, not touched here.

## Notes for commander

- Complements `sms_vendor_adapter.go` (your untracked WIP): that adapter
  consumes the webhook JSON this chain produces — this fix guarantees the
  `to` field carries the verified E.164 identifier, which the mobile
  branch (`hermes/phone-country-code-v2`) also normalizes client-side.
- Suggested landing order: this branch first (delivery chain alive), then
  the vendor adapter wiring, then mobile rebase branch.
