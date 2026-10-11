import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ACTIVITY-DRAFT-RESTORE-001（2026-10-11，用户：「存草稿功能似乎没有用」）。
//
// 根因：创建活动表单里「加载场景目录 + 读草稿 + 定位」那段 effect 依赖 [t]，而
// useI18n() 每次渲染都返回新的 t —— effect 每次渲染都重跑：目录加载成功 → setSpots(新数组)
// → 渲染 → 重跑 → 再请求，无限循环；每次重跑还把上一轮没读完的草稿读取置为 cancelled，
// 钥匙串读取慢于目录请求时草稿永远恢复不出来。保存其实写进去了，读不回来。
//
// 为什么是源码级 tripwire：vitest 这边没有 RN 渲染器，复现不了「渲染 → effect 重跑」。
// 所以钉「这段 effect 只在挂载时跑」这个形状（见 proxy-icon.test.ts 同样的取舍）。
const source = readFileSync(fileURLToPath(new URL("./activity-wizard.tsx", import.meta.url)), "utf8");

// 剥注释再断言：上面的注释会提到 [t]，不剥的话把实现改回去、注释留着，断言照样绿。
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

describe("ACTIVITY-DRAFT-RESTORE-001 草稿恢复不能被重渲染打断", () => {
  it("读草稿的 effect 只在挂载时跑，不依赖每次渲染都会变的 t", () => {
    const start = code.indexOf("SecureStore.getItemAsync(DRAFT_KEY)");
    expect(start, "找不到读草稿的调用").toBeGreaterThan(0);
    // 从读草稿处往后，到这个 useEffect 的依赖数组为止。
    const tail = code.slice(start);
    const deps = /\},\s*(\[[^\]]*\])\s*\);/.exec(tail);
    expect(deps, "找不到 effect 的依赖数组").not.toBeNull();
    expect(deps![1], "读草稿的 effect 又依赖 [t] 了 —— 每次渲染都会取消上一轮读取").toBe("[]");
  });

  it("保存与恢复用同一个草稿 key，且保存后给用户反馈", () => {
    expect(code).toContain("SecureStore.setItemAsync(DRAFT_KEY, encodeDraft(form))");
    expect(code).toContain('setDraftMsg(t("draftSaved"))');
    // 反馈放在顶部进度条下面：存草稿键在顶栏，提示放到页面底部会在屏外看不见。
    const heroSub = code.indexOf('t("createSub")');
    const msg = code.indexOf("{draftMsg && !error ?");
    const firstBlock = code.indexOf('t("createCat")');
    expect(heroSub).toBeGreaterThan(0);
    expect(msg).toBeGreaterThan(heroSub);
    expect(msg, "草稿提示不在表单第一块之前 —— 点了存草稿看不到反馈").toBeLessThan(firstBlock);
  });
});
