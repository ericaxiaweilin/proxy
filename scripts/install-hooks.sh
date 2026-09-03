#!/bin/bash
# R16.11: install the githooks that wire the gate matrix into
# every commit and push. The hook directory is .githooks/ at the
# repo root; we set core.hooksPath to point at it and make the
# scripts executable. The first install also creates a per-repo
# marker file so subsequent `git clone` operations can detect that
# the hooks are intentionally committed.
set -e
cd "$(git rev-parse --show-toplevel)"

if [ ! -d .githooks ]; then
  echo "FAIL: .githooks/ does not exist at the repo root" >&2
  exit 1
fi
chmod +x .githooks/pre-commit .githooks/pre-push
git config core.hooksPath .githooks
echo "  core.hooksPath -> .githooks/"
echo "OK: githooks installed. pre-commit runs g1+g2, pre-push runs all four gates."
