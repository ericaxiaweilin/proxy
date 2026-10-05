// CONTENT-TASK-001：内容任务（商家「Creator 经营 · 生产内容」+ creator「我的内容任务」）的
// 类型、解析和纯函数。服务端：apps/api-go/internal/supply/content_task.go。
// 一个任务 = 一张 UGC 合作邀约 + 稿件 / 审核 / 各平台发布链接。
import type { PairPromoStats } from "./supply-client";

export type ContentStage = "AWAITING" | "SHOOTING" | "IN_REVIEW" | "APPROVED" | "PUBLISHED" | "CLOSED";
export type ContentPlatform = "tiktok" | "instagram" | "facebook" | "youtube";
export const CONTENT_PLATFORMS: readonly ContentPlatform[] = ["tiktok", "instagram", "facebook", "youtube"];

export type ContentChecks = { storeClear: boolean; matchesReality: boolean; noCompetitor: boolean; noContact: boolean };
export type ContentDraft = { mediaAssetIds: string[]; caption: string; durationSec: number; submittedAt: string; round: number };
export type ContentReview = { decision: "APPROVE" | "REJECT"; note: string; checks: ContentChecks; reviewedAt: string };
export type ContentPublication = { platform: string; url: string; publishedAt: string };

export type ContentTaskView = {
  id: string;
  invitationId: string;
  merchantId: string;
  agentId: string;
  title: string;
  brief: string;
  contentType: string;
  platforms: string[];
  state: string;
  draft?: ContentDraft | undefined;
  review?: ContentReview | undefined;
  publications: ContentPublication[];
  nudgedAt: string;
  createdAt: string;
  updatedAt: string;
  stage: ContentStage;
  invitationStatus: string;
  priceMinVnd: number;
  priceMaxVnd: number;
  merchantName: string;
  creatorName: string;
  creatorHandle: string;
  creatorPhoto: string;
  canNudge: boolean;
  draftHasContact: boolean;
  promoCode: string;
  promoStats?: PairPromoStats | undefined;
};

export type ContentTaskCounts = { total: number; awaiting: number; shooting: number; inReview: number; published: number };

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const bool = (v: unknown): boolean => v === true;
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const rec = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const STAGES: readonly ContentStage[] = ["AWAITING", "SHOOTING", "IN_REVIEW", "APPROVED", "PUBLISHED", "CLOSED"];

function parseChecks(v: unknown): ContentChecks {
  const c = rec(v) ?? {};
  return { storeClear: bool(c.storeClear), matchesReality: bool(c.matchesReality), noCompetitor: bool(c.noCompetitor), noContact: bool(c.noContact) };
}

function parseStats(v: unknown): PairPromoStats | undefined {
  const s = rec(v);
  if (!s) return undefined;
  return { issued: num(s.issued), redeemed: num(s.redeemed), couponRedeem: num(s.couponRedeem), newCustomers: num(s.newCustomers), spendVnd: num(s.spendVnd), discountVnd: num(s.discountVnd) };
}

export function parseContentTask(value: unknown): ContentTaskView | undefined {
  const v = rec(value);
  if (!v || !str(v.id)) return undefined;
  const d = rec(v.draft);
  const r = rec(v.review);
  const stage = STAGES.includes(v.stage as ContentStage) ? (v.stage as ContentStage) : "CLOSED";
  return {
    id: str(v.id), invitationId: str(v.invitationId), merchantId: str(v.merchantId), agentId: str(v.agentId),
    title: str(v.title), brief: str(v.brief), contentType: str(v.contentType) || "VIDEO", platforms: strs(v.platforms),
    state: str(v.state),
    draft: d ? { mediaAssetIds: strs(d.mediaAssetIds), caption: str(d.caption), durationSec: num(d.durationSec), submittedAt: str(d.submittedAt), round: num(d.round) } : undefined,
    review: r ? { decision: r.decision === "APPROVE" ? "APPROVE" : "REJECT", note: str(r.note), checks: parseChecks(r.checks), reviewedAt: str(r.reviewedAt) } : undefined,
    publications: Array.isArray(v.publications) ? v.publications.flatMap((p) => { const x = rec(p); return x && str(x.platform) && str(x.url) ? [{ platform: str(x.platform), url: str(x.url), publishedAt: str(x.publishedAt) }] : []; }) : [],
    nudgedAt: str(v.nudgedAt), createdAt: str(v.createdAt), updatedAt: str(v.updatedAt),
    stage, invitationStatus: str(v.invitationStatus), priceMinVnd: num(v.priceMinVnd), priceMaxVnd: num(v.priceMaxVnd),
    merchantName: str(v.merchantName), creatorName: str(v.creatorName), creatorHandle: str(v.creatorHandle), creatorPhoto: str(v.creatorPhoto),
    canNudge: bool(v.canNudge), draftHasContact: bool(v.draftHasContact), promoCode: str(v.promoCode), promoStats: parseStats(v.promoStats),
  };
}

export function parseContentTasks(value: unknown): ContentTaskView[] {
  return Array.isArray(value) ? value.flatMap((x) => { const t = parseContentTask(x); return t ? [t] : []; }) : [];
}

export function parseContentCounts(value: unknown): ContentTaskCounts {
  const c = rec(value) ?? {};
  return { total: num(c.total), awaiting: num(c.awaiting), shooting: num(c.shooting), inReview: num(c.inReview), published: num(c.published) };
}

// ---------------------------------------------------------------- 展示

export type ContentTab = "ALL" | "AWAITING" | "SHOOTING" | "IN_REVIEW" | "PUBLISHED";

// 「已发布」tab 含「已通过、还没贴链接」的（原型没有单独的「已通过」tab）。
export function tasksForTab(tasks: readonly ContentTaskView[], tab: ContentTab): ContentTaskView[] {
  if (tab === "ALL") return tasks.filter((t) => t.stage !== "CLOSED");
  if (tab === "PUBLISHED") return tasks.filter((t) => t.stage === "PUBLISHED" || t.stage === "APPROVED");
  return tasks.filter((t) => t.stage === tab);
}

export const STAGE_LABEL: Record<ContentStage, string> = {
  AWAITING: "⏱ 待接单",
  SHOOTING: "🎬 拍摄中",
  IN_REVIEW: "⏳ 待审核",
  APPROVED: "✓ 已通过 · 待发布",
  PUBLISHED: "✓ 已发布",
  CLOSED: "已结束",
};

export const PLATFORM_LABEL: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", youtube: "YouTube" };
export const platformLabel = (p: string): string => PLATFORM_LABEL[p] ?? p;

export const CONTENT_TYPE_LABEL: Record<string, string> = { VIDEO: "探店短视频", PHOTO_POST: "UGC 图文" };

// 标题空（普通「邀请合作」选了 UGC 目的进来的）就用邀约留言，再没有就写明是未命名。
export function taskTitle(t: Pick<ContentTaskView, "title" | "brief">): string {
  return t.title.trim() || t.brief.trim() || "未命名内容任务";
}

export function formatDuration(sec: number): string {
  if (sec <= 0) return "";
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

// 发布进度：计划平台里已发了几个（贴了链接但不在计划里的也算已发）。
export function publishProgress(t: Pick<ContentTaskView, "platforms" | "publications">): { done: number; planned: number } {
  const planned = new Set(t.platforms);
  for (const p of t.publications) planned.add(p.platform);
  return { done: new Set(t.publications.map((p) => p.platform)).size, planned: planned.size };
}

// 卡片上「审核通过」按钮能不能点：三项人工勾全 + 文案自动扫描没问题。
export function canApprove(checks: Omit<ContentChecks, "noContact">, draftHasContact: boolean): boolean {
  return checks.storeClear && checks.matchesReality && checks.noCompetitor && !draftHasContact;
}

// 发布链接本地预检（服务端会再验一遍，只认平台自己的域名）。
const HOSTS: Record<string, string[]> = { tiktok: ["tiktok.com"], instagram: ["instagram.com"], facebook: ["facebook.com", "fb.watch"], youtube: ["youtube.com", "youtu.be"] };
export function publicationUrlOk(platform: string, raw: string): boolean {
  const m = /^https:\/\/([^/?#:]+)/i.exec(raw.trim());
  const hosts = HOSTS[platform];
  if (!m || !hosts) return false;
  const host = (m[1] ?? "").toLowerCase();
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

// 「10-02 19:30」：本地时间，同一年不写年份。解析不了就空串（不显示一个错的时间）。
export function formatTaskTime(iso: string, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2000) return "";
  const p = (n: number): string => String(n).padStart(2, "0");
  const md = `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}-${md}`;
}

// 服务端拒绝码 → 人话（commandErrorMessage 带出来的文案里含错误码 / messageKey）。
export function contentErrorText(message: string): string {
  const has = (code: string): boolean => message.includes(code) || message.includes(code.toLowerCase());
  if (has("INVITATION_ALREADY_PENDING")) return "这位达人还有一张没回复的邀约，等她回复或先撤回";
  if (has("AGENT_NOT_INVITABLE")) return "这位达人现在不接邀约";
  if (has("INVALID_CONTENT_TASK_TEXT")) return "标题必填（60 字内），说明 300 字内";
  if (has("INVALID_CONTENT_PLATFORMS")) return "至少选一个发布平台";
  if (has("INVALID_INVITATION_RANGE")) return "出价最低不能高于最高";
  if (has("CONTENT_HAS_CONTACT")) return "文案里有站外联系方式（电话 / Zalo / 外链），不能通过，请打回";
  if (has("CONTENT_CHECKS_INCOMPLETE")) return "三项人工检查都确认后才能通过";
  if (has("CONTENT_REJECT_REASON_REQUIRED")) return "打回要写原因，达人才知道怎么改";
  if (has("CONTENT_NOT_IN_REVIEW")) return "这份稿件已经审过了，刷新看看";
  if (has("CONTENT_NUDGE_TOO_SOON")) return "24 小时内已经提醒过了";
  if (has("CONTENT_NUDGE_NOT_APPLICABLE")) return "这个阶段不用催";
  if (has("INVITATION_NOT_PENDING")) return "邀约已经有结果了，不能撤回";
  if (has("INVALID_PUBLICATION_URL")) return "链接要是这个平台自己的 https 地址";
  if (has("CONTENT_NOT_APPROVED")) return "稿件审核通过后才能贴发布链接";
  if (has("INVALID_CONTENT_DRAFT")) return "至少一张图 / 一段视频，文案 1000 字内";
  if (has("CONTENT_TASK_NOT_ACCEPTED") || has("CONTENT_DRAFT_NOT_EXPECTED")) return "现在不能交稿（还没接单或正在审核）";
  return message || "操作没成功，稍后再试";
}
