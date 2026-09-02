/**
 * FACET — Proxy object-oriented content operation (R15.25+).
 *
 * 设计（见 Proxy_COMPLETE_FiveRoot_FACET_v11.html）：
 *  - "Not a sixth root"：FACET 是 ME tab 内的 deep module，
 *    不增加 6th tab。
 *  - 每个对象 (object) 代表一段关系或一个合作方（个人 / 朋友 /
 *    商家 / 客户）。每个对象有自己的"允许展示 / 不展示 / 当前缺口"
 *    状态。Phase 1 只暴露 list 视图。
 *  - 后端 R15.25.1 (facet-objects.go) 返回 mock 三条数据 (Ken / Linh /
 *    ABC Spa)，与 prototype 一致。
 *
 * Phase 1 范围：
 *  - FacetObjectSchema: 单个对象的契约（不含 LIBRARY / OBJECTS 详情
 *    字段；后续 phase 加 next-show 媒体 list 等）。
 *  - ListFacetObjectsPayloadSchema: 列表返回的 payload。
 *
 * Phase 1 NOT-IN-SCOPE（明确不做，避免 scope 蔓延）：
 *  - 不做 LIBRARY / OBJECTS list / OBJECT DETAIL / OBJECT PREVIEW
 *  - 不做图片上传 / 真实图片 URL
 *  - 不做关系规则引擎 / 智能推荐
 *  - 不做真实持久化（后端是 mock in-memory list）
 */
import { z } from "zod";

export const FacetObjectRelationSchema = z.enum([
  "BUILDING_TRUST",      // 重点关系 (Ken)
  "SHARED_INTEREST",     // 朋友 (Linh)
  "CREATOR_COLLAB"       // 合作 (ABC Spa)
]);
export type FacetObjectRelation = z.infer<typeof FacetObjectRelationSchema>;

export const FacetObjectGapSchema = z.object({
  /** 当前缺口 / 下次应优先展示的方向。free-form，但每个对象 ≤ 1 句。 */
  summary: z.string().min(1),
  /** 下一次展示的时间（display 字符串，front-end 决定怎么显示）。 */
  nextShowAt: z.string().min(1)
});
export type FacetObjectGap = z.infer<typeof FacetObjectGapSchema>;

/**
 * FacetObject 是 FACET 主屏上 1 个对象卡片的完整 wire 形状。
 *
 * 字段命名按 R15.25 决定：
 *  - id           稳定 id（后端 mock 用 'ken' / 'linh' / 'spa'）
 *  - displayName  UI 显示名（"小帅 Ken" / "Linh" / "ABC Spa"）
 *  - relation     关系类型 enum
 *  - goal         关系目标（中文 free-form，1 句）
 *  - currentState 当前运营状态（中文 1 句，如"已展示 16 条 · 本周新增 3 个素材"）
 *  - pillLabel    pill 文本（"重点关系" / "朋友" / "合作"）
 *  - gap          当前缺口 + 下次展示时间
 *  - avatarUrl    头像 URL（Phase 1 = 空字符串，UI 显示 placeholder）
 */
export const FacetObjectSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  relation: FacetObjectRelationSchema,
  goal: z.string().min(1),
  currentState: z.string().min(1),
  pillLabel: z.string().min(1),
  gap: FacetObjectGapSchema,
  avatarUrl: z.string()
});
export type FacetObject = z.infer<typeof FacetObjectSchema>;

export const ListFacetObjectsPayloadSchema = z.object({
  objects: z.array(FacetObjectSchema).min(0),
  /** 用户当前拥有的对象总数（用于 hero stats） */
  totalObjects: z.number().int().nonnegative(),
  /** 新鲜素材数量（hero stats） */
  freshAssets: z.number().int().nonnegative(),
  /** 已展示素材数量（hero stats） */
  shownAssets: z.number().int().nonnegative()
});
export type ListFacetObjectsPayload = z.infer<typeof ListFacetObjectsPayloadSchema>;

/**
 * Type guard: 校验 payload 是否符合 ListFacetObjects 形状。
 * UI / client 在收到后端响应后必须调用此函数（fail-closed）。
 */
export function parseListFacetObjectsPayload(raw: unknown): ListFacetObjectsPayload {
  return ListFacetObjectsPayloadSchema.parse(raw);
}

// ---------- R15.49 ListExperiences ----------

// ExperienceSummary R15.49 — server ListExperiences 返回的轻量 DTO。
// 跟 server experience.ExperienceSummary 1:1 对应。
export const ExperienceSummarySchema = z.object({
  experienceId: z.string().min(1),
  title: z.string(),
  category: z.string(),
  origin: z.enum(["PLATFORM", "MERCHANT", "USER"]),
  city: z.string().optional(),
  startTime: z.string().optional(),
  price: z.string().optional(),
  status: z.string().optional(),
  capacity: z.number().int().nonnegative().optional(),
  interested: z.number().int().nonnegative()
});
export type ExperienceSummary = z.infer<typeof ExperienceSummarySchema>;

// ListExperiencesPayload R15.49 — server 返 { experiences, count }.
// 跟 ListActivitiesPayloadSchema 同形 (已存在, 不再 import).
export const ListExperiencesPayloadSchema = z.object({
  experiences: z.array(ExperienceSummarySchema),
  count: z.number().int().nonnegative()
});
export type ListExperiencesPayload = z.infer<typeof ListExperiencesPayloadSchema>;

/**
 * Type guard: 校验 payload 是否符合 ListExperiences 形状。
 * UI / client 收到后端响应后必须调用 (fail-closed).
 */
export function parseListExperiencesPayload(raw: unknown): ListExperiencesPayload {
  return ListExperiencesPayloadSchema.parse(raw);
}
