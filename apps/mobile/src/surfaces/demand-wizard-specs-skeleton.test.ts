import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// DEMAND-SPECS-SKELETON-001（2026-10-07，用户看完确认下单原型 deepseek_html_20261006：
// 「还不如用这个原型的」—— 取范围是页面骨架）：规格步按原型套编号分段
// （1 选场景 / 2 选搭子 / 3 时间与人数 / 4 价格 / 5 备注 —— 原型没有价格段，
//  本仓多一段，所以是五段不是四段）+ 底部汇总条（一行当前选择 + 价格）
// + 确认发布。控件保留已定的（滚轮 / 下拉 / 直接约），配色照旧去粉。
//
// 这条钉守的是骨架：谁把分段拆回散标题、把汇总和按钮搬回滚动流里，这里先红。
// 断言只落在精确写法上 —— 注释里也写着这些词，裸名会被自己的注释喂红（本仓有前科）。
describe("DEMAND-SPECS-SKELETON-001 规格步是编号分段 + 底部汇总条", () => {
  const wizard = readFileSync(
    fileURLToPath(new URL("./demand-wizard.tsx", import.meta.url)),
    "utf8"
  );

  // 段号与标题**成对**取：从标题往回找最近的 `no={…}`。只断言「no={1} 存在」是弱钉 ——
  // 谁把段号抄错一位（2 段写 no={3}）它照样绿。这里把 1–5 逐段钉死。
  function stepNoOf(titleMarker: string): string {
    const at = wizard.indexOf(titleMarker);
    expect(at, `找不到分段标题 ${titleMarker}`).toBeGreaterThan(-1);
    return wizard.slice(wizard.lastIndexOf("no={", at), at).trim();
  }

  it("五段编号分段：选场景 / 选搭子 / 时间与人数 / 价格 / 备注", () => {
    expect(wizard).toContain("SpecsSection");
    // DEMAND-SCENE-MAP-001 起第 1 段标题按有无列表切换（有列表才叫选场景）。
    // 断言按**逐个 prop** 落，不写成 `no={1} title=...` 一整串：第 1 段的 hint 槽
    // 从 DEMAND-NOISE-TRIM-001 起是个多行 ReactNode，`no` 与 `title` 已被挤到两行
    // 上 —— 行内连串断言会假红（2026-10-07 实测踩到）。钉要守的是「这五段在、编号
    // 与标题对得上」，不是「props 写在同一行」。
    expect(stepNoOf('title={sceneBinding ? "选场景" : "地点"}')).toBe("no={1}");
    expect(stepNoOf('title="选搭子"')).toBe("no={2}");
    expect(stepNoOf('title="时间与人数"')).toBe("no={3}");
    expect(stepNoOf('title="价格"')).toBe("no={4}");
    expect(stepNoOf('title="备注"')).toBe("no={5}");
    // 徽是 ink 数字徽，不是原型的粉色。
    expect(wizard).toContain("specStepBadge");
  });

  it("DEMAND-SUBSECTION-002 搭子是第 2 段，压在时间与人数之前", () => {
    // 用户 2026-10-07：「这个怎么找人 要对齐原型 搭子 而不是怎么找人 放在时间与人数
    // 上面」。名字取原型 ② 的原话「选搭子」；位置在 ① 选场景 之后、时间与人数之前。
    expect(wizard).toContain('title="选搭子"');
    expect(wizard.indexOf('title="选搭子"')).toBeLessThan(
      wizard.indexOf('title="时间与人数"')
    );
    // 反面：被换掉的那个行内 label 不许回来。用 JSX 形态断言 —— 注释里还留着
    // 「怎么找人」这几个字（讲这次改动的由来），裸名会被自己的注释喂红。
    expect(wizard).not.toContain("怎么找人</Text>");
  });

  it("DEMAND-SUBSECTION-003 搭子是原型那枚等权分段控件 + 说明卡", () => {
    // 用户 2026-10-07 看了原型的渲染图：「你实现的没有对齐原型 这样看起来很不起眼
    // 其实这是重要选择 对齐原型」。原来是一颗 chip + 一条小字链接 —— 撑不起「重要选择」。
    // 段内两段的名字仍是用户 2026-10-06 定名的 等接单 / 直接约（DEMAND-SCENE-FIRST-001
    // 按字面扫），换的只是**控件形态**。
    expect(wizard).toContain("}>等接单</Text>");
    expect(wizard).toContain("}>直接约</Text>");
    // 分段控件：等权两段（flex:1）+ 白药丸选中态。
    expect(wizard).toContain("style={styles.modeToggle}");
    expect(wizard).toContain("styles.modeToggleBtnOn");
    expect(wizard.match(/styles\.modeToggleBtn,/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    // 说明卡：44 圆图标 + 名称 + 角标 + 描述（原型 .auto-card / .auto-icon / .auto-badge）。
    expect(wizard).toContain("style={styles.autoCard}");
    expect(wizard).toContain("styles.autoIcon");
    expect(wizard).toContain("styles.autoBadge");
    expect(wizard).toContain("styles.autoDesc");
    expect(wizard).toContain("}>系统推荐</Text>");
    // 专业模式没选时不摆卡（判据写死成这两个分支，undefined 落到 null）——
    // 不然「系统推荐 · 推荐」会在一件还没选的事上冒充已选。
    expect(wizard).toContain(') : mode === "open" ? (');
    // 反面：旧的 chip + 小字链接形态不许回来。钉**样式名**不钉文案 —— 上面那段注释里
    // 引用了旧文案，裸串会被自己的注释喂绿（这一轮真踩过）。两个样式已随形态一起删除。
    expect(wizard).not.toContain("styles.directLinkText");
    expect(wizard).not.toContain("styles.chipOn");
  });

  it("分段顺序即页面顺序：场景 → 搭子 → 人时 → 价格 → 备注", () => {
    // 排序锚用 title（唯一、且与 prop 顺序/换行无关），不用行内连串 —— 同上的假红。
    const order = [
      'title={sceneBinding ? "选场景" : "地点"}',
      'title="选搭子"',
      'title="时间与人数"',
      'title="价格"',
      'title="备注"',
    ].map((marker) => wizard.indexOf(marker));
    for (const [i, pos] of order.entries()) {
      expect(pos).toBeGreaterThan(-1);
      if (i > 0) expect(pos).toBeGreaterThan(order[i - 1]!);
    }
  });

  it("底部汇总条：一行当前选择 + 价格，按钮收在条里", () => {
    expect(wizard).toContain("styles.specsBottomBar");
    expect(wizard).toContain("bottomSummary");
    // 顶上的规格摘要盒撤了 —— 当前选择一页只讲一遍（底部条里）。
    expect(wizard).not.toContain("styles.specSummary");
  });
});
