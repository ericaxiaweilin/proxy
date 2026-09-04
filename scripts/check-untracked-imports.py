#!/usr/bin/env python3
"""
R16.7 audit followup: 'can't hold the line' (总守不住) pattern.

The bot's 931a755 commit left native-app.tsx importing
legal-doc-render.tsx (and that file importing legal-doc-parser.ts) —
all three of which were UNTRACKED in git. The app typechecked and
tests passed on the developer's machine because the files existed
on disk, but a fresh clone, a CI checkout, or another agent's
`git reset --hard` would break the build. The gate must catch this:
any source file imported from a tracked file must itself be tracked.

This script reads the list of tracked source files (from stdin, one
per line) and prints lines of the form

  leak: <importer> imports untracked <imported>

for every leak. Exits 0 with no output when no leaks are found.
"""
import os
import re
import sys

def main():
    tracked = set()
    for line in sys.stdin:
        f = line.strip()
        if f:
            tracked.add(f)

    # Discover untracked files via git. This is invoked by gate.sh
    # via the env-var pattern so we don't have to spawn git from here.
    # `git status --porcelain` shows directories as `?? dir/` (with
    # a trailing slash) when nothing inside is tracked. We expand
    # such entries to all files within the directory so the
    # per-file leak lookup hits. We also strip the trailing slash
    # so `'apps/mobile/src/_test_temp/' in untracked_set` matches
    # `'apps/mobile/src/_test_temp/leak-target.ts'`.
    untracked = set()
    for entry in filter(None, os.environ.get("UNTRACKED_FILES", "").split("\n")):
        untracked.add(entry.rstrip("/"))
        # If the entry is a directory, expand to its files.
        if os.path.isdir(entry):
            for root, _, files in os.walk(entry):
                for f in files:
                    untracked.add(os.path.join(root, f))

    # Match: from "./..."   require("./...")   from "../..."
    # Plus side-effect imports: import "./..."  (used for css / polyfills)
    import_re = re.compile(r"""(?:from|require|import)\s+["\'](\.[^"\']+)["\']""")

    leaks = []
    for src in tracked:
        if not src.endswith((".ts", ".tsx", ".go")):
            continue
        try:
            body = open(src).read()
        except Exception:
            continue
        for imp in import_re.findall(body):
            srcdir = os.path.dirname(src)
            target = imp
            if target.endswith(".js"):
                target = target[:-3]
            for ext in ("", ".ts", ".tsx", "/index.ts", "/index.tsx", ".go"):
                cand = os.path.normpath(os.path.join(srcdir, target + ext))
                if os.path.isfile(cand):
                    if cand in untracked:
                        leaks.append(f"  leak: {src} imports untracked {cand}")
                    break

    if leaks:
        print("\n".join(leaks))


if __name__ == "__main__":
    main()
