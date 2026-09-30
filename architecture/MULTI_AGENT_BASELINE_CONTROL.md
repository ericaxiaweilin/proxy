# Multi-agent baseline control

## Why the workspace lost control

On 2026-08-30, two Pi sessions and one OpenCode session remained active for
hours against the same checkout and branch. They repeatedly changed the same
Feed gesture code and committed directly. The filter rail implementation was
rewritten multiple times, including a TypeScript-invalid responder signature
and a later implementation that captured vertical movement. Git was working;
there was no single writer, ownership boundary, or integration gate.

## Operating model

1. The desktop `proxy` checkout is the integration workspace and has one writer:
   the commander. (The older `kake` checkout is a superseded copy of this same
   history — its HEAD is an ancestor of `origin/main` with zero unique commits.
   Do not treat it as the integration workspace.)
2. External agents inspect the integration workspace read-only.
3. An agent that must edit receives an isolated worktree, branch, objective,
   and explicit file allowlist.
   Mutable dependency/cache directories must not be shared with the integration
   workspace through symlinks.
4. The agent returns a patch/commit and evidence. The commander reviews and
   selectively integrates it.
5. Only the commander runs integration tests, updates the true device, and
   creates a baseline tag.

## Dispatch checklist

- Record integration HEAD and require a clean status.
- State the exact module and allowed files.
- State active design references and forbidden legacy references.
- State data/API invariants that cannot change.
- Require focused tests; do not authorize broad cleanup.
- Never allow autonomous commits in the integration workspace.

## Integration checklist

- Confirm the agent started from the assigned commit.
- Inspect the complete diff, including generated files.
- Reject unrelated changes and whole-file regressions.
- Rebase/cherry-pick only after overlap review.
- Run type/build/tests in the integration workspace.
- Verify server-loaded data independently from the app bundle.
- Reload the current true-device bundle and inspect the requested flow.
- Commit one coherent change and create/update the approved baseline tag.

## Regression closure protocol

Every production regression gets a stable ID and moves through four states:

1. `REPRODUCED`: a focused test fails for the reported behavior.
2. `FIXED`: the smallest production patch makes that same test pass.
3. `INTEGRATED`: the named test is registered in
   `scripts/check-regression-contracts.sh` and all gates pass from a clean tree.
4. `VERIFIED`: external-provider or device behavior has controlled smoke
   evidence when the bug crosses a process or network boundary.

Agents may not call a regression closed at `FIXED`. If the same symptom returns,
reopen the existing ID first; do not create another anonymous `fix(...)` patch.

## Current recovery scope

The recovery baseline keeps the global chronological public Feed, guest media
read fix, full-width timeline layout, and a single filter-rail horizontal
gesture owner. Nested responder callbacks that capture every move are not part
of the baseline.
