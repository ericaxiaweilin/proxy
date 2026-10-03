// Command untracked-imports fails the gate when a *tracked* source file imports
// a file that is not tracked in git: the build then works on the author's disk
// and breaks on a fresh clone, a CI checkout, or `git reset --hard`.
//
// stdin  : tracked source files, repo-root-relative, one per line.
// env    : UNTRACKED_FILES — `git status --porcelain` entries (a directory is
//
//	listed with a trailing slash and stands for every file inside it),
//	REPO_ROOT — the directory the relative paths are resolved against.
//
// stdout : one line per leak, `  leak: <importer> imports untracked <imported>`.
//
// Exit status is 0 even when leaks are found — the caller judges the *output*.
// "The checker did not run" must not look like "there are no leaks", so any real
// failure is a non-zero exit with a message on stderr.
package main

import (
	"bufio"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var importPattern = regexp.MustCompile(`(?:from|require|import)\s+["'](\.[^"'\n]+)["']`)

// The extensions a bare relative specifier can resolve to, in the order the
// resolver tries them (first hit wins).
var candidateExtensions = []string{"", ".ts", ".tsx", "/index.ts", "/index.tsx", ".go"}

func main() {
	repoRoot := os.Getenv("REPO_ROOT")
	if repoRoot == "" {
		repoRoot = "."
	}
	untracked, err := loadUntracked(repoRoot)
	if err != nil {
		fmt.Fprintf(os.Stderr, "untracked-imports: %v\n", err)
		os.Exit(1)
	}

	lines, err := report(repoRoot, trackedFromStdin(), untracked)
	if err != nil {
		fmt.Fprintf(os.Stderr, "untracked-imports: %v\n", err)
		os.Exit(1)
	}
	if len(lines) > 0 {
		fmt.Println(strings.Join(lines, "\n"))
	}
}

// report returns the leak lines, or an error when the check itself could not
// have looked at anything. Empty output must only ever mean "no leaks".
func report(repoRoot string, tracked []string, untracked map[string]bool) ([]string, error) {
	if len(tracked) == 0 {
		return nil, fmt.Errorf("no tracked source files on stdin — there was nothing to check, which is not the same as a clean repo")
	}
	if !anyReadable(repoRoot, tracked) {
		// `go -C` runs the child in the module directory, so a relative REPO_ROOT
		// silently resolves nothing and would read as OK.
		return nil, fmt.Errorf("REPO_ROOT=%q resolves none of the %d listed files — the checker ran but read nothing", repoRoot, len(tracked))
	}
	return check(repoRoot, tracked, untracked), nil
}

func anyReadable(repoRoot string, tracked []string) bool {
	for _, src := range tracked {
		if _, err := os.Stat(filepath.Join(repoRoot, src)); err == nil {
			return true
		}
	}
	return false
}

func trackedFromStdin() []string {
	var tracked []string
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		if line := strings.TrimSpace(scanner.Text()); line != "" {
			tracked = append(tracked, line)
		}
	}
	return tracked
}

func check(repoRoot string, tracked []string, untracked map[string]bool) []string {
	var leaks []string
	for _, src := range tracked {
		switch filepath.Ext(src) {
		case ".ts", ".tsx", ".go":
		default:
			continue
		}
		body, err := os.ReadFile(filepath.Join(repoRoot, src))
		if err != nil {
			continue
		}
		for _, match := range importPattern.FindAllStringSubmatch(string(body), -1) {
			if leak := resolveLeak(repoRoot, src, match[1], untracked); leak != "" {
				leaks = append(leaks, leak)
			}
		}
	}
	return leaks
}

// resolveLeak returns a leak line when the specifier resolves to a file on disk
// that git does not track, and "" when it resolves to a tracked (or absent) file.
func resolveLeak(repoRoot, src, specifier string, untracked map[string]bool) string {
	base := strings.TrimSuffix(specifier, ".js")
	dir := filepath.Dir(src)
	for _, ext := range candidateExtensions {
		candidate := filepath.Join(repoRoot, dir, base+ext)
		info, err := os.Stat(candidate)
		if err != nil || info.IsDir() {
			continue
		}
		rel, err := filepath.Rel(repoRoot, candidate)
		if err != nil {
			rel = candidate
		}
		if untracked[rel] {
			return fmt.Sprintf("  leak: %s imports untracked %s", src, rel)
		}
		return ""
	}
	return ""
}

func loadUntracked(repoRoot string) (map[string]bool, error) {
	untracked := map[string]bool{}
	entries := strings.Split(os.Getenv("UNTRACKED_FILES"), "\n")
	for _, entry := range entries {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		untracked[strings.TrimRight(entry, "/")] = true
		info, err := os.Stat(filepath.Join(repoRoot, entry))
		if err != nil || !info.IsDir() {
			continue
		}
		// `?? dir/` means nothing inside is tracked: expand it, or the per-file
		// lookup below would miss the exact file the import resolves to.
		err = filepath.WalkDir(filepath.Join(repoRoot, entry), func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			rel, relErr := filepath.Rel(repoRoot, path)
			if relErr == nil {
				untracked[rel] = true
			}
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("expand untracked directory %q: %w", entry, err)
		}
	}
	return untracked, nil
}
