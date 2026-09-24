/**
 * TWIN-INSIGHT-001 — AI 分身 · 好友洞察 wire 契约。
 *
 * 来源原型：docs/design/references/proxy_ai_twin_insight_v1.html
 * （用户 2026-09-21 提供的 deepseek 原型：好友横滑 + 折叠洞察卡 +
 *  信号格 + 运营价值评分 + AI 建议 + 对话摘要 + 最近互动 + 先观察/
 *  开启单独运营）。
 *
 * 设计约束（对齐 AGENTS.md / CURRENT_BASELINE.json）：
 *  - 这是 FUNCTIONAL_REFERENCE_ONLY，不是 ACTIVE_SCREEN_REFERENCE。
 *    UI 实现必须走 R3（theme.tsx + proxy-foundation + proxy-icon），
 *    禁止把原型的 emoji（👁💬⏱❤️）、渐变头像、硬编码 hex 直接搬进
 *    生产代码。
 *  - 评分阈值不由客户端硬编码 60/40。服务端下发 thresholds 快照
 *   （复用 FacetConfig 的 priorityHigh/MidBoundary 语义），客户端只做
 *    band 判定 + 展示。阈值变化不发版。
 *  - 读匿名可读（跟 Facet list 同策略：public browsing 无需登录）；
 *    写（observe/operate/summary:refresh）必须走认证通道
 *   （FACET-AUTH-001 同规则：无 token 服务端拒 401）。
 *  - 服务端下发的 advice/timeline/summary 是纯文本（不含 <strong> 等
 *    HTML）。原型里的 <strong> 只是高亮样式，移动端用 Text 嵌套实现，
 *    不做 HTML 解析（避免注入 + 双端渲染漂移）。
 *  - 空集合 = []，缺数组 = 协议异常（fail-closed，跟 FacetClient 一致）。
 */
import { z } from "zod";

export const TwinInsightSignalSchema = z.enum(["hot", "warm", "cold", "new"]);
export type TwinInsightSignal = z.infer<typeof TwinInsightSignalSchema>;

export const TwinInsightVerdictSchema = z.enum(["worth", "watch", "skip", "new"]);
export type TwinInsightVerdict = z.infer<typeof TwinInsightVerdictSchema>;

export const TwinInsightSignalsSchema = z.object({
  /** 7 天访问主页次数 */
  views7d: z.number().int().nonnegative(),
  /** 7 天对话消息条数 */
  messages7d: z.number().int().nonnegative(),
  /** 平均停留秒数（原型显示 3分/30秒/45秒 → 统一用秒传输，UI 格式化） */
  avgStaySec: z.number().int().nonnegative(),
  /** 7 天点赞/收藏次数 */
  likes7d: z.number().int().nonnegative(),
});
export type TwinInsightSignals = z.infer<typeof TwinInsightSignalsSchema>;

export const TwinInsightAdviceSchema = z.object({
  type: z.enum(["good", "info", "warn"]),
  /** 原型里的 ✓/i/! —— 服务端只给 type，UI 用 proxy-icon 渲染，不传字符 */
  text: z.string().min(1),
});
export type TwinInsightAdvice = z.infer<typeof TwinInsightAdviceSchema>;

export const TwinInsightTimelineItemSchema = z.object({
  text: z.string().min(1),
  /** 展示用时间串（"2 小时前" / "昨天 21:30"），服务端格式化，客户端原样展示 */
  time: z.string().min(1),
  gray: z.boolean(),
});
export type TwinInsightTimelineItem = z.infer<typeof TwinInsightTimelineItemSchema>;

export const TwinInsightSchema = z.object({
  targetId: z.string().min(1),
  displayName: z.string().min(1),
  /** 头像首字回退（ProxyAvatar fallback 用）。有真头像走 avatarUrl。 */
  initial: z.string().min(1).max(2),
  avatarUrl: z.string(),
  signal: TwinInsightSignalSchema,
  verdict: TwinInsightVerdictSchema,
  verdictLabel: z.string().min(1),
  /** 折叠条副标题（原型："7 天访问 12 次 · 互动深"） */
  summaryHint: z.string().min(1),
  /** 运营价值评分 0-100，对应 Facet reasoningConfidence 同量纲 */
  score: z.number().int().min(0).max(100),
  signals: TwinInsightSignalsSchema,
  advices: z.array(TwinInsightAdviceSchema).max(5),
  summaryText: z.string().min(1),
  timeline: z.array(TwinInsightTimelineItemSchema).max(10),
});
export type TwinInsight = z.infer<typeof TwinInsightSchema>;

/** 阈值快照：operateAt = 建议单独运营线（原型 60），observeAt = 观察线（原型 40）。 */
export const TwinInsightThresholdsSchema = z.object({
  operateAt: z.number().int().min(0).max(100),
  observeAt: z.number().int().min(0).max(100),
  configVersion: z.number().int().min(1),
});
export type TwinInsightThresholds = z.infer<typeof TwinInsightThresholdsSchema>;

export const ListTwinInsightsPayloadSchema = z.object({
  twinId: z.string().min(1),
  insights: z.array(TwinInsightSchema),
  totalTargets: z.number().int().nonnegative(),
  thresholds: TwinInsightThresholdsSchema,
});
export type ListTwinInsightsPayload = z.infer<typeof ListTwinInsightsPayloadSchema>;

export function parseListTwinInsightsPayload(raw: unknown): ListTwinInsightsPayload {
  return ListTwinInsightsPayloadSchema.parse(raw);
}

export function parseTwinInsight(raw: unknown): TwinInsight {
  return TwinInsightSchema.parse(raw);
}

export const TwinOperateActionSchema = z.enum(["observe", "operate"]);
export type TwinOperateAction = z.infer<typeof TwinOperateActionSchema>;

export const TwinOperateResultSchema = z.object({
  targetId: z.string().min(1),
  action: TwinOperateActionSchema,
  /** 服务端回填的操作人 + 时间（审计用，客户端展示可选） */
  actedAt: z.string().min(1),
});
export type TwinOperateResult = z.infer<typeof TwinOperateResultSchema>;

export function parseTwinOperateResult(raw: unknown): TwinOperateResult {
  return TwinOperateResultSchema.parse(raw);
}

/**
 * 纯展示判定（无副作用，可单测）：
 * score >= operateAt → worth；>= observeAt → watch/new 由服务端 verdict 为准；
 * 低于 observeAt → skip。客户端不自己发明 verdict，只用它决定 score-hint 文案。
 */
export function twinScoreBand(score: number, thresholds: TwinInsightThresholds): "above" | "near" | "below" {
  if (score >= thresholds.operateAt) return "above";
  if (score >= thresholds.observeAt) return "near";
  return "below";
}

/** 平均停留秒数 → 原型文案（3分 / 45秒）。≥60s 显示 x分，否则 x秒。 */
export function formatTwinStay(avgStaySec: number): string {
  if (avgStaySec >= 60) return `${Math.round(avgStaySec / 60)}分`;
  return `${avgStaySec}秒`;
}
