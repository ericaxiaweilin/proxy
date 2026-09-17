import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(fileURLToPath(import.meta.url));

describe("Proxy UI Foundation v1 adoption", () => {
  it("keeps the portable semantic token contract", () => {
    const source = readFileSync(join(root, "theme.tsx"), "utf8");
    for (const role of ["background", "surface", "surfaceSecondary", "ink", "muted", "line", "accent", "success", "danger", "radius", "space", "text", "control"]) {
      expect(source).toContain(`${role}:`);
    }
  });

  it("keeps market tabs on the shared accessible control", () => {
    const source = readFileSync(join(root, "surfaces", "market.tsx"), "utf8");
    // DESIGN-CLEANUP-001 起 import 行里多了 ProxyLoading——钉只认“用了共享
    // ProxyTabs”，不认 import 的完整名单，否则以后每加一个共享组件就误报一次。
    expect(source).toMatch(/import \{[^}]*ProxyTabs[^}]*\} from "\.\.\/components\/proxy-foundation"/);
    expect(source).toContain("<ProxyTabs");
    expect(source).not.toMatch(/styles\.(?:tabOn|tabTextOn)/);
  });

  it("keeps secure controls on one shared switch implementation", () => {
    const conversation = readFileSync(join(root, "surfaces", "conversation.tsx"), "utf8");
    const settings = readFileSync(join(root, "components", "security-settings.tsx"), "utf8");
    expect(conversation).toContain("<ProxySwitch");
    expect(settings).toContain("<ProxySwitch");
    expect(conversation).not.toMatch(/switchKnob/);
    expect(settings).not.toMatch(/dotOn/);
  });
});
