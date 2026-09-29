import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { merchantVerified, opportunityWhenLabel } from "./market-fixtures.js";
import { buildDemandPublishInput, defaultSpecsFor, MOMENT_TEMPLATES } from "./demand-moments.js";

const source = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

// MARKET-WHEN-LABEL-001: wire 上 date / time 是两个字段 —— date 是日期
// （种子行与契约测试里是「周六」「今天」「明天」），time 是时刻
// （「15:00–20:00」）。展示侧一直按 `{date} {time}` 拼。
//
// 但需求向导的「时间」是一个自由文本框（默认值取自 MOMENT_TEMPLATES[].defaultTime
// = 「今晚 19:00」），发布映射把这一串**同时**写进了两个字段 —— 于是详情、卡片、
// 合成帖文、报价 sheet、报名明细五处都印两遍：
// 「今晚 19:00 今晚 19:00 · 2 小时 · 1:1」。存量行已经这样落库（活库里
// 2026-09-11~15 那几行），改发布端修不掉它们，所以统一在显示层归一。
describe("opportunityWhenLabel (the shared 什么时候 string)", () => {
  it("does NOT print the wizard's time string twice", () => {
    const row = { date: "今晚 19:00", time: "今晚 19:00 · 2 小时 · 1:1" };
    expect(opportunityWhenLabel(row)).toBe("今晚 19:00 · 2 小时 · 1:1");
  });

  it("keeps the seed / contract shape (date is a day, time is a clock)", () => {
    expect(opportunityWhenLabel({ date: "周六", time: "15:00–20:00" })).toBe("周六 15:00–20:00");
    expect(opportunityWhenLabel({ date: "今天", time: "14:00–18:00" })).toBe("今天 14:00–18:00");
    expect(opportunityWhenLabel({ date: "明天", time: "09:00–15:00" })).toBe("明天 09:00–15:00");
  });

  it("degrades to whichever half exists instead of inventing one", () => {
    expect(opportunityWhenLabel({ date: "周六" })).toBe("周六");
    expect(opportunityWhenLabel({ time: "15:00–20:00" })).toBe("15:00–20:00");
    expect(opportunityWhenLabel({})).toBe("");
    expect(opportunityWhenLabel({ date: "  ", time: "  " })).toBe("");
  });

  it("only strips a real prefix overlap, not a coincidental substring", () => {
    // "周六 15:00" 不以 "周六 14:00" 开头 —— 两段都要在。
    expect(opportunityWhenLabel({ date: "周六 14:00", time: "周六 15:00–20:00" })).toBe("周六 14:00 周六 15:00–20:00");
  });

  // 端到端：真的跑一遍发布映射。这条断言就是截图里那一行 ——
  // 生产者写什么、渲染点拼什么，两边一起钉住。
  it("reproduces the screenshot row from the real publish mapping", () => {
    const coffee = MOMENT_TEMPLATES.find((template) => template.id === "coffee")!;
    const published = buildDemandPublishInput(coffee, defaultSpecsFor(coffee));
    expect(published.date).toBe("今晚 19:00");
    expect(published.time).toBe("今晚 19:00 · 2 小时 · 1:1");
    expect(opportunityWhenLabel(published)).toBe("今晚 19:00 · 2 小时 · 1:1");
    expect(opportunityWhenLabel(published)).not.toContain("今晚 19:00 今晚 19:00");
  });
});

// 解析器/归一函数对了还不够 —— 五个渲染点必须**用它**。以前五处各写一遍
// `${date} ${time}`，修好一处另外四处照旧。
describe("MARKET-WHEN-LABEL-001 render call sites", () => {
  const files: Array<[string, string]> = [
    ["detail 时间行", "./surfaces/market.tsx"],
    ["卡片 meta 行", "./surfaces/r37-opportunity-card.tsx"],
    ["合成帖文正文", "./feed-content.ts"],
    ["报价 sheet 上下文行", "./surfaces/opportunity-quote-sheet.tsx"]
  ];

  it("every site goes through the shared label", () => {
    for (const [label, path] of files) {
      expect(source(path), `${label} 没有接到 opportunityWhenLabel`).toContain("opportunityWhenLabel");
    }
  });

  it("no site hand-joins the two wire fields again", () => {
    for (const [label, path] of files) {
      const text = source(path);
      expect(text, `${label} 又手拼 date + time`).not.toContain("{opportunity.date} {opportunity.time}");
      expect(text, `${label} 又把两个字段各自塞进 join`).not.toContain("[opportunity.date, opportunity.time");
    }
  });
});

// MARKET-LEGACY-VERIFIED-001: 「商家身份已验证」只在服务端能背的形态下画。
// 2026-09-16 那次清扫只改了写路径，读路径把 payload 整段照发 —— 之前发布的行
// 至今带着 ownerType=PERSON + verified=true，界面就替个人发布者画出了商家认证。
describe("merchantVerified (legacy rows must not fake a merchant badge)", () => {
  it("keeps the badge for a merchant-stamp row", () => {
    expect(merchantVerified({ ownerType: "BUSINESS", verified: true })).toBe(true);
  });

  it("drops the badge on the shape the publish path never produces", () => {
    expect(merchantVerified({ ownerType: "PERSON", verified: true })).toBe(false);
  });

  it("never invents a badge from a missing field", () => {
    expect(merchantVerified({ ownerType: "BUSINESS", verified: false })).toBe(false);
    expect(merchantVerified({ verified: true })).toBe(false);
    expect(merchantVerified({})).toBe(false);
  });

  it("the detail and the card both gate on it", () => {
    expect(source("./surfaces/market.tsx")).toContain("merchantVerified(opportunity)");
    expect(source("./surfaces/r37-opportunity-card.tsx")).toContain("merchantVerified(opportunity)");
  });
});

// MARKET-HISTORY-CELL-001 / MARKET-FAIR-RANGE-CLAIM-001: 详情页上两处没有来源的
// 承诺 —— 「你的历史 约 X」（X 就是这单自己的价，跟左边那格恒等）和
// 「客户预算落在 Proxy 公平区间内」（平台没有公平区间引擎）。
describe("MARKET-HISTORY-CELL-001 / MARKET-FAIR-RANGE-CLAIM-001", () => {
  const detail = source("./surfaces/market.tsx");

  it("no longer relabels the order's own price as 你的历史", () => {
    expect(detail).not.toContain("你的历史");
    expect(detail).not.toContain("`约 ${budget}`");
  });

  it("no longer asserts a fairness range the platform never computed", () => {
    expect(detail).not.toContain("客户预算落在 Proxy 公平区间内");
    // 区间只在价格条里、且只在发布方真填了两框时出现；不再另开一个长说明盒。
    expect(detail).not.toContain("报价说明");
    expect(detail).toContain("{opportunity.moneyFlow !== \"TBD\" && opportunity.moneyFlow !== \"FREE\" && fairRange ? (");
  });
});

// MARKET-DETAIL-HERO-MEDIA-001: 详情 hero 是照片卡，不是那张深色文字卡。
// 照片塞进 detailHero（padding 14）里，外面就是一圈 14pt 黑框，底部还要再加
// detailHeroPhoto 的 marginBottom 12 —— 上/左/右 14pt、底边 26pt 的黑边。
describe("MARKET-DETAIL-HERO-MEDIA-001", () => {
  const detail = source("./surfaces/market.tsx");

  it("the photo card is a padding-free container that clips the photo", () => {
    expect(detail).toContain("detailHeroMedia");
    expect(detail).toMatch(/detailHeroMedia: \{[^}]*overflow: "hidden"/);
    expect(detail).toMatch(/detailHeroMedia: \{[^}]*\}/);
    expect(detail).not.toMatch(/detailHeroMedia: \{[^}]*padding:/);
  });

  it("the photo itself carries no leftover text-hero spacing", () => {
    expect(detail).toMatch(/detailHeroPhoto: \{ aspectRatio: 4 \/ 3, backgroundColor: "#F1ECE3", justifyContent: "flex-end", overflow: "hidden" \}/);
  });

  it("the dark text hero is still there for the two text-only screens", () => {
    // 反向钉：清掉的是照片卡上的黑框，不是那个深色文字 hero 本身
    // （发布需求 / 选人工作台还在用它）。
    expect(detail).toContain("detailHero:");
    expect((detail.match(/styles\.detailHero\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

// MARKET-DETAIL-HERO-RATIO-001: 2026-09-27 截图 —— hero 是一条约 2:1 的横条
// （390 宽 / 196 高），而素材样张是 640x480（4:3）。cover 把 4:3 的图上下裁掉
// 三分之一，屏幕上只看得到中间一条；更糟的是高度写死，屏越宽横条越扁（平板 /
// 分屏上比例完全失控）。修法：按素材比例约束 + 满宽不切圆角。
function jpegSize(file: string): { width: number; height: number } {
  const buf = readFileSync(file);
  let i = 2; // 跳过 SOI
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1] ?? 0;
    // SOF0..SOF15，排除 DHT(C4) / JPG(C8) / DAC(CC) —— 只有 SOF 段带尺寸。
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error(`no SOF marker in ${file}`);
}

describe("MARKET-DETAIL-HERO-RATIO-001", () => {
  const detail = source("./surfaces/market.tsx");

  it("the hero is constrained by the asset ratio, not a fixed height", () => {
    expect(detail).toMatch(/detailHeroPhoto: \{[^}]*aspectRatio: 4 \/ 3/);
    // 反向：写死高度就是这个 bug 本身 —— 屏越宽裁得越狠。
    expect(detail).not.toMatch(/detailHeroPhoto: \{[^}]*height: \d/);
  });

  it("the 4:3 constraint matches the sample assets it actually renders", () => {
    // 这条钉的是"4:3 是从素材量出来的"，不是拍脑袋：把每个样张的真实像素
    // 读出来。哪天有人塞进来一张 16:9 或竖图，这条会红 —— 那张图的 hero
    // 就会被裁，得先决定是换图还是让比例跟着素材走。
    const dir = fileURLToPath(new URL("../assets/market-scene-samples/", import.meta.url));
    const files = readdirSync(dir).filter((name) => name.endsWith(".jpg"));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const { width, height } = jpegSize(`${dir}${name}`);
      expect(`${name} ${width}x${height}`).toBe(`${name} ${(height * (4 / 3)).toFixed(0)}x${height}`);
    }
  });

  it("the full-bleed hero has no rounded corners", () => {
    // 满宽封面照切了圆角，四个角会露出页面底色，看着像贴歪的卡片。
    expect(detail).not.toMatch(/detailHeroMedia: \{[^}]*borderRadius/);
  });
});
