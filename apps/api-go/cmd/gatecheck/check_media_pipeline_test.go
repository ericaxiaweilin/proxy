package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// mediaRepoRoot commits `files` into a throwaway git repository and returns its root.
//
// This gate reads two different trees on purpose: `git grep` scans the tracked working
// tree while `git show HEAD:<file>` supplies the grandfathered lines. A plain
// filesystem fixture therefore cannot exercise it at all — which is exactly the shape of
// the vacuous-green failure this repo keeps hitting, so the helper starts from
// gitRepoRoot (shared with the design baseline test) and commits the baseline.
func mediaRepoRoot(t *testing.T, files map[string]string) string {
	t.Helper()
	root := gitRepoRoot(t)
	for rel, content := range files {
		full := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	gitIn(t, root, "add", "-A")
	gitIn(t, root, "-c", "user.email=t@example.invalid", "-c", "user.name=fixture", "commit", "-q", "-m", "fixture")
	return root
}

// putTrackedFile writes a file and stages it, without committing.
//
// The `git add` is not decoration. `git grep` without --no-index only searches tracked
// paths, so a brand-new file is invisible to this gate until it is in the index. A
// fixture that forgot the add would pass by never seeing its own violation.
func putTrackedFile(t *testing.T, root, rel, content string) {
	t.Helper()
	full := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	gitIn(t, root, "add", "-A")
}

// mediaFeedFile is the file R3 requires to resolve avatars through the one avatar
// layer. Every fixture carries it, so R3 stays green unless it is the rule under test.
const mediaFeedFile = `import { resolveAuthorAvatar } from "../media/author-avatar";
export function FeedPostHeader({ author }) { return resolveAuthorAvatar(author); }
`

const mediaAssetSourcesFile = `export const pack = [require("../assets/icon-home.png")];
`

func requireMediaRed(t *testing.T, root, want string) {
	t.Helper()
	err := mediaPipeline(root, nil)
	if err == nil {
		t.Fatalf("gate stayed green, wanted a failure containing %q", want)
	}
	if !strings.Contains(err.Error(), want) {
		t.Fatalf("gate failed for the wrong reason\nwant substring: %s\ngot: %s", want, err)
	}
}

func requireMediaGreen(t *testing.T, root string) {
	t.Helper()
	if err := mediaPipeline(root, nil); err != nil {
		t.Fatalf("clean fixture failed the gate: %v", err)
	}
}

func TestMediaPipelineAcceptsTheOneResolutionLayer(t *testing.T) {
	root := mediaRepoRoot(t, map[string]string{
		"apps/mobile/src/media/asset-sources.ts": mediaAssetSourcesFile,
		"apps/mobile/src/media/author-avatar.ts": "export function resolveAuthorAvatar(a) { return a.avatar; }\n",
		// The three pass-through layers are allowed to build a baseUrl join.
		"apps/mobile/src/native-clients.ts":          "export const url = `${localApiBaseUrl}${path}`;\n",
		"apps/mobile/src/localnet-client.ts":         "export const url = `${localApiBaseUrl}${path}`;\n",
		"apps/mobile/src/ai-persona-presentation.ts": "export const url = `${localApiBaseUrl}${path}`;\n",
		"apps/mobile/src/surfaces/feed.tsx":          mediaFeedFile,
	})
	requireMediaGreen(t, root)
}

// R1: a new packed-asset require() table outside media/ is what this rule exists for —
// every surface growing its own icon table is how one asset ends up with four
// resolution paths.
func TestMediaPipelineRejectsNewAssetRequireTableOutsideMedia(t *testing.T) {
	root := mediaRepoRoot(t, map[string]string{
		"apps/mobile/src/media/asset-sources.ts": mediaAssetSourcesFile,
		"apps/mobile/src/surfaces/feed.tsx":      mediaFeedFile,
	})
	putTrackedFile(t, root, "apps/mobile/src/surfaces/shop-card.tsx",
		"export const icons = [require('../../assets/icon-cart.png')];\n")
	requireMediaRed(t, root, "bundled asset require() outside media/")
}

// R2: hand-built baseUrl joins belong to the pipeline and its pass-through layers only.
// A new one elsewhere means a media URL is assembled without those rules.
func TestMediaPipelineRejectsNewHandBuiltMediaUrl(t *testing.T) {
	root := mediaRepoRoot(t, map[string]string{
		"apps/mobile/src/media/asset-sources.ts": mediaAssetSourcesFile,
		"apps/mobile/src/surfaces/feed.tsx":      mediaFeedFile,
	})
	putTrackedFile(t, root, "apps/mobile/src/surfaces/album-grid.tsx",
		"export const src = `${localApiBaseUrl}${asset.path}`;\n")
	requireMediaRed(t, root, "hand-built media URL outside the pipeline")
}

// R3: the feed header is the regression this gate was written for — an AI post that had
// a photo asset rendered an initial because the header stopped asking the avatar layer.
func TestMediaPipelineRejectsFeedHeaderBypassingAvatarLayer(t *testing.T) {
	root := mediaRepoRoot(t, map[string]string{
		"apps/mobile/src/media/asset-sources.ts": mediaAssetSourcesFile,
		"apps/mobile/src/media/author-avatar.ts": "export function resolveAuthorAvatar(a) { return a.avatar; }\n",
		"apps/mobile/src/surfaces/feed.tsx":      mediaFeedFile,
	})
	putTrackedFile(t, root, "apps/mobile/src/surfaces/feed.tsx",
		"export function FeedPostHeader({ author }) { return author.name.slice(0, 1); }\n")
	requireMediaRed(t, root, "resolveAuthorAvatar")
}

// Grandfathering is the half most likely to rot: a line that already exists at HEAD must
// not block unrelated work, but a line that does not must. The two cases differ only by
// whether HEAD carries them, so they belong in one test.
func TestMediaPipelineGrandfersExistingDebtOnly(t *testing.T) {
	debt := "export const legacy = [require('../../assets/icon-old.png')];\n"
	root := mediaRepoRoot(t, map[string]string{
		"apps/mobile/src/media/asset-sources.ts":    mediaAssetSourcesFile,
		"apps/mobile/src/surfaces/legacy-icons.tsx": debt,
		"apps/mobile/src/surfaces/feed.tsx":         mediaFeedFile,
	})
	requireMediaGreen(t, root)

	// One added line that HEAD does not have: exactly that one may be reported.
	putTrackedFile(t, root, "apps/mobile/src/surfaces/legacy-icons.tsx",
		debt+"export const fresh = [require('../../assets/icon-fresh.png')];\n")
	err := mediaPipeline(root, nil)
	if err == nil {
		t.Fatal("a newly added require() line passed as existing debt")
	}
	if got := strings.Count(err.Error(), "bundled asset require() outside media/"); got != 1 {
		t.Fatalf("grandfathering reported %d violations, wanted exactly the 1 new one:\n%s", got, err)
	}
}

// An unscanned tree must not read as a clean pipeline. git grep with no hits and git
// grep failing look identical from the call site, so the one rule that asserts something
// *must exist* (R3) is what catches a scan that read nothing.
func TestMediaPipelineFailsWhenNothingWasScanned(t *testing.T) {
	root := mediaRepoRoot(t, map[string]string{
		"apps/mobile/src/surfaces/feed.tsx": mediaFeedFile,
	})
	if err := os.RemoveAll(filepath.Join(root, "apps")); err != nil {
		t.Fatal(err)
	}
	requireMediaRed(t, root, "resolveAuthorAvatar")
}

// Guards the harness itself: if the fixture were not greppable, every case above would
// fail for the wrong reason and the suite would still report a number of greens.
func TestMediaPipelineFixtureIsReallyGreppable(t *testing.T) {
	root := mediaRepoRoot(t, map[string]string{
		"apps/mobile/src/surfaces/feed.tsx": mediaFeedFile,
	})
	out, err := exec.Command("git", "-C", root, "grep", "-n", "--",
		"resolveAuthorAvatar", "apps/mobile/src").Output()
	if err != nil {
		t.Fatalf("the fixture cannot be git-grepped, so these gate tests prove nothing: %v", err)
	}
	if !strings.Contains(string(out), "surfaces/feed.tsx") {
		t.Fatalf("git grep returned %q, expected the feed file", out)
	}
	// And an untracked file really is invisible — the assumption putTrackedFile's
	// `git add` is there to satisfy.
	putRaw := filepath.Join(root, "apps/mobile/src/surfaces/untracked.tsx")
	if err := os.WriteFile(putRaw, []byte("export const x = require('../../assets/a.png');\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if hits := gitGrep(root, "require(", "apps/mobile/src"); strings.Contains(strings.Join(hits, "\n"), "untracked.tsx") {
		t.Fatal("git grep saw an untracked file, so the staging step in this suite is unnecessary")
	}
}
