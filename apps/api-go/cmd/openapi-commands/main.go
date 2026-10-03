// Command openapi-commands:
//
// Thin CLI wrapper around internal/openapicmds. Walks every
// apps/api-go/internal/<domain>/service.go, collects the
// (command, domain) pairs, and writes
// apps/api-go/openapi.commands.generated.yaml. With -check, exits 2
// if the working tree's generated file differs from a fresh run
// (drift detection for CI).
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/proxy-app/proxy-api/internal/openapicmds"
)

func main() {
	check := flag.Bool("check", false, "check drift against committed generated fragment")
	flag.Parse()

	repoRoot, err := findRepoRoot()
	if err != nil {
		fmt.Fprintf(os.Stderr, "could not find repo root: %v\n", err)
		os.Exit(1)
	}
	internalDir := filepath.Join(repoRoot, "apps", "api-go", "internal")
	reader := func(path string) (string, error) {
		data, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		return string(data), nil
	}
	files := func(domainDir string) []string {
		candidate := filepath.Join(internalDir, domainDir, "service.go")
		if _, err := os.Stat(candidate); err != nil {
			return nil
		}
		return []string{candidate}
	}
	commands := openapicmds.Collect(reader, files)
	out := openapicmds.RenderFragment(commands)

	outPath := filepath.Join(repoRoot, "apps", "api-go", "openapi.commands.generated.yaml")
	if *check {
		onDisk, err := os.ReadFile(outPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "openapi.commands.generated.yaml not found at %s: %v\n", outPath, err)
			os.Exit(1)
		}
		if strings.TrimSpace(string(onDisk)) != strings.TrimSpace(out) {
			// 提示里写的必须是**现在真能跑的那条命令**。这里原来指
			// `./scripts/generate_openapi_commands.go` —— 那个文件早就不在了，于是照着
			// 提示做的人只会再撞一次"no such file"，而红色的真因（片段没重生成）一个字
			// 都没说。同一类错误在门禁里已经出现过两次（/tmp/account-matrix.mjs、
			// 指向被删 .mjs 的补城市提示）。
			fmt.Fprintln(os.Stderr, "openapi commands drift detected: apps/api-go/openapi.commands.generated.yaml 与代码里的 command 分支不一致。重生成并连同改动一起提交：go -C apps/api-go run ./cmd/openapi-commands")
			os.Exit(2)
		}
		fmt.Printf("openapi commands: %d entries, drift check passed\n", len(commands))
		return
	}
	if err := os.WriteFile(outPath, []byte(out), 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "write %s: %v\n", outPath, err)
		os.Exit(1)
	}
	fmt.Printf("openapi commands: wrote %d entries to %s\n", len(commands), outPath)
}

func findRepoRoot() (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	dir := cwd
	for i := 0; i < 8; i++ {
		// If we ARE apps/api-go (and have a go.mod), walk up to the
		// monorepo root, which is two parents above the api-go
		// module: apps/api-go -> apps -> <root>.
		if filepath.Base(dir) == "api-go" {
			if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
				return filepath.Dir(filepath.Dir(dir)), nil
			}
		}
		// The monorepo root is the directory that contains
		// `apps/api-go`. If we see it as a child, this is the root.
		if _, err := os.Stat(filepath.Join(dir, "apps", "api-go", "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("no monorepo root found above %s", cwd)
		}
		dir = parent
	}
	return "", fmt.Errorf("no monorepo root found above %s", cwd)
}
