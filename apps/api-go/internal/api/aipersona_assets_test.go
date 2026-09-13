package api

import (
	"os"
	"path/filepath"
	"testing"
)

// MEDIA-FILE-001 — the second instance, found 2026-09-12 by the logging the
// first instance forced us to add.
//
// The five AI persona photos are static repo files, not media_variants rows, so
// no database sweep can see them. The route resolved them from the bare
// relative path "apps/mobile/assets/ai-personas", which only works when the
// API's working directory is the repo root. scripts/dev-api.sh launches it from
// apps/api-go, so every photo 404'd in the normal dev loop and the home screen
// rendered five empty frames.
//
// This test runs with the package directory (apps/api-go) as its working
// directory, which is exactly the broken case.
func TestResolveRepoDirFindsAssetsFromNestedWorkingDir(t *testing.T) {
	dir := resolveRepoDir("apps/mobile/assets/ai-personas")
	if dir == "" {
		t.Fatal("resolveRepoDir returned an empty path")
	}
	if !filepath.IsAbs(dir) {
		t.Fatalf("resolveRepoDir should return an absolute path, got %q", dir)
	}
	photo := filepath.Join(dir, "photos", "ai_001.png")
	if _, err := os.Stat(photo); err != nil {
		t.Fatalf("ai_001.png not reachable from %q: %v", photo, err)
	}
}

func TestResolveRepoDirFallsBackForUnknownPath(t *testing.T) {
	// Unknown relative paths must degrade to the input rather than panic, so a
	// misconfigured deployment still produces a clean 404 from serveMediaPath.
	if got := resolveRepoDir("does/not/exist"); got != "does/not/exist" {
		t.Fatalf("expected the input to be returned unchanged, got %q", got)
	}
}
