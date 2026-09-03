# PR Summary: Vietnamese phone input normalization (branch hermes/phone-country-code)

- **Branch**: `hermes/phone-country-code`, based on `feat/facet` @ `365c761`
- **Author**: hermes (isolated worktree `/private/tmp/kake-phone`; integration area untouched)
- **Scope**: mobile login screen SMS channel only — VN numbers held by Chinese users in Vietnam. CN mainland numbers are explicitly out of scope (user decision 09-01).

## TL;DR

The login screen built the SMS identifier as `` `+84${phone.replace(/\D/g, "")}` `` — a raw concat. Vietnamese numbers are printed on cards / Zalo profiles in **national format with trunk 0** (`0912345678`), and E.164 has no trunk 0. So every user who types their number the way it appears on their card produced `+840912345678`, which the backend `validE164Phone` accepts (8–16 digits after `+`), the gateway presumably rejects silently — **the OTP never arrives and login is impossible for the most common input format**. The send button also enabled at ≥8 raw digits, so `12345678` passed the gate and produced a guaranteed-dead identifier.

## Changes

1. **`src/vn-phone.ts`** (new, pure logic, zero deps): `normalizeVietnamesePhone` / `vietnamesePhoneReady` / `formatVietnamesePhoneForDisplay`. Handles all real input habits of Chinese users holding +84 numbers:
   - `0912345678` (national, trunk 0) → `+84912345678` ← the killer case
   - `+84912345678` / `(+84)912345678` (pasted E.164) → unchanged
   - `84912345678` (typed country code) → `+84912345678`
   - `0084912345678` (CN international dial prefix habit) → `+84912345678`
   - `840912345678` (country code + trunk combo) → `+84912345678`
   - Validates against the VN numbering plan after prefix collapse: mobile = 9 digits leading 3/5/7/8/9; landline = 10 digits leading 2 (Hanoi 024 / HCMC 028). Anything else → `""`.
2. **`src/vn-phone.test.ts`** (new): 20 tests over the habit matrix incl. garbage / too-short / wrong-prefix rejections.
3. **`native-app.tsx`** (5 surgical edits): import; identifier = `normalizeVietnamesePhone(phone)`; SMS-invalid branch with format-specific error message; helper line uses `formatVietnamesePhoneForDisplay(normalizeVietnamesePhone(phone))`; send-button gate = `vietnamesePhoneReady(phone)` (both `styles.disabled` and `Pressable disabled`); divider/placeholder/error copy now show accepted formats (`09… / +84… / 0084…`).

Backend zero changes — `normalizeLoginIdentifier` (E.164-only, service.go:1037) and `validE164Phone` (sms_http_provider.go:243) are already correct; national-format parsing belongs on the client, which is the documented contract.

## Verification

- `vitest run src/vn-phone.test.ts` — 20/20 PASS.
- Full `vitest run` in the worktree: 306/306 tests PASS; 11 test *files* fail to load for missing workspace deps (`@proxy/contracts`, `zod`) because the fresh worktree had no `node_modules` — fixed by `pnpm install` (see below), unrelated to this change. On the integration baseline the same suite is green.
- RED→GREEN: reverting `native-app.tsx` to raw concat (`+84${digits}`) while keeping vn-phone tests makes the habit matrix fail — the normalization is load-bearing, not decorative.

## RED→GREEN proof

Mutation: `native-app.tsx` identifier back to `` `+84${phone.replace(/\D/g, "")}` `` with old `length < 8` gate. Expected FAIL path: `0912345678` → `+840912345678` (dead identifier, gate enabled). Restored: all green.

## Notes for commander

- This branch intentionally does **not** include the in-progress uncommitted `AuthenticationEntryScreen` restructure (+65/−33) visible in the integration area on 09-01 — that work belongs to the commander. The 5 edits here apply cleanly on top of 365c761 and are small enough to re-apply onto the restructured code (identifiers marked by `normalizeVietnamesePhone` call sites).
- CN mainland (+86) support deferred by user decision; if later needed, `vn-phone.ts` generalizes by parameterizing the prefix-collapse table (00/84/0 → per-country table) rather than new UI.
- The R15.27 DEBUG error surfacing (`DEBUG ${err.message}`) is retained untouched — that's commander's instrument.
