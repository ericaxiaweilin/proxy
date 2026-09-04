# R16.11 Gate Matrix

The pre-R16.11 process relied on three things, in order of how often they
lied to us:

1. `go test ./...` returning exit 0. Exit 0 from `go test` does not mean
   the binary the user actually runs will work. The test binary is built
   with the same source as the real one, but the in-memory repository
   stubs out every line that would have failed against Postgres or
   against a real HTTP client.
2. `echo $?` after a piped command. `$?` is the exit code of the last
   command in the pipe (or zero if the pipe ran with `pipefail`
   disabled), not the exit code of the build / test runner. More than
   once the gate looked green and the binary did not even compile.
3. The operator reading "ALL GATES PASS" from the wrong place (the
   `echo` after a test that never actually ran).

R16.11 replaces all three with one script, `scripts/gate.sh`, plus two
git hooks that invoke the script on every commit and push.

## The four gates

| Gate | What it checks | When it runs |
|------|----------------|--------------|
| **G1 build** | `go -C apps/api-go build ./...` + `pnpm --filter @proxy/mobile typecheck` + `pnpm --filter @proxy/contracts build` | pre-commit, pre-push |
| **G2 tests** | `go -C apps/api-go test -count=1 ./...` (no cache) + `pnpm --filter @proxy/mobile test --run` | pre-commit, pre-push |
| **G3 e2e** | Live HTTP probes against `PROXY_API_BASE_URL` (default `http://127.0.0.1:4100`): `/health/live` then `scripts/privacy-e2e.sh` then `scripts/legal-e2e.sh` | pre-push only |
| **G4 drift** | OpenAPI and semantic invariants; no untracked source/misplaced binaries; escaped-bug regression contracts execute | pre-commit, pre-push |

Each gate's function is written so that a failed command immediately
returns the failing exit code via `cmd || return $?`. We do not rely
on `set -e` inside the function (it does not propagate when the
function is called from `if ! func; then`), and we do not rely on
`echo "OK"` after a command (the next command will still run even if
the first one failed, unless we explicit `|| return`).

## How to install

```bash
bash scripts/install-hooks.sh
```

That sets `core.hooksPath` to `.githooks/`, makes the scripts
executable, and is idempotent.

## How to bypass

Both hooks honour the standard `--no-verify` flag:

```bash
git commit --no-verify -m "wip"
git push --no-verify
```

Use it when you have a documented reason (a stash you are about to
discard, a deploy-only change, an env-var-only change that the
gate cannot see). Do not use it to "commit then fix" — the gate is
there to make you fix the build first.

## How to add a new gate

1. Write a `gate_<name>()` function in `scripts/gate.sh` that returns
   a non-zero exit on failure and zero on success. Use `|| return $?`
   on every external command; do not assume `set -e` will save you.
2. Add a `case` branch in the `for gate in ...` loop.
3. If the gate is slow (anything over a few seconds), put it in
   `pre-push` only. The pre-commit hook is the operator's last
   feedback before they sign the commit, and a 30-second pause
   trains people to use `--no-verify`.
4. Add the new gate to `package.json`'s `gate` script if you want
   `pnpm gate g5` to be the canonical invocation.

## What the gate does NOT check

- Real Postgres migrations against a running database. The
  integration tests run as part of G2, but only if
  `PROXY_INTEGRATION_DB_URL` is set in the environment. The gate
  honours the same convention; the operator is responsible for
  setting the env var before running `pnpm gate` if they want
  integration coverage.
- Mobile-device UX. The mobile tests are unit tests over the
  Vitest harness. Real-device validation is the operator's job
  (the `proxy iPhone 15 QA` simulator is the canonical target).
- The legal document content. The gate loads the legal docs to
  verify the endpoint serves bytes; it does not parse the
  document for "Vietnam PDP Art. 31" mentions. That is a
  compliance review, not a CI gate.

It also does not claim that an external email or SMS provider delivered a
message. `AUTH-OTP-001` protects recipient propagation with controlled sinks;
release evidence must additionally exercise the configured provider without
printing credentials or OTP values.
