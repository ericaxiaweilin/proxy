import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// SCENE-CARD-DIRECT-LIST-001（用户："我看到还有很多场景卡片点击 弹出半页
// 引导 这个要移除 现在所有的场景卡片都是点击 进入场景list"）。
//
// 之前：一张 Moment 卡如果它的动作分类还没有真实场景命中（entries 里找不到），
// 点击会弹一个半页 sheet（配一个类似的 / 查看真实场景，常常置灰成"场景数据
// 接入中"），而不是像其它有真实命中的卡一样直接开列表。现在统一成直接开
// 列表——没有真实命中就让 SceneShopDirectory 自己的诚实空态说话
//（"附近还没有接入的 X 场景"），不再让卡片自己弹一层中间页。
const source = readFileSync(fileURLToPath(new URL("./scene-activity-discovery.tsx", import.meta.url)), "utf8");
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const code = stripComments(source);

describe("SCENE-CARD-DIRECT-LIST-001 every scene card opens the real list directly", () => {
  it("the moment-detail half-sheet (backdrop + slide-up sheet with 配一个类似的/查看真实场景) is gone", () => {
    expect(code).not.toContain("配一个类似的");
    expect(code).not.toContain("场景数据接入中");
    expect(code).not.toContain("查看真实场景");
    expect(code).not.toContain("const [detail, setDetail]");
    expect(code).not.toContain("function DetailLayer");
  });

  it("a moment card always calls setDirectoryEntry on press, with no fallback branch", () => {
    expect(code).toContain("onPress={() => setDirectoryEntry(directoryTarget ?? { actionId: actionMatchId(moment.action) ?? moment.action, label: action.label, unit: \"个\" })}");
    // 反向臂：旧的双分支写法（真命中开列表，没命中弹 sheet）不能悄悄回来。
    expect(code).not.toMatch(/if\s*\(directoryTarget\)\s*setDirectoryEntry\(directoryTarget\);\s*else\s*setDetail\(moment\)/);
  });

  it("no real scene category has zero matches faked into a fabricated count — the fallback entry carries no count/visitedTotal/areas/imageUrl", () => {
    expect(code).toContain('const [directoryEntry, setDirectoryEntry] = useState<{ actionId: string; label: string; unit: "家" | "个" }>();');
  });

  it("dead onCompose prop (only consumer was the removed sheet) was removed, not left dangling", () => {
    expect(code).not.toContain("onCompose");
  });

  it("only one <Modal> remains in this component (the full-page 动作分类 picker)", () => {
    expect((code.match(/<Modal /g) ?? []).length).toBe(1);
  });
});
