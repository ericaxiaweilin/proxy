-- 109_account_status_erased.sql
-- LC-15 (Vietnam PDP 91/2025/QH15 Art. 32) — the terminal state of an
-- erased account.
--
-- identity_user_status_check (migration 049) already carries a DELETED
-- value, and it would have been tempting to reuse it. It is the wrong
-- word here. DELETED describes a product action ("the user deleted
-- their account") and says nothing about whether the rows behind it
-- still exist. The erasure path deliberately KEEPS the
-- identity.user_accounts row — business.accounts.owner_user_id is
-- ON DELETE RESTRICT (migration 049) and the payment / order ledgers
-- reference the account for the statutory retention window — so
-- reusing DELETED would conflate "row gone" with "row kept, data
-- wiped". ERASED is that second state, and DELETED stays free for its
-- own meaning.
--
-- This value is also the enforcement point for the erasure:
-- identity.canHoldSession in apps/api-go/internal/identity/service.go
-- excludes ERASED, so an erased account can never authenticate again.
-- Adding ERASED to that allowlist would silently resurrect erased
-- accounts; internal/identity/privacy_erasure_sweep_test.go fails if
-- anyone does.
--
-- NOT VALID matches migration 049's own style: the set only grew, but
-- the previous constraint was never validated against pre-existing
-- rows, so validating now could fail on a dev database for reasons
-- that have nothing to do with this change. New writes are still
-- checked.
ALTER TABLE identity.user_accounts
    DROP CONSTRAINT IF EXISTS identity_user_status_check;
ALTER TABLE identity.user_accounts
    ADD CONSTRAINT identity_user_status_check
    CHECK (status IN ('ANONYMOUS','REGISTERED','ACTIVE','VERIFIED','COMMERCIAL_VERIFIED','SUSPENDED','DELETED','ERASED')) NOT VALID;
