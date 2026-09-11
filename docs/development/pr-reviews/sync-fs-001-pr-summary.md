# SYNC-FS-001: local persistence reads must await File.json() (PR summary)

Branch: `fix/await-file-json` (worktree ~/worktrees/kake-fs-await)
Base: dff1abe (integration HEAD at start, 2026-09-11 09:55)
Supersedes: `hermes/hidden-chats-persist-fix` (HIDDEN-CHATS-001)

## TL;DR

`File.json()` returns a **Promise** on Expo 57. Five local-persistence read
paths consumed it synchronously, so they always received a Promise object:
`Array.isArray(Promise)` is false → every read silently fell back to
defaults. User-visible symptoms: swipe-deleted conversations resurrected
after tab switches, feed prefs / custom channels / creator drafts never
survived a remount. This branch awaits every read and routes parsing
through a pure, unit-tested parse layer.

## What's in the box

- `apps/mobile/src/local-snapshot.ts` (new) — pure parse layer:
  `parseHiddenChatIds` / `parseFolders` / `parseCreatorSnapshot`. Any
  malformed input (including a leaked Promise) collapses to safe defaults.
- `apps/mobile/src/surfaces/messages.tsx` — `readFoldersAsync` /
  `readHiddenChatIdsAsync` (await + parse layer); mount-time hydration
  merges stored state with in-session state instead of clobbering.
- `apps/mobile/src/surfaces/creator-application.tsx` —
  `readCreatorSnapshotAsync` + cancelled-flag hydration effect.
- `apps/mobile/src/expo-feed-prefs-store.ts` — `readFeedPrefsAsync` +
  `parseFeedPrefsSnapshot` / `defaultFeedPrefs` extraction.
- `apps/mobile/src/expo-custom-feed-store.ts` — `readCustomFeedsAsync` +
  `parseCustomFeedsSnapshot`.
- `apps/mobile/src/surfaces/feed.tsx` / `feed-prefs.tsx` / `custom-feed.tsx`
  — switch to async hydration on mount / app-state-active.
- `apps/mobile/src/local-snapshot.test.ts` (new, 3 tests) — parse layer
  behavior incl. Promise input → safe defaults.
- `apps/mobile/src/sync-fs-persist.test.ts` (new, 5 tests) — pins the
  invocation forms: every read path must `await <file>.json()` and route
  through the parse layer; mocks must model the real async API.
- `apps/mobile/src/expo-feed-prefs-store.test.ts` /
  `expo-custom-feed-store.test.ts` — mocks fixed to `async json(): Promise<unknown>`
  (the previous sync mocks were green while real devices broke — pitfall 41
  "fake mock" class), plus one Promise-input regression test each.
- `scripts/check-regression-contracts.sh` — SYNC-FS-001 entry: pinned
  vitest run (local-snapshot + sync-fs-persist) + 6 grep anchors (5 read
  paths + honest-mock check).

## Relationship to HIDDEN-CHATS-001 (supersede rationale)

`hermes/hidden-chats-persist-fix` fixed **one** read path (hidden chats,
via `textSync()`) of the same bug class. This branch fixes **all five**
read paths via await + a shared parse layer, and additionally corrects the
lying mocks (`json()` was mocked sync). Guard tests pin the invocation
form, not the API name, so comments mentioning `File.json()` don't false-
positive. The hidden-chats branch's contract entry should be replaced by
SYNC-FS-001 when merging (do not land both).

## Verification (real runs, this session)

- `pnpm --filter @proxy/contracts build` — PASS (worktree had no dist).
- `pnpm typecheck` — 0 errors.
- `pnpm exec vitest run --run` — **97 files / 829 tests PASS** (before
  this branch: 12 failed suites from unbuilt contracts + 3 real failures
  in expo-custom-feed-store.test.ts still calling the deleted sync API).
- RED→GREEN proof: reverting messages.tsx to `hiddenChatsFile.json() as
  unknown` makes sync-fs-persist.test.ts fail 1/5 and the contract grep
  anchor fires; restoring the fix returns to 8/8 green.
- `bash scripts/check-regression-contracts.sh` — see final run output in
  handoff (SYNC-FS-001: PASS line present).

## Latent risks

- Mount-time hydration means a stale default can flash briefly before the
  stored state lands (first frame renders defaults). Accepted: same
  tradeoff as any async-persist design; write path unchanged.
- `feed.tsx` re-reads prefs on AppState active — now async; a very fast
  background→foreground toggle could interleave two reads. Harmless
  (last-write-wins on state, both read the same file).
- Device verification still pending: the fix needs one real remount cycle
  (delete conversation → switch tab → return) on a device to be marked
  已验·真机 in the QA checklist.

## Review checklist

- [ ] All five read paths show `await <file>.json()` (grep anchors in contract).
- [ ] No new sync `File.json()` consumers anywhere in apps/mobile/src
      (sweep: `grep -rn '\.json()' apps/mobile/src --include='*.ts*' |
      grep -v await | grep -v 'res.json' | grep -v 'r.json' | grep -v test` → 0).
- [ ] HIDDEN-CHATS-001 contract entry removed when landing this branch.
- [ ] design-system-r3 gate (fontSize scan) — not touched by this branch;
      full suite green in this worktree.
