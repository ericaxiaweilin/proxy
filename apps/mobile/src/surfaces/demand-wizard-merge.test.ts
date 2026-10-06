import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PRO_LOGOS, PRO_SERVICES } from "../demand-moments";

// DEMAND-PRO-MERGE-001: 2026-10-06 用户：「本质是把2个散的合并成一个 而不是把城市协助
// 放在外面」。发布需求页原本是**两套**选择器 —— 双栏（左 rail + 右 Moment 列表），以及
// 双栏**之外**的城市协助（一张「城市协助 · Professional」入口卡 + 一格子卡），规格步
// 还再摆一遍，于是城市协助同时以三种样子出现。
//
// 现在城市协助是 rail 上的「专业」分类，服务条目复用 Moment 同一套行样式（catalogItem /
// momentEmoji / momentTitle / …）—— 两边长得一样，因为是同一个选择器。
//
// 2026-10-06 后续：rail 先收成三档（热门/娱乐/专业，用户「先3个够了」），再补第四档
// 「运动」（用户「说错 加运动」）。下面第三条钉记的就是这四档的最终形状。
//
// 这条钉守的是「别再散开」：谁要加回一个选择器之外的城市协助入口，这里先红。
// 注意所有反面断言都带 `styles.` 前缀或整句 —— 上面这些注释里写着 professionalEntry /
// proGrid / proCard 这些**名字**，裸名断言会被自己的注释喂红（本仓有前科）。
describe("DEMAND-PRO-MERGE-001", () => {
  const wizard = readFileSync(
    fileURLToPath(new URL("./demand-wizard.tsx", import.meta.url)),
    "utf8"
  );
  // 双栏右边那一格：从 catalogPane 开标签到 currentCard（它紧跟在双栏之后）。
  const pane = wizard.slice(
    wizard.indexOf("styles.catalogPane}"),
    wizard.indexOf("styles.currentCard}")
  );

  it("专业进 rail，选择器之外不再有城市协助入口", () => {
    expect(wizard).toContain('{ id: "pro", label: "专业" }');
    // 反面：入口卡 + 2 列服务卡连同它们的样式都该没了。
    expect(wizard).not.toContain("styles.professionalEntry");
    expect(wizard).not.toContain("styles.proGrid");
    expect(wizard).not.toContain("styles.proCard");
    // 规格步那第二遍目录（连同它的字段标题）也不该回来。
    expect(wizard).not.toContain("专业服务 · 城市协助");
  });

  it("服务条目画在双栏那一格里，与 Moment 共用行样式和选中态", () => {
    expect(pane).toContain('category === "pro"');
    expect(pane).toContain("proVisible.map");
    expect(pane).toContain("styles.catalogItem");
    expect(pane).toContain("selectProService(service)");
    // pro 模板不再当 Moment 卡出现在列表里 —— 否则城市协助又多出第二种样子
    // （它原来挂在「主题」下）。数据层仍留着它：ORDER-SCENARIO-001 按
    // template.id === "pro" 把场景标成 assistance。
    expect(wizard).toContain('if (item.id === "pro") return false;');
  });

  it("rail 四档：热门 / 娱乐 / 运动 / 专业（收掉的档位别自己长回来）", () => {
    // 2026-10-06 用户：「其它改 就改成热门 娱乐 专业就可以 …… 先3个够了 以后跑起来再说吧」，
    // 同轮又追加「说错 加运动」—— 三档之后补第四档。
    for (const label of ["热门", "娱乐", "运动", "专业"]) {
      expect(wizard).toContain(`label: "${label}"`);
    }
    // 反面：上一版的三档（见面/出行/主题）不许回来 —— 回来就会把娱乐那一格重新切碎。
    // 断言带 `label: "` 前缀：注释里写着这三个词，裸名会被自己的注释喂红。
    for (const gone of ["见面", "出行", "主题"]) {
      expect(wizard).not.toContain(`label: "${gone}"`);
    }
  });

  it("娱乐与运动互斥、热门吃全部非 pro，rail 不按 Moment 家族分档", () => {
    // 运动档只收 category === "sport" 的模板；娱乐把运动摘出去；两者相加 = 热门。
    // 摘运动是零可见变化：运动模板是这一版新加的，没有老模板被搬走。
    expect(wizard).toContain('if (category === "sport" && item.category !== "sport") return false;');
    expect(wizard).toContain('if (category === "fun" && item.category === "sport") return false;');
    expect(wizard).toContain('if (category === "pro") return false;');
    // 反面：rail 不许再拿 Moment 家族当档位 —— 那样「娱乐」会缩回只剩一个模板。
    expect(wizard).not.toContain("item.category !== category");
  });

  it("子标签来自真实服务，不摆点不动的空标签", () => {
    const moments = readFileSync(
      fileURLToPath(new URL("../demand-moments.ts", import.meta.url)),
      "utf8"
    );
    expect(moments).toContain("PRO_TABS");
    // 原型那排还多一个「城市协助」子标签（装着「城市向导」「陪诊协助」两条），
    // 但本仓没有这两条服务条目 —— 摆上去就是点开空白的标签。
    expect(moments).not.toContain('label: "城市协助"');
  });

  it("档位与模板同进同出 —— 运动档背后真有运动模板，不是点开空白", () => {
    // 2026-10-06 用户「说错 加运动」。上一版我没加档位，理由就是「本仓没有运动类
    // Moment 模板，加一档只会得到一个点开空白的分类」。这次档位和模板一起加，
    // 所以这条钉守的是：谁再把运动档单独留着、把模板撤了，这里先红。
    const moments = readFileSync(
      fileURLToPath(new URL("../demand-moments.ts", import.meta.url)),
      "utf8"
    );
    // 「运动」档按 category: "sport" 筛 —— 一条 sport 模板都没有就是空标签。
    expect(moments).toContain('category: "sport"');
    // 两条运动模板都必须有图标映射（UI-ORDER-LOGO-001：复用场景动作既有 logo，
    // 不是另做一套）—— 映射漏了就会回落到 emoji，跟 Moment 那排长得不一样。
    expect(moments).toContain('ballgame: "sport"');
    expect(moments).toContain('ride: "cycling"');
  });

  it("专业四行都接了 logo，而且用的是既有资产（用户连着两轮问）", () => {
    // 2026-10-06 用户：「专业服务为什么没有 logo 图片资产 之前设计了 自己找找」
    // →「还是没找回专业的 logo 啊 找不到了吗」。查证结论：四条服务本身**从来没有**
    // 图片资产（R58 原型 pro-card 纯文字、服务端 templates.go 只给 Mark 文本）；
    // 但页面确实丢过一个 logo —— 城市协助入口卡的 urban-support，被合并整块删掉。
    const discovery = readFileSync(
      fileURLToPath(new URL("../components/scene-activity-discovery.tsx", import.meta.url)),
      "utf8"
    );
    for (const service of PRO_SERVICES) {
      const logo = PRO_LOGOS[service.id];
      expect(logo, `${service.title} 没配 logo —— 又会退成一行纯文字`).toBeDefined();
      if (logo !== undefined && "scene" in logo) {
        // scene id 必须是 SCENE_ACTIONS 里真有的（配错 id 会静默回落成 mark）。
        expect(discovery, `${service.title} 的 scene id「${logo.scene}」不在 SCENE_ACTIONS 里`)
          .toContain(`id: "${logo.scene}"`);
      }
    }
    // 被合并删掉的那一枚必须回到页面上：城市协助 → urban-support。
    expect(PRO_LOGOS.business).toEqual({ scene: "urban-support" });
    // 向导真的在画它（数据层配了但界面没接 = 白配）。
    expect(wizard).toContain("{proLogoNode(service)}");
  });
});
