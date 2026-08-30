# Proxy multi-agent control rules

This repository uses one integration workspace and isolated agent worktrees.
These rules apply to every coding agent, including Pi, OpenCode, Codex, and
interactive terminal agents.

## Integration workspace

- `/Users/thanhhuyennguyen/Desktop/kake` is the integration workspace.
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

## Required checks

- Start from a clean worktree and record the starting commit.
- Mobile changes: run `pnpm --filter @proxy/mobile typecheck` and the relevant
  focused tests.
- Go changes: run focused Go tests and build the affected command/package.
- UI changes must follow `docs/design/CURRENT_BASELINE.json`; archived designs
  are references only and cannot replace the active baseline.
- Device behavior is accepted only after the commander reviews the diff and
  verifies the current bundle on the target device.

## Data and architecture invariants

- App packages contain behavior, not mutable business content. Posts,
  activities, opportunities, orders, and media are server-loaded data.
- Public feed reads must remain usable without an account. Authentication is
  required for write actions, not public browsing.
- Business clients submit model task intent to the model platform; they do not
  bind a provider/model directly.
- Empty wire collections are `[]`, never `null`, when the contract declares an
  array. One malformed media item must not erase an entire feed.

