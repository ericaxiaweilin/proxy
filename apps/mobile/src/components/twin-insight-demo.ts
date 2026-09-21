import type { ListTwinInsightsPayload, TwinInsight, TwinInsightThresholds } from "@proxy/contracts";

// TWIN-INSIGHT-001 — 好友洞察本机演示数据（纯模块，不 import react-native，
// 以便 vitest 可测；UI 在 twin-insight-section.tsx）。
//
// 来源：用户 2026-09-21 原型里的 6 个好友。advice/summary 全转纯文本
// （原型 <strong> 高亮只留文字），测试钉住无 "<"。
// 后端 wire 落地后删除本文件（TODO: TWIN-INSIGHT-002 Go wire）。

export const DEMO_THRESHOLDS: TwinInsightThresholds = { operateAt: 60, observeAt: 40, configVersion: 1 };

export const DEMO_INSIGHTS: ReadonlyArray<TwinInsight> = [
  {
    targetId: "alex",
    displayName: "Alex",
    initial: "A",
    avatarUrl: "",
    signal: "hot",
    verdict: "worth",
    verdictLabel: "值得运营",
    summaryHint: "7 天访问 12 次 · 互动深",
    score: 82,
    signals: { views7d: 12, messages7d: 48, avgStaySec: 180, likes7d: 9 },
    advices: [
      { type: "good", text: "他主动看过你主页 12 次，其中 4 次停留超过 5 分钟，兴趣明确。" },
      { type: "info", text: "你们的对话以咖啡馆、办公为主，主题稳定。" },
      { type: "warn", text: "已经 3 天没有主动发消息，建议今天发一条轻度问候。" },
    ],
    summaryText: "你们在 3 天内聊过 2 次。第一次他提到自己刚搬到北宁，在找可以安静工作的地方。第二次你推荐了 Proxy Coffee，他说周末会去试试。",
    timeline: [
      { text: "访问了你的主页", time: "2 小时前", gray: false },
      { text: "回复了你的咖啡馆主题消息", time: "昨天 21:30", gray: false },
      { text: "你发了一条 AI 分身帖文，他未读", time: "3 天前", gray: true },
    ],
  },
  {
    targetId: "tom",
    displayName: "Tom",
    initial: "T",
    avatarUrl: "",
    signal: "warm",
    verdict: "watch",
    verdictLabel: "可以培养",
    summaryHint: "7 天访问 5 次 · 互动中等",
    score: 58,
    signals: { views7d: 5, messages7d: 22, avgStaySec: 120, likes7d: 4 },
    advices: [
      { type: "info", text: "访问 5 次，有一定的兴趣，但还没到主页常客的程度。" },
      { type: "warn", text: "对话偏短促，大多是单向回复。建议多发一条有共鸣的内容测一下反应。" },
    ],
    summaryText: "你们在一周内聊过 1 次。他回复过你发的咖啡馆帖文，说下次也想去。但之后互动较少，没有再主动发起对话。",
    timeline: [
      { text: "点赞了你的帖文", time: "1 天前", gray: false },
      { text: "回复了一条消息", time: "3 天前", gray: false },
      { text: "访问了你的主页", time: "5 天前", gray: true },
    ],
  },
  {
    targetId: "minh",
    displayName: "Minh",
    initial: "M",
    avatarUrl: "",
    signal: "new",
    verdict: "new",
    verdictLabel: "新好友",
    summaryHint: "刚加好友 · 数据积累中",
    score: 46,
    signals: { views7d: 3, messages7d: 8, avgStaySec: 240, likes7d: 2 },
    advices: [
      { type: "info", text: "刚加好友 2 天，互动频率不错，但数据还不够充分。" },
      { type: "good", text: "平均停留 4 分钟，说明对你主页内容有兴趣。" },
    ],
    summaryText: "你们 2 天前刚加好友。他主动发过一次消息，问你常去的咖啡馆。目前观察中有潜力。",
    timeline: [
      { text: "发了一条消息给你", time: "昨天", gray: false },
      { text: "访问了你的主页 3 次", time: "2 天前", gray: false },
    ],
  },
  {
    targetId: "brandon",
    displayName: "Brandon",
    initial: "B",
    avatarUrl: "",
    signal: "warm",
    verdict: "watch",
    verdictLabel: "可以培养",
    summaryHint: "7 天访问 6 次 · 对话偏商务",
    score: 55,
    signals: { views7d: 6, messages7d: 18, avgStaySec: 120, likes7d: 3 },
    advices: [
      { type: "info", text: "访问频次不错，但对话内容偏商务，不像在找约会。" },
      { type: "warn", text: "需要观察他是否有见面意图，否则运营价值有限。" },
    ],
    summaryText: "你们聊过 2 次，都是他主动。第一次问了工作相关，第二次问了咖啡馆推荐。目前看不出明确的约会意图。",
    timeline: [
      { text: "问了一家咖啡馆的地址", time: "2 天前", gray: false },
      { text: "访问了你的主页", time: "4 天前", gray: true },
    ],
  },
  {
    targetId: "chen",
    displayName: "陈先生",
    initial: "陈",
    avatarUrl: "",
    signal: "cold",
    verdict: "skip",
    verdictLabel: "暂不推荐",
    summaryHint: "7 天访问 1 次 · 无对话",
    score: 22,
    signals: { views7d: 1, messages7d: 0, avgStaySec: 30, likes7d: 0 },
    advices: [
      { type: "warn", text: "只访问过主页 1 次，停留极短，无互动。" },
      { type: "info", text: "不建议为此人单独运营，浪费你的时间和 API 成本。" },
    ],
    summaryText: "过去 7 天没有有效互动。他可能只是路过或对你有过一次好奇，不建议投入运营精力。",
    timeline: [{ text: "访问了你的主页", time: "6 天前", gray: true }],
  },
  {
    targetId: "wang",
    displayName: "王老板",
    initial: "王",
    avatarUrl: "",
    signal: "cold",
    verdict: "skip",
    verdictLabel: "暂不推荐",
    summaryHint: "7 天访问 2 次 · 无对话",
    score: 18,
    signals: { views7d: 2, messages7d: 0, avgStaySec: 45, likes7d: 0 },
    advices: [
      { type: "warn", text: "访问极短，无任何互动信号，可能是随手点进来的。" },
      { type: "info", text: "暂不需要为此人单独运营。" },
    ],
    summaryText: "过去 7 天无实质互动。建议先不投入精力，让他自然沉淀。",
    timeline: [{ text: "访问了你的主页", time: "3 天前", gray: true }],
  },
];

export const DEMO_PAYLOAD: ListTwinInsightsPayload = {
  twinId: "demo",
  insights: [...DEMO_INSIGHTS],
  totalTargets: DEMO_INSIGHTS.length,
  thresholds: DEMO_THRESHOLDS,
};
