package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

func init() { checks["hooks-not-in-conditional"] = hooksNotInConditional }

// MOBILE-HOOKS-001: a React hook must not sit where a conditional can skip it.
//
// Cause (2026-10-01): a `useMemo` was placed inside the `{(() => { ... })()}`
// conditional IIFE that renders JSX. That IIFE does not run on every render, so
// the hook count changed between renders and React threw
//
//	Rendered more hooks than during the previous render.
//
// tsc passed, vitest passed, Babel parsed it, Metro bundled it — four green
// gates, and only the device failed. So this check looks at static shape: the
// call must be at component-body depth, not inside if / ternary / && / IIFE /
// callback. It is not the full lint rule; it covers the shape that actually
// happened.
func hooksNotInConditional(root string, _ []string) error {
	hookCall := regexp.MustCompile(`\b(use[A-Z]\w*)\s*\(`)
	isAssignment := regexp.MustCompile(`=\s*use[A-Z]\w*\s*\(`)
	isReturn := regexp.MustCompile(`^\s*return\s+use[A-Z]`)
	isBareStatement := regexp.MustCompile(`^\s*use[A-Z]\w*\s*\(`)

	srcDir := filepath.Join(root, "apps/mobile/src")
	var files []string
	err := filepath.WalkDir(srcDir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		name := entry.Name()
		if (strings.HasSuffix(name, ".ts") || strings.HasSuffix(name, ".tsx")) && !strings.HasSuffix(name, ".d.ts") {
			files = append(files, path)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("cannot scan %s: %w", srcDir, err)
	}
	sort.Strings(files)

	type problem struct {
		file, hook, text string
		line             int
		indent           int
	}
	var problems []problem
	// candidates counts every hook call in a shape the rule cares about, at any
	// indent. It is the never-empty discriminator: a scan that saw no hook call at
	// all did not read the app's source tree, and "nothing scanned" must not be
	// reported as "nothing wrong".
	candidates := 0

	for _, path := range files {
		body, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("cannot read %s: %w", path, err)
		}
		rel := strings.TrimPrefix(path, root+"/")
		for i, line := range strings.Split(string(body), "\n") {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "//") || strings.HasPrefix(trimmed, "*") || strings.HasPrefix(trimmed, "/*") {
				continue
			}
			match := hookCall.FindStringSubmatch(line)
			if match == nil {
				continue
			}
			if !isAssignment.MatchString(line) && !isReturn.MatchString(line) && !isBareStatement.MatchString(line) {
				continue
			}
			candidates++
			indent := len(line) - len(strings.TrimLeft(line, " \t\r\n"))
			// Component-body top level in this codebase is 2 or 4 spaces; anything
			// deeper is inside a block, and a block can be skipped.
			if indent > 4 {
				text := trimmed
				if runes := []rune(text); len(runes) > 90 {
					text = string(runes[:90])
				}
				problems = append(problems, problem{file: rel, line: i + 1, hook: match[1], text: text, indent: indent})
			}
		}
	}

	if len(files) == 0 || candidates == 0 {
		return fmt.Errorf(
			"hook scan read %d files and %d hook calls from %s — an RN app has hooks, so this is the scanner not finding the tree, not a clean scan",
			len(files), candidates, srcDir)
	}

	for _, p := range problems {
		fmt.Fprintf(os.Stderr, "FAIL %s:%d %s() 缩进 %s\n", p.file, p.line, p.hook, p.text)
	}
	fmt.Printf("%d 个文件 · %d 处 hook 可能不在顶层\n", len(files), len(problems))
	if len(problems) > 0 {
		return fmt.Errorf("%d hook calls are not at component top level", len(problems))
	}
	return nil
}
