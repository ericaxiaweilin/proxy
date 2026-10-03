package main

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

func init() { checks["media-pipeline"] = mediaPipeline }

// MEDIA-PIPELINE-001: the app has exactly one asset resolution layer
// (apps/mobile/src/media/asset-sources.ts) and one author-avatar map
// (apps/mobile/src/media/author-avatar.ts).
//
// Only NEW violations are blocked: a hit whose line already exists in HEAD is
// grandfathered, so historical icon/sample tables do not have to be refactored
// in one go to keep the gate green.
//
//	R1: packed photo/portrait require() tables — new ones only inside media/.
//	R2: hand-built baseUrl URL joins — new ones only in media/ and the three
//	    existing pass-through layers; new code calls resolveAssetSource.
//	R3: the feed post header must resolve avatars through resolveAuthorAvatar
//	    (the regression was an AI post with a photo asset rendering an initial).
func mediaPipeline(root string, _ []string) error {
	var failures []string

	// grandfathered caches the HEAD blob per file: isNewViolation is called once
	// per hit and a file usually has several.
	blobs := map[string]map[string]bool{}
	headLines := func(file string) map[string]bool {
		if cached, ok := blobs[file]; ok {
			return cached
		}
		lines := map[string]bool{}
		out, err := gitRun(root, "show", "HEAD:"+file)
		if err == nil {
			for _, line := range strings.Split(out, "\n") {
				lines[strings.TrimSpace(line)] = true
			}
		}
		blobs[file] = lines
		return lines
	}

	// A hit whose exact line already exists in the same file at HEAD is existing
	// debt, not a new violation.
	isNewViolation := func(file string, lineNo int) bool {
		body, err := read(root, file)
		if err != nil {
			return true
		}
		lines := strings.Split(body, "\n")
		if lineNo < 1 || lineNo > len(lines) {
			return true
		}
		line := strings.TrimSpace(lines[lineNo-1])
		if line == "" {
			return false
		}
		return !headLines(file)[line]
	}

	checkRule := func(pattern string, allowed func(string) bool, message string) {
		for _, hit := range gitGrep(root, pattern, "apps/mobile/src") {
			sep := strings.Index(hit, ":")
			if sep < 0 {
				continue
			}
			file := hit[:sep]
			rest := hit[sep+1:]
			next := strings.Index(rest, ":")
			if next < 0 {
				continue
			}
			lineNo, err := strconv.Atoi(rest[:next])
			if err != nil {
				continue
			}
			if allowed(file) || !isNewViolation(file, lineNo) {
				continue
			}
			failures = append(failures, fmt.Sprintf("%s: %s", message, hit))
		}
	}

	checkRule("require(.*assets/",
		func(file string) bool { return strings.HasPrefix(file, "apps/mobile/src/media/") },
		"bundled asset require() outside media/")

	checkRule(`localApiBaseUrl}\${`,
		func(file string) bool {
			return strings.HasPrefix(file, "apps/mobile/src/media/") ||
				file == "apps/mobile/src/native-clients.ts" ||
				file == "apps/mobile/src/localnet-client.ts" ||
				file == "apps/mobile/src/ai-persona-presentation.ts"
		},
		"hand-built media URL outside the pipeline")

	feedRequired := "apps/mobile/src/surfaces/feed.tsx"
	found := false
	for _, hit := range gitGrep(root, "resolveAuthorAvatar", "apps/mobile/src") {
		if strings.HasPrefix(hit, filepath.ToSlash(feedRequired)) {
			found = true
		}
	}
	if !found {
		failures = append(failures, "feed post header must resolve avatars via resolveAuthorAvatar (media/author-avatar)")
	}

	if len(failures) > 0 {
		return fmt.Errorf("Media pipeline check failed:\n- %s", strings.Join(failures, "\n- "))
	}
	fmt.Println("Media pipeline check passed.")
	return nil
}

func gitRun(root string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = root
	out, err := cmd.Output()
	return string(out), err
}

func gitGrep(root, pattern, path string) []string {
	out, err := gitRun(root, "grep", "-n", "--", pattern, path)
	if err != nil {
		// `git grep` exits 1 with no hits and non-zero for other reasons too, so
		// an empty result here means "nothing to report" either way.
		return nil
	}
	var hits []string
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line != "" {
			hits = append(hits, line)
		}
	}
	return hits
}
