import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// PROFILE-TAB-LOAD-FAILED-001: 个人主页的「收藏 / 回复 / 被标记」三个 tab 以前在
// 加载失败时把数组 set 成 []，而空数组在 ProfileTabs 里渲染成「还没有收藏」等 ——
// 用户看到的是「我的东西没了」，而不是「没读出来」。
// 没有 RN 渲染测试基建，这里钉的是**渲染分支本身**：失败态和空态必须是两句话，
// 且失败态要先于空态判定。
describe("PROFILE-TAB-LOAD-FAILED-001", () => {
  const tabs = readFileSync(fileURLToPath(new URL("./surfaces/ProfileTabs.tsx", import.meta.url)), "utf8");
  const me = readFileSync(fileURLToPath(new URL("./surfaces/me.tsx", import.meta.url)), "utf8");

  it("each tab renders a failure state that is not the empty-invitation copy", () => {
    expect(tabs).toContain("回复没读出来");
    expect(tabs).toContain("收藏没读出来");
    expect(tabs).toContain("被标记没读出来");
  });

  it("the legitimately-empty copy is still there — failure must not have replaced it", () => {
    // 反向钉：修这个 bug 不能把「真的没有」那一格删掉。
    expect(tabs).toContain("还没有收藏");
    expect(tabs).toContain("还没有回复");
    expect(tabs).toContain("还没有被标记");
  });

  it("the failure branch is decided before the empty branch in all three tabs", () => {
    // 判空在前的话，失败时数组是空的，会先命中「还没有…」—— 等于没修。
    const guards = tabs.match(/if \(props\.failed\) \{/g) ?? [];
    expect(guards).toHaveLength(3);
    // SCENE-FAVORITE-002: 收藏的空态守卫现在多一个合取项
    // （`props.saved.length === 0 && scenes.length === 0` —— 只有场景收藏时不能说
    // "还没有收藏"）。所以这里允许判空条件带后续条件，但**仍然要求它存在**：
    // 这条钉守的是「失败态先于空态」，不是判空条件的字面形状。
    const emptyGuards = tabs.match(/if \(props\.(replies|saved|tagged)\.length === 0[^)]*\) \{/g) ?? [];
    expect(emptyGuards).toHaveLength(3);
    for (const empty of emptyGuards) {
      const at = tabs.indexOf(empty);
      // 每个空态判断之前，必须已经有一个失败态判断。
      expect(tabs.lastIndexOf("if (props.failed) {", at)).toBeGreaterThan(-1);
    }
  });

  it("the flags are threaded from ProfileTabsProps into each tab", () => {
    expect(tabs).toContain("failed={props.repliesFailed}");
    expect(tabs).toContain("failed={props.savedFailed}");
    expect(tabs).toContain("failed={props.taggedFailed}");
  });

  it("me.tsx records the failure and passes it down", () => {
    expect(me).toContain("setPersonalSavedFailed(true)");
    expect(me).toContain("setPersonalRepliesFailed(true)");
    expect(me).toContain("setPersonalTaggedFailed(true)");
    expect(me).toContain("savedFailed={personalSavedFailed}");
    expect(me).toContain("repliesFailed={personalRepliesFailed}");
    expect(me).toContain("taggedFailed={personalTaggedFailed}");
  });

  it("success clears the failure flag, otherwise one transient error sticks forever", () => {
    expect(me).toContain("setPersonalSavedFailed(false)");
    expect(me).toContain("setPersonalRepliesFailed(false)");
    expect(me).toContain("setPersonalTaggedFailed(false)");
  });
});
