package main

import (
	"fmt"
	"os/exec"
	"regexp"
	"strings"
)

// span is an inclusive 0-based line range in the pin script.
type span struct{ start, end int }

// funcHeaderRe recognises a top-level shell function definition, which is a
// declaration rather than an assertion and therefore belongs in the prologue.
var funcHeaderRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*\(\)\s*\{`)

// codeLines returns one entry per source line with comments and quoted strings
// blanked. Keyword counting has to ignore `if` inside a string: this repo's pin
// script really does contain `grep -cF 'if (lastSearchRef.current !== "") return;'`
// and an awk program with `if (wire && ...) exit 0`. Naive counting miscounts those
// and produces wrong block boundaries.
//
// The result must stay 1:1 with the input, so line numbers survive. Backslash-newline
// inside a double-quoted string is a continuation: the line break is kept (the
// backslash is blanked) rather than swallowed — merging the two lines shifts every
// later line number, which is the bug this function's first draft had.
func codeLines(text string) []string {
	out := make([]string, 0, strings.Count(text, "\n")+1)
	var buf strings.Builder
	const (
		stateCode = iota
		stateSingle
		stateDouble
		stateComment
	)
	state := stateCode

	runes := []byte(text)
	for i := 0; i < len(runes); {
		c := runes[i]
		if c == '\n' {
			out = append(out, buf.String())
			buf.Reset()
			if state == stateComment {
				state = stateCode
			}
			i++
			continue
		}
		switch state {
		case stateComment:
			i++
			continue
		case stateSingle:
			if c == '\'' {
				state = stateCode
				buf.WriteByte(' ')
			}
			i++
			continue
		case stateDouble:
			if c == '\\' {
				if i+1 < len(runes) && runes[i+1] == '\n' {
					buf.WriteByte(' ')
					out = append(out, buf.String())
					buf.Reset()
					i += 2
					continue
				}
				i += 2
				continue
			}
			if c == '"' {
				state = stateCode
				buf.WriteByte(' ')
			}
			i++
			continue
		}
		// stateCode
		switch {
		case c == '#':
			state = stateComment
			i++
			continue
		case c == '\'':
			state = stateSingle
			buf.WriteByte(' ')
			i++
			continue
		case c == '"':
			state = stateDouble
			buf.WriteByte(' ')
			i++
			continue
		case c == '\\' && i+1 < len(runes) && runes[i+1] == '\n':
			buf.WriteByte(' ')
			out = append(out, buf.String())
			buf.Reset()
			i += 2
			continue
		}
		buf.WriteByte(c)
		i++
	}
	out = append(out, buf.String())
	return out
}

// isKeywordBoundary reproduces the `(?<![\w-])` / `(?![\w-])` guards of the Python
// regexes: Go's RE2 has no look-around, so the neighbours are checked explicitly.
func isKeywordBoundary(b []byte, at, end int) bool {
	beforeOK := at == 0 || !isWordByte(b[at-1])
	afterOK := end >= len(b) || !isWordByte(b[end])
	return beforeOK && afterOK
}

func isWordByte(c byte) bool {
	return c == '_' || c == '-' ||
		(c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

func countKeywords(line string, words []string) int {
	b := []byte(line)
	n := 0
	for _, w := range words {
		for i := 0; i+len(w) <= len(b); {
			j := strings.Index(string(b[i:]), w)
			if j < 0 {
				break
			}
			at, end := i+j, i+j+len(w)
			if isKeywordBoundary(b, at, end) {
				n++
			}
			i = at + 1
		}
	}
	return n
}

func countOpens(line string) int {
	return countKeywords(line, []string{"if", "for", "while", "case"})
}

func countCloses(line string) int {
	return countKeywords(line, []string{"fi", "done", "esac"})
}

func isContinuation(raw, code string) bool {
	if strings.HasSuffix(strings.TrimRight(raw, " \t\r"), "\\") {
		return true
	}
	c := strings.TrimRight(code, " \t\r")
	return strings.HasSuffix(c, "||") || strings.HasSuffix(c, "&&") || strings.HasSuffix(c, "|")
}

// syntaxOk asks bash itself. It is the authority on a guessed block boundary, but
// only the fallback: a per-step linear `bash -n` scan over 11k lines takes minutes,
// which is exactly the mistake the first draft of this tool made.
func syntaxOk(script string) bool {
	cmd := exec.Command("bash", "-n")
	cmd.Stdin = strings.NewReader(script)
	return cmd.Run() == nil
}

// segment splits the script into (prologueEnd, steps).
//
// The prologue is the head region that must run before ANY selected step: `set -u`,
// the `cd` to the repo root, and every helper defined contiguously after the first
// top-level `}`. Helpers matter because the segmenter splits a function body into
// one-line steps (braces are not counted — only if/for/while/case), so a narrowed
// run used to blank out `require_test() {` and its body while keeping the step that
// CALLS it. Measured 2026-10-03: `--only AUTH-OTP-001` on the committed script died
// with `require_test: command not found` and reported two healthy pins as RED. That
// is this tool inventing failures, which it exists to prevent.
func segment(lines []string) (int, []span, error) {
	code := codeLines(strings.Join(lines, "\n"))
	if len(code) != len(lines) {
		return 0, nil, fmt.Errorf(
			"internal error — code/line mapping drifted (%d code lines vs %d source lines). "+
				"Line numbers would be wrong, so refusing to continue.", len(code), len(lines))
	}

	prologueEnd := 0
	for i, l := range lines {
		if strings.TrimRight(l, " \t\r") == "}" {
			prologueEnd = i
			break
		}
	}
	for i := prologueEnd + 1; i < len(lines); {
		for i < len(lines) && (strings.TrimSpace(lines[i]) == "" ||
			strings.HasPrefix(strings.TrimSpace(lines[i]), "#")) {
			i++
		}
		if i >= len(lines) || !funcHeaderRe.MatchString(strings.TrimRight(lines[i], " \t\r")) {
			break
		}
		if strings.HasSuffix(strings.TrimRight(lines[i], " \t\r"), "}") {
			prologueEnd = i
			i++
			continue
		}
		for i < len(lines) && strings.TrimRight(lines[i], " \t\r") != "}" {
			i++
		}
		prologueEnd = i
		i++
	}
	prologue := strings.Join(lines[:prologueEnd+1], "\n")

	var steps []span
	n := len(lines)
	for i := prologueEnd + 1; i < n; {
		// leading blank / comment lines belong to the step that follows
		start := i
		j := i
		for j < n && (strings.TrimSpace(lines[j]) == "" || strings.HasPrefix(strings.TrimSpace(lines[j]), "#")) {
			j++
		}
		if j >= n {
			break
		}

		depth := 0
		end := j
		for end < n {
			depth += countOpens(code[end]) - countCloses(code[end])
			if depth <= 0 && !isContinuation(lines[end], code[end]) {
				break
			}
			end++
		}
		if end >= n {
			end = n - 1
		}

		// Multi-line steps get the authoritative check; a single-line step cannot be
		// truncated mid-block, so skip the subprocess there.
		if end > j {
			for end < n-1 && !syntaxOk(prologue+"\n"+strings.Join(lines[j:end+1], "\n")) {
				end++
			}
		}

		steps = append(steps, span{start: start, end: end})
		i = end + 1
	}
	return prologueEnd, steps, nil
}
