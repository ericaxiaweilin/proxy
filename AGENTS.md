# Proxy multi-agent control rules

This repository uses one integration workspace and isolated agent worktrees.
These rules apply to every coding agent, including Pi, OpenCode, Codex, and
interactive terminal agents.

## Integration workspace

- `/Users/thanhhuyennguyen/proxy` is the integration workspace — this repository.
- `/Users/thanhhuyennguyen/work/kake` is a **stale pre-2026-09-30 copy** (HEAD
  `e958e97`). It does not contain any of the gate or design work done since. Never
  edit, verify, or run anything there: a green result from that tree says nothing
  about this one, which is the exact "silently tests the other tree" failure that
  `scripts/e2e-isolated.sh` exists to prevent.
- Only the designated commander may edit or commit in this workspace.
- All other agents are read-only here. Do not run formatters, generators,
  package installers, commits, rebases, or file edits in this workspace.
- Never restore an older whole file to solve a local issue. Preserve the
  current baseline and patch the smallest owned region.

## Agent work

- Editing agents must use a dedicated Git worktree and branch.
- One task owns one explicit module/file set. Do not edit files outside it.
- Return a commit or patch plus verification output to the commander. Do not
  merge into the integration branch yourself.
- If another change overlaps the owned lines, stop and report the conflict.
- Do not silently fix unrelated failures or include unrelated files in a
  commit.
- Do not symlink `node_modules`, build outputs, caches, DerivedData, or other
  mutable dependency directories from the integration workspace. An isolated
  worktree must use its own dependencies, or leave integration verification to
  the commander.

## Required checks

- Start from a clean worktree and record the starting commit.
- If the assigned starting commit no longer equals the integration HEAD at
  handoff time, stop and report baseline drift. Do not merge, rebase, or copy
  the patch forward autonomously.
- Never weaken, skip, exclude packages from, or append ad-hoc code to a gate in
  order to make a task pass. Gate changes are commander-owned infrastructure
  changes and require their own focused verification.
- A bug that escaped once must receive a stable regression ID, a named test,
  and an entry in `scripts/check-regression-contracts.sh`.
- Mobile changes: run `pnpm --filter @proxy/mobile typecheck` and the relevant
  focused tests.
- Go changes: run focused Go tests and build the affected command/package.
- UI changes must follow `docs/design/CURRENT_BASELINE.json`; archived designs
  are references only and cannot replace the active baseline.
- Device behavior is accepted only after the commander reviews the diff and
  verifies the current bundle on the target device.

## Handoff evidence

- Report starting commit, ending commit, exact changed files, and commands run.
- State the regression ID and the test that failed before and passed after.
- A green unit test is not evidence for an external provider. Email, SMS,
  payment, maps, and other provider work also needs a controlled integration
  smoke result; production credentials and raw OTP values must never be logged.
- The commander rejects handoffs containing untracked source, build binaries,
  unrelated cleanup, duplicated commits, or claims unsupported by output.

## Data and architecture invariants

- App packages contain behavior, not mutable business content. Posts,
  activities, opportunities, orders, and media are server-loaded data.
- Public feed reads must remain usable without an account. Authentication is
  required for write actions, not public browsing.
- Business clients submit model task intent to the model platform; they do not
  bind a provider/model directly.
- Empty wire collections are `[]`, never `null`, when the contract declares an
  array. One malformed media item must not erase an entire feed.
- Data is never deleted by code. Production code must not hard-delete user
  business data (posts, activities, opportunities, orders, profiles, media
  records): user-side cancellations go through state machines (CANCELLED /
  removed flags / visibility scopes) with audit trails kept. Allowed
  exceptions: the actor's own reversals (unfollow, unlike, unpin, deleting
  one's own upload, session logout/revoke) and infra GC (idempotency
  records). Seed paths must be insert-if-absent, never blind overwrite.
- Tests may only delete rows the same test run created (run-scoped IDs +
  `t.Cleanup`). No test may bulk-delete, prefix-delete, or otherwise touch
  production or other tests' rows; prefer isolated databases where available.
