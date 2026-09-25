import type { StoreRecommendation } from "../storeonboarding-client";

// STORE-REC-MANAGE-001: 「推荐管理」的读模型。
//
// 为什么判断逻辑全在这个纯 .ts 里、而不是写在组件里：`surfaces/*.tsx` 不能被
// vitest import（RN 组件在 node 环境跑不起来）。凡是「错了会静默给出错误结论」
// 的东西 —— 状态归类、计数、搜索匹配、进度阶段 —— 都必须能被直接测，
// 所以它们全在这里，由 store-recommendation-manage.test.ts 覆盖。
//
// 词汇纪律（跟 STORE-REC-007 / 运营队列那一屏一致）：
// 服务端只有 ACCEPT / REJECT 两态，**采纳只代表运营批准接入，不等于店铺已存在**。
// 所以这里绝不出现「已签约」「已入驻」这类比系统知道得更多的话。
// 设计稿用的是「已签约 / 未通过」；照抄会把一个批准动作说成一份合同。

export type RecStatus = "PENDING" | "ACCEPTED" | "REJECTED";
export type RecFilter = "ALL" | RecStatus;

export const REC_STATUS_TEXT: Record<RecStatus, string> = {
  PENDING: "待评估",
  ACCEPTED: "已采纳 · 待接入",
  REJECTED: "未采纳"
};

export const REC_FILTERS: ReadonlyArray<{ id: RecFilter; label: string }> = [
  { id: "ALL", label: "全部" },
  { id: "PENDING", label: "待评估" },
  { id: "ACCEPTED", label: "已采纳" },
  { id: "REJECTED", label: "未采纳" }
];

// 服务端用 omitempty：没评估时 decision 根本不出现。「没有 decision」= 还没评估，
// 不是「评估成了第三种状态」。
export function recStatus(row: StoreRecommendation): RecStatus {
  if (row.decision === "ACCEPT") return "ACCEPTED";
  if (row.decision === "REJECT") return "REJECTED";
  return "PENDING";
}

export interface RecCounts {
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
}

export function countRecs(rows: readonly StoreRecommendation[]): RecCounts {
  const counts: RecCounts = { total: rows.length, pending: 0, accepted: 0, rejected: 0 };
  for (const row of rows) {
    const status = recStatus(row);
    if (status === "PENDING") counts.pending += 1;
    else if (status === "ACCEPTED") counts.accepted += 1;
    else counts.rejected += 1;
  }
  return counts;
}

// 搜索只覆盖**服务端真的存了的**字段：店名 / 城市 / 品类。
// 设计稿的占位符还写了「对接人」—— 推荐记录里没有这个字段（同样没有门牌地址、
// 电话、照片），把它写进占位符就是承诺一个永远搜不到的东西。
export function recSearchText(row: StoreRecommendation): string {
  return [row.storeName, row.city, row.category]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

export function filterRecs(
  rows: readonly StoreRecommendation[],
  filter: RecFilter,
  query: string
): StoreRecommendation[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter !== "ALL" && recStatus(row) !== filter) return false;
    if (!needle) return true;
    return recSearchText(row).includes(needle);
  });
}

export function recInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "店";
}

const REC_ACCENTS = ["lime", "rose", "sky", "gold"] as const;
export type RecAccent = (typeof REC_ACCENTS)[number];

// 色块按店名确定性取：同一家店每次进来颜色一样（随机色会让「我认得那家店」失效）。
// 它是**首字母色块**，不是店铺照片 —— 推荐记录里没有照片字段，画一张假封面
// 比留白更糟。
export function recAccent(name: string): RecAccent {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return REC_ACCENTS[hash % REC_ACCENTS.length] ?? "lime";
}

// 搜索命中的高亮分段。返回分段而不是拼 HTML：RN 里没有 <mark>，
// 得由渲染层把命中段包成带底色的 <Text>。
export interface RecSegment {
  text: string;
  hit: boolean;
}

export function highlight(text: string, query: string): RecSegment[] {
  const needle = query.trim().toLowerCase();
  if (!text) return [];
  if (!needle) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  // toLowerCase 在个别语言里会改变长度（如 İ）。长度对不上就放弃高亮 ——
  // 高亮错位会切出乱码，比不高亮糟得多。
  if (lower.length !== text.length) return [{ text, hit: false }];
  const out: RecSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const at = lower.indexOf(needle, cursor);
    if (at < 0) {
      out.push({ text: text.slice(cursor), hit: false });
      break;
    }
    if (at > cursor) out.push({ text: text.slice(cursor, at), hit: false });
    out.push({ text: text.slice(at, at + needle.length), hit: true });
    cursor = at + needle.length;
  }
  return out.filter((segment) => segment.text.length > 0);
}

export type RecStageState = "done" | "active" | "fail" | "todo";

export interface RecStage {
  id: "submitted" | "review" | "onboard";
  label: string;
  state: RecStageState;
  desc: string;
  at?: string | undefined;
}

// 进度只有 **3 段**，因为服务端只知道两个时刻：提交（createdAt）和出结论
// （decidedAt）。
//
// 设计稿画的是 4 段（提交推荐 → 平台评估 → 线下洽谈 → 签约完成），其中
// 「线下洽谈」「签约完成」在系统里**没有任何数据源** —— 画出来只能是编的，
// 而且会顺带承诺一份平台并没有的合同。所以第三段换成系统真正关心的那件事：
// **店铺接入**。采纳 ≠ 已存在，这一步要推荐人自己去「我的店铺」把店建出来
// （STORE-REC-007 存在的全部理由）。
export function recStages(row: StoreRecommendation): RecStage[] {
  const status = recStatus(row);
  const submitted: RecStage = {
    id: "submitted",
    label: "提交推荐",
    state: "done",
    desc: "推荐已受理并留档，只增不改。",
    at: row.createdAt
  };

  let review: RecStage;
  if (status === "PENDING") {
    review = {
      id: "review",
      label: "平台评估",
      state: "active",
      desc: "运营正在评估这家店，出结论后会写进这条记录。"
    };
  } else if (status === "ACCEPTED") {
    review = {
      id: "review",
      label: "平台评估",
      state: "done",
      desc: "运营已采纳这条推荐，批准这家店接入体系。",
      at: row.decidedAt
    };
  } else {
    review = {
      id: "review",
      label: "平台评估",
      state: "fail",
      desc: row.decisionReason ? `未采纳：${row.decisionReason}` : "未采纳，运营没有留理由。",
      at: row.decidedAt
    };
  }

  let onboard: RecStage;
  if (status === "ACCEPTED") {
    onboard = {
      id: "onboard",
      label: "店铺接入",
      state: "active",
      desc: "采纳只代表批准接入 —— 店铺不会自己出现，需要你去「我的店铺」把它建出来。"
    };
  } else if (status === "PENDING") {
    onboard = { id: "onboard", label: "店铺接入", state: "todo", desc: "评估通过之后才轮到这里。" };
  } else {
    onboard = { id: "onboard", label: "店铺接入", state: "todo", desc: "这条推荐没有走到接入。" };
  }

  return [submitted, review, onboard];
}

// 卡片右下角那行。设计稿这里是奖励文案（「+800 成长值」/「评估中」/「— 未达成」）——
// 系统里没有奖励模型，也没有任何一笔与推荐挂钩的成长值入账，写金额就是编。
// 换成这一步**真正该谁做什么**。
export function recNextStep(row: StoreRecommendation): string {
  const status = recStatus(row);
  if (status === "ACCEPTED") return "下一步：去「我的店铺」把店建出来";
  if (status === "REJECTED") return "未达成 · 改了信息可以重新推荐";
  return "等运营评估";
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// 绝对时间，不做「几小时前」—— 那种表达会随时间漂移、也没法核对。
export function recDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function recMoment(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${recDay(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 表单里的店铺类型快捷项。它只是往 category 这个自由文本字段里填一个词 ——
// 服务端的 category 是自由文本，没有枚举，所以这里也不假装有枚举。
export const REC_STORE_TYPES: readonly string[] = ["咖啡厅", "SPA", "美甲", "摄影", "茶馆", "酒吧"];

// 设计稿这条提示写的是「推荐被平台签约后，店铺自动进入我的店铺，你拿成长值奖励。
// 采纳后店铺前 3 个月独家使用。」——三件事系统里都没有：
//   ① 没有奖励模型（growth 域里没有任何与推荐挂钩的入账）；
//   ② 「自动进入我的店铺」跟服务端语义相反：采纳 ≠ 店铺已存在，要人去建；
//   ③ 没有任何「独家期」字段或规则。
// 所以这里只写今天真会发生的事。要上奖励/独家条款，得先把规则定下来再改这句话。
export const REC_TIP =
  "推荐先由平台运营评估。采纳后这家店要有人在「我的店铺」里真正建出来，才算接入 —— 采纳本身不等于店铺已存在。";

// 表单里目前**不收**的东西。设计稿有详细地址 / 对接人电话 / 店铺照片三项，
// 推荐记录里一个字段都没有 —— 收了也只能丢，所以宁可不收，也不让用户白填。
export const REC_UNCOLLECTED_NOTE =
  "门牌地址、对接人电话、店铺照片暂时不收：推荐记录里没有这几个字段，填了也只会丢。要加得先扩服务端。";
