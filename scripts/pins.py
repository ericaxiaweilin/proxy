#!/usr/bin/env python3
"""pins.py — run the regression tripwires in scripts/check-regression-contracts.sh.

    python3 scripts/pins.py --changed [--base REF]   # only the pins for files you changed
    python3 scripts/pins.py --all                    # every step, report EVERY failure at once
    python3 scripts/pins.py --list                   # the step index (what covers what)
    python3 scripts/pins.py --step N                 # one step by index (for a single red pin)

Why this exists
---------------
Two measured problems with running the pin script the only way we could before:

1. **It `exit 1`s at the FIRST failure.** Measured 2026-09-30: a normal run reported
   `658 PASS / 1 FAIL`; the same script with every `exit` neutralised reported
   `834 PASS / 1 FAIL`. One red pin hid ~170 downstream pins. The only way to find the
   next one was to fix this one and wait for the whole thing again.

2. **You cannot run a subset.** `gate.sh` selects whole gate groups (`g1`..`g4`); the pin
   script itself takes minutes. Changing one `.tsx` meant sitting through every pin in
   the repo. With 306 PIN-IDs / 1036 assertions over 452 referenced files, a
   file -> step index is derivable, and it turns "minutes" into "seconds".

Neither mode replaces the gate. `--all` is what you run when you want the truth about
the whole pin suite in one pass; `--changed` is what you run while iterating.

Index cache lives in ~/.cache/proxy-pins/ (keyed by the pin script's sha256), NOT in the
repo: an untracked `.json` in scripts/ would trip g4's workspace-hygiene step.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PIN_SCRIPT = os.path.join(REPO, "scripts", "check-regression-contracts.sh")
CACHE_DIR = os.path.expanduser("~/.cache/proxy-pins")
SEGMENTER_VERSION = 4  # bump when the segmentation or indexing rules change

# ---------------------------------------------------------------------------
# Reading the pin script
# ---------------------------------------------------------------------------


def _code_lines(text: str) -> list[str]:
    """Return one entry per source line, with comments and quoted strings blanked.

    Keyword counting has to ignore `if` inside a string. This file really does contain
    `grep -cF 'if (lastSearchRef.current !== "") return;'` and an awk program with
    `if (wire && ...) exit 0`. Naive `\\bif\\b` counting miscounts those and produces
    wrong block boundaries.
    """
    out: list[str] = []
    buf: list[str] = []
    state = "code"  # code | single | double | comment
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == "\n":
            out.append("".join(buf))
            buf = []
            if state == "comment":
                state = "code"
            i += 1
            continue
        if state == "comment":
            i += 1
            continue
        if state == "single":
            if c == "'":
                state = "code"
                buf.append(" ")
            i += 1
            continue
        if state == "double":
            if c == "\\":
                if i + 1 < n and text[i + 1] == "\n":
                    # A backslash-newline is a continuation inside "..." too. Skipping
                    # the newline without emitting a line is what broke the 1:1
                    # line mapping the first time this was written.
                    buf.append(" ")
                    out.append("".join(buf))
                    buf = []
                    i += 2
                    continue
                i += 2
                continue
            if c == '"':
                state = "code"
                buf.append(" ")
            i += 1
            continue
        if c == "#":
            state = "comment"
            i += 1
            continue
        if c == "'":
            state = "single"
            i += 1
            continue
        if c == '"':
            state = "double"
            i += 1
            continue
        if c == "\\" and i + 1 < n and text[i + 1] == "\n":
            # Line continuation: blank the backslash but KEEP the line break, so the
            # result stays 1:1 with the source and line numbers survive. (Merging the
            # two lines here would silently shift every later line number.)
            buf.append(" ")
            out.append("".join(buf))
            buf = []
            i += 2
            continue
        buf.append(c)
        i += 1
    out.append("".join(buf))
    return out


_OPEN_RE = re.compile(r"(?<![\w-])(if|for|while|case)(?![\w-])")
_CLOSE_RE = re.compile(r"(?<![\w-])(fi|done|esac)(?![\w-])")


def _is_continuation(raw: str, code: str) -> bool:
    r = raw.rstrip()
    if r.endswith("\\"):
        return True
    c = code.rstrip()
    return c.endswith("||") or c.endswith("&&") or c.endswith("|")


def _syntax_ok(script: str) -> bool:
    try:
        p = subprocess.run(
            ["bash", "-n"], input=script, capture_output=True, text=True, timeout=30
        )
        return p.returncode == 0
    except Exception:
        return False


def segment(lines: list[str]) -> tuple[int, list[tuple[int, int]]]:
    """Split the script into (prologue_end, [(start, end), ...]) 0-based inclusive.

    The prologue is everything up to and including the first top-level `}` — in this
    repo that is the closing brace of the `require_test` helper, which every later step
    may call. It also carries `set -u` and the `cd` to the repo root.

    Blocks are found with a string-aware depth counter over `if/for/while/case` vs
    `fi/done/esac`, then each multi-line step is validated with `bash -n` and extended
    if the counter guessed wrong. The validator is the authority, but it is only the
    fallback: a per-step linear `bash -n` scan over 11k lines takes minutes, which is
    exactly the mistake this file's first draft made.
    """
    code = _code_lines("\n".join(lines))
    if len(code) != len(lines):
        raise SystemExit(
            "pins.py: internal error — code/line mapping drifted "
            f"({len(code)} code lines vs {len(lines)} source lines). "
            "Line numbers would be wrong, so refusing to continue."
        )

    prologue_end = 0
    for i, l in enumerate(lines):
        if l.rstrip() == "}":
            prologue_end = i
            break
    prologue = "\n".join(lines[: prologue_end + 1])

    steps: list[tuple[int, int]] = []
    n = len(lines)
    i = prologue_end + 1
    while i < n:
        # leading blank / comment lines belong to the step that follows
        start = i
        j = i
        while j < n and (not lines[j].strip() or lines[j].lstrip().startswith("#")):
            j += 1
        if j >= n:
            break

        depth = 0
        end = j
        while end < n:
            depth += len(_OPEN_RE.findall(code[end])) - len(_CLOSE_RE.findall(code[end]))
            if depth <= 0 and not _is_continuation(lines[end], code[end]):
                break
            end += 1
        if end >= n:
            end = n - 1

        # Multi-line steps get the authoritative check; a single-line step cannot be
        # truncated mid-block, so skip the subprocess there.
        if end > j:
            while end < n - 1 and not _syntax_ok(
                prologue + "\n" + "\n".join(lines[j : end + 1])
            ):
                end += 1

        steps.append((start, end))
        i = end + 1

    return prologue_end, steps


# ---------------------------------------------------------------------------
# Indexing
# ---------------------------------------------------------------------------

_PATH_RE = re.compile(
    r"\b((?:apps|packages|scripts|docs|i18n|contracts)/[A-Za-z0-9_./-]+"
    r"\.(?:go|ts|tsx|js|jsx|mjs|cjs|py|sh|sql|json|md|ya?ml))\b"
)
_GO_PKG_RE = re.compile(r"\./([A-Za-z0-9_./-]+)")
_SRC_RE = re.compile(r"\b(src/[A-Za-z0-9_./-]+\.tsx?)\b")
_ASSIGN_RE = re.compile(r"^\s*([a-z_][a-z0-9_]*)=(?!=)")
_VAR_RE = re.compile(r"\$\{?([a-z_][a-z0-9_]*)\}?")
# IDs appear in two shapes in this script: bracketed (`echo "  FAIL [ORDER-X-001]"`)
# and quoted as the first argument of `require_test "ORDER-X-001" ...`. Missing the
# second shape leaves most `require_test` steps showing "(no PIN-ID)".
_ID_RE = re.compile(r"\[([A-Z][A-Z0-9]*(?:-[A-Z0-9]+){1,6})\]")
_QUOTED_ID_RE = re.compile(r'"([A-Z][A-Z0-9]*(?:-[A-Z0-9]+){1,6})"')


def index_step(text: str) -> dict:
    paths: set[str] = set()
    for m in _PATH_RE.findall(text):
        paths.add(m)
    for m in _GO_PKG_RE.findall(text):
        paths.add("apps/api-go/" + m.rstrip("/"))
    for m in _SRC_RE.findall(text):
        paths.add("apps/mobile/" + m)

    assigns = set()
    reads = set()
    for line in text.split("\n"):
        m = _ASSIGN_RE.match(line)
        if m:
            assigns.add(m.group(1))
        for v in _VAR_RE.findall(line):
            if v not in assigns:
                reads.add(v)

    ids = set(_ID_RE.findall(text))
    if "require_test" in text:
        ids |= set(_QUOTED_ID_RE.findall(text))

    return {
        "paths": sorted(paths),
        "assigns": sorted(assigns),
        "reads": sorted(reads),
        "ids": sorted(ids),
    }


def build_index() -> dict:
    with open(PIN_SCRIPT, "r") as fh:
        raw = fh.read()
    digest = hashlib.sha256(raw.encode()).hexdigest()[:16]
    cache_path = os.path.join(CACHE_DIR, f"index-{digest}-v{SEGMENTER_VERSION}.json")

    if os.path.exists(cache_path):
        try:
            with open(cache_path) as fh:
                cached = json.load(fh)
            if cached.get("hash") == digest:
                return cached
        except Exception:
            pass

    lines = raw.split("\n")
    prologue_end, spans = segment(lines)
    steps = []
    for start, end in spans:
        text = "\n".join(lines[start : end + 1])
        meta = index_step(text)
        meta.update({"start": start + 1, "end": end + 1})
        steps.append(meta)

    index = {
        "hash": digest,
        "lines": len(lines),
        "prologue_end": prologue_end + 1,
        "steps": steps,
    }
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(cache_path, "w") as fh:
            json.dump(index, fh)
    except Exception:
        pass
    return index


# ---------------------------------------------------------------------------
# Coverage: which steps does a changed file touch?
# ---------------------------------------------------------------------------


def _covers(indexed: str, changed: str) -> bool:
    if indexed == changed:
        return True
    # `apps/api-go/internal/fulfillment` covers `apps/api-go/internal/fulfillment/x.go`
    if changed.startswith(indexed.rstrip("/") + "/"):
        return True
    # a changed directory covers every indexed file under it
    if indexed.startswith(changed.rstrip("/") + "/"):
        return True
    return False


def changed_files(base: str | None) -> list[str]:
    out: set[str] = set()
    cmds = [
        ["git", "diff", "--name-only", "--diff-filter=d"],
        ["git", "diff", "--name-only", "--cached", "--diff-filter=d"],
        ["git", "ls-files", "--others", "--exclude-standard"],
    ]
    if base:
        cmds.insert(0, ["git", "diff", "--name-only", "--diff-filter=d", base])
    for cmd in cmds:
        p = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
        if p.returncode == 0:
            for line in p.stdout.split("\n"):
                line = line.strip()
                if line:
                    out.add(line)
    return sorted(out)


def _step_matches(st: dict, pattern: str | None) -> bool:
    if not pattern:
        return True
    if pattern in " ".join(st["ids"]):
        return True
    return any(pattern in p for p in st["paths"])


def _dep_closure(steps: list[dict], selected: set[int]) -> set[int]:
    """Add steps that assign variables the selected steps read.

    Without this a subset run trips `set -u` on a variable whose assignment lives in a
    skipped step, and reports a pin as RED when the pin is perfectly fine. Measured
    2026-09-30: `--only AUTH-DOB-BOUNDS-001` reported a failure because
    `auth_dob_bounds_code` is assigned on the line just above the step that uses it.
    A tool that invents failures is as useless as one that hides them.
    """
    assigner: dict[str, int] = {}
    for i, st in enumerate(steps):
        for v in st["assigns"]:
            assigner.setdefault(v, i)
    grew = True
    while grew:
        grew = False
        for i in sorted(selected):
            for v in steps[i]["reads"]:
                j = assigner.get(v)
                if j is not None and j not in selected and j < i:
                    selected.add(j)
                    grew = True
    return selected


def _select_steps(index: dict, files: list[str]) -> tuple[list[int], list[int], list[str]]:
    """Return (selected step indexes in order, untargetable step indexes, uncovered files)."""
    steps = index["steps"]
    selected: set[int] = set()
    uncovered = set(files)

    for i, st in enumerate(steps):
        hit = False
        for p in st["paths"]:
            for f in files:
                if _covers(p, f):
                    hit = True
                    uncovered.discard(f)
        if hit:
            selected.add(i)

    selected = _dep_closure(steps, selected)

    untargetable = [i for i, st in enumerate(steps) if not st["paths"] and i not in selected]
    return sorted(selected), untargetable, sorted(uncovered)


# ---------------------------------------------------------------------------
# Running
# ---------------------------------------------------------------------------


def _temp_script(
    lines: list[str], keep_ranges: list[tuple[int, int]], neutralise: bool
) -> str:
    """Assemble a runnable script in which `$LINENO` == the ORIGINAL line number.

    Two invariants, both load-bearing:

    * Skipped steps are replaced with BLANK lines, never dropped. The failure report is
      keyed on `$LINENO`, so dropping lines silently re-attributes every failure to some
      unrelated step. (First version dropped them; `--only X` reported failures from a
      completely different pin.)
    * The neutraliser never adds or removes a line, which is why `_FAILED=0` is appended
      to the existing `set -u` line instead of getting its own.

    `keep_ranges` must include the prologue; callers pass it explicitly.
    """
    keep: set[int] = set()
    for start, end in keep_ranges:
        keep.update(range(start, end + 1))

    out: list[str] = []
    for i, l in enumerate(lines):
        if i not in keep:
            out.append("")
            continue
        # the script normally does `cd "$(dirname "$0")/.."`; in a temp file $0 is the
        # temp path, so pin the absolute repo root instead.
        if 'cd "$(dirname "$0")/.."' in l:
            out.append('cd "%s"' % REPO)
            continue
        if neutralise:
            if l.strip() == "exit 1":
                out.append(
                    '{ _FAILED=$(( ${_FAILED:-0} + 1 )); echo ">>> PIN-FAIL@$LINENO"; }'
                )
                continue
            if "|| exit $?" in l:
                out.append(
                    l.replace(
                        "|| exit $?",
                        '|| { _FAILED=$(( ${_FAILED:-0} + 1 )); '
                        'echo ">>> TEST-FAIL@$LINENO"; }',
                    )
                )
                continue
            if l.strip() == "set -u":
                out.append("set -u; _FAILED=0")
                continue
        out.append(l)
    if neutralise:
        # appended past the end, so it cannot shift any real line number
        out.append('echo ">>> TOTAL-FAILURES=$_FAILED"')
    return "\n".join(out)


def run_script(text: str) -> tuple[int, str, str]:
    """Run the assembled script as a FILE, not via `bash -c`.

    This matters for correctness of the whole tool. Measured 2026-09-30:

        printf '#!/bin/bash\\n# c1\\n# c2\\n\\nset -u; _FAILED=0\\necho $LINENO\\n' > /tmp/ln.sh
        bash /tmp/ln.sh          # -> 6   (correct)
        bash -c "$(cat /tmp/ln.sh)"   # -> 5   (one less)

    `bash -c` drops the `#!` line from the count, so every failure would be reported
    against the wrong line — and a report that is off by one is worse than no report,
    because it sends you to edit the wrong pin. The gate runs the script as a file, so
    this also matches how the pin script actually executes.
    """
    fd, path = tempfile.mkstemp(suffix=".sh", prefix="pins-")
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(text)
        p = subprocess.run(["bash", path], cwd=REPO, capture_output=True, text=True)
        return p.returncode, p.stdout, p.stderr
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def _static_failure_meta(lines: list[str]) -> dict[int, dict]:
    """Map `exit` line number -> {kind, message} using the source, not the output.

    Pairing FAIL text with the failure by reading interleaved stdout/stderr is fragile
    (buffering). Reading it out of the source is deterministic.
    """
    meta: dict[int, dict] = {}
    for i, l in enumerate(lines):
        n = i + 1
        s = l.strip()
        if s == "exit 1":
            msg: list[str] = []
            j = i - 1
            while j >= 0:
                prev = lines[j].strip()
                if prev.startswith("echo ") and ">&2" in prev:
                    msg.insert(0, prev)
                    j -= 1
                    continue
                if prev == "" or prev.startswith("#"):
                    j -= 1
                    continue
                break
            meta[n] = {"kind": "PIN", "message": " ".join(msg) or "(no message)"}
        elif "|| exit $?" in l:
            meta[n] = {
                "kind": "TEST",
                "message": l.strip().replace("|| exit $?", "").strip(),
            }
    return meta


def _clean_message(m: str) -> str:
    m = re.sub(r'^echo\s+', "", m)
    m = re.sub(r"\s*>&2\s*$", "", m)
    m = m.strip().strip('"').strip("'")
    m = re.sub(r'"\s*"', " ", m)
    return re.sub(r"\s+", " ", m)


def _collect_markers(out: str) -> list[tuple[int, str]]:
    markers: list[tuple[int, str]] = []
    for line in out.split("\n"):
        m = re.match(r">>> (PIN|TEST)-FAIL@(\d+)", line)
        if m:
            markers.append((int(m.group(2)), m.group(1)))
    return markers


def _report_failures(
    markers: list[tuple[int, str]], index: dict, meta: dict[int, dict]
) -> None:
    for lineno, kind in markers:
        st = next(
            (s for s in index["steps"] if s["start"] <= lineno <= s["end"]), None
        )
        m = meta.get(lineno, {})
        ids = ", ".join(st["ids"][:3]) if st and st["ids"] else "(no PIN-ID)"
        where = f"lines {st['start']}-{st['end']}" if st else "?"
        print(f"  FAIL  {kind:<4} @{lineno:<6} {where:<16} {ids}")
        if m.get("message"):
            print(f"        {_clean_message(m['message'])[:150]}")
        if st and st["paths"]:
            print(f"        touches: {', '.join(st['paths'][:3])}")
        print()


def cmd_all(index: dict, only: str | None = None) -> int:
    with open(PIN_SCRIPT) as fh:
        lines = fh.read().split("\n")
    meta = _static_failure_meta(lines)

    if only:
        picked = {
            i for i, s in enumerate(index["steps"]) if _step_matches(s, only)
        }
        picked = _dep_closure(index["steps"], picked)
        chosen = [index["steps"][i] for i in sorted(picked)]
    else:
        chosen = list(index["steps"])
    prologue = (0, index["prologue_end"] - 1)
    spans = [prologue] + [(s["start"] - 1, s["end"] - 1) for s in chosen]
    text = _temp_script(lines, spans, neutralise=True)
    rc, out, err = run_script(text)

    markers = _collect_markers(out)
    total = re.search(r">>> TOTAL-FAILURES=(\d+)", out)

    passes = len(re.findall(r":\s*PASS\b", out + err))

    print("=" * 78)
    print("pins.py --all   (every step, no early exit)")
    print("=" * 78)
    print(f"  pin script : {os.path.relpath(PIN_SCRIPT, REPO)}  "
          f"({index['lines']} lines, {len(index['steps'])} steps)")
    if only:
        print(f"  filtered   : --only {only}  -> {len(chosen)} step(s)")
    print(f"  assertions : {passes} PASS lines emitted")
    print(f"  failures   : {total.group(1) if total else len(markers)}")
    print()

    if not markers:
        print("  ALL PINS PASS.")
        return 0

    _report_failures(markers, index, meta)
    print(f"  {len(markers)} failing assertion(s). "
          f"Fix all of them before re-running the gate.")
    return 1


def cmd_changed(
    index: dict,
    base: str | None,
    quiet: bool,
    only: str | None = None,
    fail_fast: bool = False,
    verbose: bool = False,
) -> int:
    files = changed_files(base)
    if not files:
        print("pins.py --changed: no changed files (worktree clean) — nothing to run.")
        return 0

    selected, untargetable, uncovered = _select_steps(index, files)
    if only:
        selected = sorted(
            _dep_closure(
                index["steps"],
                {i for i in selected if _step_matches(index["steps"][i], only)},
            )
        )
    steps = index["steps"]

    print("=" * 78)
    print("pins.py --changed   (only the pins that reference your files)")
    print("=" * 78)
    print(f"  changed files : {len(files)}")
    for f in files[:20]:
        print(f"    - {f}")
    if len(files) > 20:
        print(f"    ... and {len(files) - 20} more")
    print()

    if not selected:
        print("  No pin references any changed file.")
        if untargetable:
            print(f"  ({len(untargetable)} step(s) reference no file at all — "
                  f"run `--all` to include them.)")
        return 0

    print(f"  selected {len(selected)} of {len(steps)} steps:")
    for i in selected:
        st = steps[i]
        ids = ", ".join(st["ids"][:2]) if st["ids"] else "(no PIN-ID)"
        print(f"    #{i:<4} lines {st['start']}-{st['end']:<6} {ids}")
    print()

    lines = open(PIN_SCRIPT).read().split("\n")
    spans = [(steps[i]["start"] - 1, steps[i]["end"] - 1) for i in selected]
    prologue = (0, index["prologue_end"] - 1)
    # Neutralised by default: the pin script exits at the FIRST failure, so a fail-fast
    # run tells you about one broken pin and hides the rest — the exact problem this
    # tool exists to remove. --fail-fast opts back into stopping early.
    text = _temp_script(lines, [prologue] + spans, neutralise=not fail_fast)
    rc, out, err = run_script(text)

    if fail_fast:
        sys.stdout.write(out)
        sys.stderr.write(err)
        if rc != 0:
            print(f"\n  FAILED (exit {rc}). --fail-fast stopped at the first failure; "
                  f"the remaining selected steps did NOT run.")
        else:
            print(f"\n  PASS — {len(selected)} step(s) run.")
        if uncovered:
            print(f"  ⚠ no pin references: {', '.join(uncovered[:10])}")
        return rc

    markers = _collect_markers(out)
    passes = len(re.findall(r":\s*PASS\b", out + err))
    if verbose:
        sys.stdout.write(out)
        sys.stderr.write(err)

    print(f"  {passes} PASS line(s) emitted from {len(selected)} selected step(s).")
    print()
    if markers:
        _report_failures(markers, index, _static_failure_meta(lines))
        print(f"  {len(markers)} failing assertion(s) among the pins that cover "
              f"your change.")
    else:
        print("  PASS — no selected pin failed.")

    if untargetable:
        print(f"  note: {len(untargetable)} step(s) reference no file and were skipped; "
              f"`--all` includes them.")
    if uncovered:
        print(f"  ⚠ no pin references: {', '.join(uncovered[:10])}")
        if len(uncovered) > 10:
            print(f"    ... and {len(uncovered) - 10} more")
        print("    (that is a coverage hole, not a pass.)")
    return 1 if markers else 0


def cmd_list(index: dict) -> int:
    print(f"{len(index['steps'])} steps in {os.path.relpath(PIN_SCRIPT, REPO)}")
    print(f"prologue: lines 1-{index['prologue_end']}")
    for i, st in enumerate(index["steps"]):
        ids = ", ".join(st["ids"][:2]) if st["ids"] else ""
        paths = ", ".join(st["paths"][:2]) if st["paths"] else "(no file ref)"
        print(f"  #{i:<4} {st['start']:>6}-{st['end']:<6} {ids:<40} {paths}")
    return 0


def cmd_step(index: dict, n: int) -> int:
    steps = index["steps"]
    if n < 0 or n >= len(steps):
        print(f"step {n} out of range (0..{len(steps) - 1})", file=sys.stderr)
        return 2
    st = steps[n]
    lines = open(PIN_SCRIPT).read().split("\n")
    text = _temp_script(
        lines, [(0, index["prologue_end"] - 1), (st["start"] - 1, st["end"] - 1)],
        neutralise=False,
    )
    print(f"--- step #{n}  lines {st['start']}-{st['end']}  {', '.join(st['ids'])} ---")
    rc, out, err = run_script(text)
    sys.stdout.write(out)
    sys.stderr.write(err)
    print(f"--- exit {rc} ---")
    return rc


def main() -> int:
    ap = argparse.ArgumentParser(
        prog="pins.py",
        description="Run the regression tripwires, targeted or all-at-once.",
    )
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--changed", action="store_true",
                   help="run only the steps referencing files you changed")
    g.add_argument("--all", action="store_true",
                   help="run every step; report every failure in one pass")
    g.add_argument("--list", action="store_true", help="print the step index")
    g.add_argument("--step", type=int, metavar="N", help="run step N only")
    ap.add_argument("--base", help="git ref to diff against (--changed)")
    ap.add_argument("--only", metavar="PATTERN",
                    help="only steps whose PIN-ID or referenced path contains PATTERN")
    ap.add_argument("--script", metavar="PATH",
                    help="run a different pin script (default: the repo's). Useful for "
                         "testing an injection without editing the shared tree.")
    ap.add_argument("--fail-fast", action="store_true",
                    help="--changed: stop at the first failure (default reports all)")
    ap.add_argument("--verbose", action="store_true",
                    help="--changed: also dump the raw pin-script output")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    global PIN_SCRIPT
    if args.script:
        PIN_SCRIPT = os.path.abspath(args.script)

    if not os.path.exists(PIN_SCRIPT):
        print(f"pins.py: {PIN_SCRIPT} not found", file=sys.stderr)
        return 2
    if not shutil.which("bash"):
        print("pins.py: bash not found", file=sys.stderr)
        return 2

    index = build_index()

    if args.list:
        return cmd_list(index)
    if args.all:
        return cmd_all(index, args.only)
    if args.step is not None:
        return cmd_step(index, args.step)
    return cmd_changed(
        index, args.base, args.quiet, args.only, args.fail_fast, args.verbose
    )


if __name__ == "__main__":
    sys.exit(main())
