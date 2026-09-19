import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 2026-09-17 审计第三轮 / 第四轮的落地钉（2026-09-19 重建 —— 第一版连同代码
// 一起被别人的 index-only 提交扫掉了）。三个缺陷的共同点：界面上看起来是一个
// 东西，实际上什么都不会发生（死按钮）、或者内容是编的（预填假需求）、或者把
// "不知道"画成了"知道"（未分类硬归到咖啡 + 拍照）。
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const marketRaw = read("./market.tsx");
const market = stripComments(marketRaw);
const cardRaw = read("./r37-opportunity-card.tsx");
const card = stripComments(cardRaw);
const logo = stripComments(read("../components/market-type-logo.tsx"));

describe("MARKET-DEAD-MORE-001 header more button is not a dead Text", () => {
  it("no longer renders a button-shaped glyph with no press handler", () => {
    // 以前四处 header（订单详情 / 发布需求模板页 / 发布需求表单 / 选人工作台）
    // 各挂一个 <Text style={styles.detailMore}>•••</Text>：长成按钮，没有
    // Pressable、没有 onPress。删掉而不是留着 —— 一个按不动的按钮是在承诺
    // 一个不存在的菜单。
    expect(market).not.toContain("•••");
    expect(marketRaw).not.toContain("detailMore");
  });
});

describe("PUBLISH-NO-FAKE-DEFAULT-001 the publish form starts empty", () => {
  it("title / time / location / price all start as an empty string", () => {
    // 以前 title 预填"周六城市同行 + 拍照"、location 预填"河内 · 西湖 / 老城区"、
    // priceMin 预填一个具体金额 —— 用户不改直接发布，就会产出一条自己没写过的
    // 假需求，而它看起来跟真需求一模一样。
    expect(market).toContain('const [title, setTitle] = useState("")');
    expect(market).toContain('const [time, setTime] = useState("")');
    expect(market).toContain('const [location, setLocation] = useState("")');
    expect(market).toContain('const [priceMin, setPriceMin] = useState("")');
  });

  it("puts the worked example in the placeholder, not in the state", () => {
    // 示例必须是灰字 placeholder：框里原本就有值会被当成"已经填好了"。
    expect(market).toContain('placeholder="例如：周六想找人一起逛西湖"');
    expect(market).toContain('placeholder="例如 10:00–18:00"');
    expect(market).toContain('placeholder="例如 河内 · 西湖"');
  });
});

describe("OPP-TYPE-OTHER-001 unrecognised opportunities are uncategorised", () => {
  it("does not collapse every unknown opportunity into coffee + photo", () => {
    // 关键词一个都不中时以前返回 coffee_photo —— 于是自定义发布（大多不带
    // opportunityType）全掉进「咖啡 + 拍照」，这个类目被稀释成垃圾桶，
    // 筛选时也会把无关机会算进来。
    expect(card).toContain('return "other";');
    expect(cardRaw).toContain('other: { label: "其他 · 未分类"');
  });

  it("renders a neutral placeholder glyph instead of inventing an activity icon", () => {
    // 未分类不给活动图标：给咖啡杯、给相机都是在编造语义。
    expect(logo).toContain("other: undefined");
    expect(logo).toContain("⋯");
  });

  it("exposes the uncategorised bucket in the filter palette", () => {
    const palette = stripComments(read("./r37-type-palette.tsx"));
    expect(palette).toContain('{ key: "other", label: "其他未分类" }');
  });
});
