package main

// Regression tests for the toolchain gates that used to be Node scripts
// (scripts/check-*.mjs). They exist because "the ported check is green on the
// current repo" proves nothing: a checker that cannot read its input is also
// green. Each case here builds a fixture root and asserts the direction — the
// control fixture must pass, every broken fixture must turn the gate red.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFixture(t *testing.T, root, rel, body string) {
	t.Helper()
	path := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// fixtureRoot builds a throwaway repository tree. Every source-shape gate reads a
// fixed set of repo-relative paths, so a fixture is the only way to prove the gate
// can still go red — the real repo is, by definition, already green.
func fixtureRoot(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for rel, body := range files {
		writeFixture(t, root, rel, body)
	}
	return root
}

// MOBILE-HOOKS-001: the shape that actually shipped on 2026-10-01 — a useMemo
// inside the conditional `{(() => { ... })()}` that renders JSX. tsc, vitest,
// Babel and Metro were all green; only the device threw
// "Rendered more hooks than during the previous render".
func TestHooksGateFlagsConditionalIIFEHook(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "apps/mobile/src/surfaces/requester-home.tsx", `export function RequesterHome({
  myOrders,
}: Props) {
  const distinctTimes = useMemo(() => times(activities), [activities]);

  return (
    <View>
      {distinctTimes.length > 0 && (
        (() => {
          const availableTimes = useMemo(
            () => distinctTimes.filter((time) => !conflicts(time, myOrders)),
            [distinctTimes, myOrders]
          );
          return <SlotList times={availableTimes} />;
        })()
      )}
    </View>
  );
}
`)

	err := hooksNotInConditional(root, nil)
	if err == nil {
		t.Fatal("hooks gate passed on a hook inside a conditional IIFE — the exact escape it exists for")
	}
	if !strings.Contains(err.Error(), "1 hook calls") {
		t.Fatalf("hooks gate failed for the wrong reason: %v", err)
	}
}

func TestHooksGateAcceptsTopLevelHooks(t *testing.T) {
	root := t.TempDir()
	writeFixture(t, root, "apps/mobile/src/surfaces/requester-home.tsx", `export function RequesterHome({ myOrders }: Props) {
  const distinctTimes = useMemo(() => times(activities), [activities]);
  const availableTimes = useMemo(
    () => distinctTimes.filter((time) => !conflicts(time, myOrders)),
    [distinctTimes, myOrders]
  );
  return <SlotList times={availableTimes} />;
}
`)
	if err := hooksNotInConditional(root, nil); err != nil {
		t.Fatalf("hooks gate rejected component-top-level hooks: %v", err)
	}
}

// The vacuity guard: pointing the gate at a tree that is not the app must be a
// failure, not a pass. Without this, moving apps/mobile/src turns MOBILE-HOOKS-001
// into a no-op that prints nothing and exits 0.
func TestHooksGateRejectsEmptyScan(t *testing.T) {
	t.Run("src dir exists but holds no sources", func(t *testing.T) {
		root := t.TempDir()
		if err := os.MkdirAll(filepath.Join(root, "apps/mobile/src"), 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		err := hooksNotInConditional(root, nil)
		if err == nil {
			t.Fatal("hooks gate passed while scanning zero files")
		}
		if !strings.Contains(err.Error(), "0 files") {
			t.Fatalf("unexpected failure: %v", err)
		}
	})

	t.Run("src dir holds sources with no hooks", func(t *testing.T) {
		root := t.TempDir()
		writeFixture(t, root, "apps/mobile/src/utils/format.ts", "export function money(v: number) {\n  return `$${v}`;\n}\n")
		err := hooksNotInConditional(root, nil)
		if err == nil {
			t.Fatal("hooks gate passed while seeing zero hook calls — it read the wrong tree")
		}
		if !strings.Contains(err.Error(), "0 hook calls") {
			t.Fatalf("unexpected failure: %v", err)
		}
	})

	t.Run("src dir missing", func(t *testing.T) {
		err := hooksNotInConditional(t.TempDir(), nil)
		if err == nil {
			t.Fatal("hooks gate passed with no apps/mobile/src at all")
		}
	})
}
