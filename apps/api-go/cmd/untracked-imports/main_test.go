package main

import (
	"os"
	"path/filepath"
	"testing"
)

// write lays out a fake repo rooted at t.TempDir() and returns the root.
func write(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for name, body := range files {
		full := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", name, err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	return root
}

func TestTrackedFileImportingUntrackedFileLeaks(t *testing.T) {
	root := write(t, map[string]string{
		"apps/mobile/src/native-app.tsx":       "import { Leak } from \"./legal-doc-render\";\n",
		"apps/mobile/src/legal-doc-render.tsx": "export const Leak = 1;\n",
	})
	untracked := map[string]bool{"apps/mobile/src/legal-doc-render.tsx": true}

	leaks := check(root, []string{"apps/mobile/src/native-app.tsx"}, untracked)
	if len(leaks) != 1 {
		t.Fatalf("want 1 leak, got %v", leaks)
	}
	want := `  leak: apps/mobile/src/native-app.tsx imports untracked apps/mobile/src/legal-doc-render.tsx`
	if leaks[0] != want {
		t.Fatalf("leak line changed shape:\n got %q\nwant %q", leaks[0], want)
	}
}

func TestImportOfTrackedFileIsSilent(t *testing.T) {
	root := write(t, map[string]string{
		"a/app.tsx": "import { x } from \"./dep\";\n",
		"a/dep.ts":  "export const x = 1;\n",
	})
	if leaks := check(root, []string{"a/app.tsx"}, map[string]bool{}); len(leaks) != 0 {
		t.Fatalf("tracked import reported as leak: %v", leaks)
	}
}

// A bare `./dir` specifier resolves through index files, and `./x.js` resolves to
// x.ts — the resolver must follow both, or a leak hides behind them.
func TestResolverFollowsIndexAndStripsJsExtension(t *testing.T) {
	root := write(t, map[string]string{
		"a/app.tsx":      "import { p } from \"./pkg\";\nimport { q } from \"./tool.js\";\n",
		"a/pkg/index.ts": "export const p = 1;\n",
		"a/tool.ts":      "export const q = 1;\n",
	})
	untracked := map[string]bool{
		"a/pkg/index.ts": true,
		"a/tool.ts":      true,
	}
	leaks := check(root, []string{"a/app.tsx"}, untracked)
	if len(leaks) != 2 {
		t.Fatalf("want 2 leaks (index + .js alias), got %v", leaks)
	}
}

// `git status --porcelain` lists an entirely-untracked directory as `dir/` and
// omits the files inside it. Expanding it is what makes the per-file lookup hit.
func TestUntrackedDirectoryEntryExpandsToItsFiles(t *testing.T) {
	root := write(t, map[string]string{
		"a/app.tsx":             "import { z } from \"./temp/leak-target\";\n",
		"a/temp/leak-target.ts": "export const z = 1;\n",
	})
	t.Setenv("UNTRACKED_FILES", "a/temp/")
	untracked, err := loadUntracked(root)
	if err != nil {
		t.Fatalf("loadUntracked: %v", err)
	}
	if leaks := check(root, []string{"a/app.tsx"}, untracked); len(leaks) != 1 {
		t.Fatalf("want 1 leak from directory expansion, got %v", leaks)
	}
}

// An empty file list and a wrong REPO_ROOT must both be errors: silent output is
// what "no leaks" looks like, and a checker that read nothing has no right to it.
func TestReportFailsWhenItCouldNotHaveCheckedAnything(t *testing.T) {
	root := write(t, map[string]string{"a/app.tsx": "import { x } from \"./dep\";\n", "a/dep.ts": "\n"})

	if _, err := report(root, nil, map[string]bool{}); err == nil {
		t.Fatal("empty stdin must be an error, not an OK")
	}
	if _, err := report(filepath.Join(root, "does-not-exist"), []string{"a/app.tsx"}, map[string]bool{}); err == nil {
		t.Fatal("REPO_ROOT that resolves no listed file must be an error, not an OK")
	}
	leaks, err := report(root, []string{"a/app.tsx"}, map[string]bool{})
	if err != nil {
		t.Fatalf("readable root must not error: %v", err)
	}
	if len(leaks) != 0 {
		t.Fatalf("tracked import must not leak: %v", leaks)
	}
}

func TestGoImportsAreCheckedToo(t *testing.T) {
	root := write(t, map[string]string{
		"apps/api-go/internal/platform/postgres/business.go": "package postgres\n\nimport \"./helper\"\n",
		"apps/api-go/internal/platform/postgres/helper.go":   "package postgres\n",
	})
	untracked := map[string]bool{"apps/api-go/internal/platform/postgres/helper.go": true}
	leaks := check(root, []string{"apps/api-go/internal/platform/postgres/business.go"}, untracked)
	if len(leaks) != 1 {
		t.Fatalf("want 1 leak, got %v", leaks)
	}
}
