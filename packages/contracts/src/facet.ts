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
 *  - goal         关系目标（中文 free-form，1 句）— R15.41 起由 AI 推理
 *  - currentState 当前运营状态（中文 1 句）— R15.41 起由 AI 推理
 *  - pillLabel    pill 文本（"重点关系" / "朋友" / "合作"）
 *  - gap          当前缺口 + 下次展示时间
 *  - avatarUrl    头像 URL（Phase 1 = 空字符串，UI 显示 placeholder）
 *  - recommendedKind   R15.41: AI 推荐下次展示的内容类型
 *  - reasoningConfidence R15.41: AI 推理置信度 0-100
 *  - sideSpaceGap      R15.42: 副空间缺口描述（仅合作方）
 *  - sideSpaceKind     R15.42: 副空间推荐类型（仅合作方）
 *  - sideSpacePosts    R15.43: 副空间已加入的内容池（仅合作方）
 */
export const FacetRecommendedKindSchema = z.enum([
  "personal/real-life",
  "personal/honest",
  "city/travel",
  "photo",
  "shared-experience",
  "portfolio/capability",
  "intro/services"
]);
export type FacetRecommendedKind = z.infer<typeof FacetRecommendedKindSchema>;

/**
 * FacetSideSpacePost — 副空间内容条目（R15.43）
 *
 * 设计：副空间 = Creator 精心挑选的、只对合作方可见的内容池。
 * 每条 post 关联一个 FacetObject（合作方）。
 * Phase 1.5: 5 个全局 catalog post（"门店环境" / "服务过程" /
 * "客户故事" / "能力对比" / "合作案例"），用户 add 选一个。
 * Phase 2: 真实用户发布内容。
 */
export const FacetSideSpacePostSchema = z.object({
  id: z.string().min(1),
  kind: FacetRecommendedKindSchema,
  title: z.string().min(1),
  imageUrl: z.string(),
  addedAt: z.string().min(1)
});
export type FacetSideSpacePost = z.infer<typeof FacetSideSpacePostSchema>;

export const FacetObjectSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  relation: FacetObjectRelationSchema,
  goal: z.string().min(1),
  currentState: z.string().min(1),
  pillLabel: z.string().min(1),
  gap: FacetObjectGapSchema,
  avatarUrl: z.string(),
  recommendedKind: FacetRecommendedKindSchema,
  reasoningConfidence: z.number().int().min(0).max(100),
  // R15.42: 副空间双轨 — 仅 CREATOR_COLLAB 关系有意义，其他关系 = ""
  sideSpaceGap: z.string(),
  sideSpaceKind: FacetRecommendedKindSchema.or(z.literal("")),
  // R15.43: 副空间内容池 — 非合作方恒为 []
  sideSpacePosts: z.array(FacetSideSpacePostSchema),
  // R15.44: 副空间缺口是否被填上 (实时数据) — 仅合作方有意义
  sideSpaceFulfilled: z.boolean()
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

/**
 * R15.43: 副空间 CRUD 响应 schema
 *
 *   - ListSideSpacePostsPayload: GET 某个对象的副空间内容列表
 *   - SideSpaceCatalog:         GET 全局 catalog（mock 5 条）
 *   - AddSideSpacePostPayload:  POST 返回的完整 SideSpacePost
 *
 * Wire shape 与 server side-space.go / server.go facetSideSpace handler
 * 严格对齐。
 */
export const ListSideSpacePostsPayloadSchema = z.object({
  posts: z.array(FacetSideSpacePostSchema)
});
export type ListSideSpacePostsPayload = z.infer<typeof ListSideSpacePostsPayloadSchema>;

/**
 * R15.43: 全局 catalog post (mock 5 条，Phase 2 接真实内容池)
 */
export const SideSpaceCatalogPostSchema = z.object({
  id: z.string().min(1),
  kind: FacetRecommendedKindSchema,
  title: z.string().min(1),
  imageUrl: z.string()
});
export type SideSpaceCatalogPost = z.infer<typeof SideSpaceCatalogPostSchema>;

export const ListSideSpaceCatalogPayloadSchema = z.object({
  posts: z.array(SideSpaceCatalogPostSchema)
});
export type ListSideSpaceCatalogPayload = z.infer<typeof ListSideSpaceCatalogPayloadSchema>;

export function parseListSideSpacePostsPayload(raw: unknown): ListSideSpacePostsPayload {
  return ListSideSpacePostsPayloadSchema.parse(raw);
}
export function parseListSideSpaceCatalogPayload(raw: unknown): ListSideSpaceCatalogPayload {
  return ListSideSpaceCatalogPayloadSchema.parse(raw);
}
export function parseFacetSideSpacePost(raw: unknown): FacetSideSpacePost {
  return FacetSideSpacePostSchema.parse(raw);
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

// ---------- R15.51 FacetConfig ----------

// FacetConfig — 运营可调的 reasoner 阈值 (server config.go 1:1 对应).
// 阈值变化会立即影响下一次 reasoner 调用 (Service.List 拉 config 后注入).
export const FacetConfigSchema = z.object({
  sideSpaceHighThreshold: z.number().int().min(0).max(20),
  sideSpaceMidThreshold: z.number().int().min(0).max(20),
  priorityMidBoundary: z.number().int().min(0).max(100),
  priorityHighBoundary: z.number().int().min(0).max(100),
  confidenceFloor: z.number().int().min(0).max(100),
  updatedAt: z.string(),
  updatedBy: z.string(),
  version: z.number().int().min(1)
});
export type FacetConfig = z.infer<typeof FacetConfigSchema>;

// FacetConfigPatchSchema — POST body, 字段均 optional (只更非空字段).
// updatedBy 必填 (server 拒空).
export const FacetConfigPatchSchema = z.object({
  sideSpaceHighThreshold: z.number().int().min(0).max(20).optional(),
  sideSpaceMidThreshold: z.number().int().min(0).max(20).optional(),
  priorityMidBoundary: z.number().int().min(0).max(100).optional(),
  priorityHighBoundary: z.number().int().min(0).max(100).optional(),
  confidenceFloor: z.number().int().min(0).max(100).optional(),
  updatedBy: z.string().min(1)
});
export type FacetConfigPatch = z.infer<typeof FacetConfigPatchSchema>;

// UpdateFacetConfigPayloadSchema — POST /v1/facet/config body 完整形状.
export const UpdateFacetConfigPayloadSchema = z.object({
  expectedVersion: z.number().int().min(1),
  patch: FacetConfigPatchSchema
});
export type UpdateFacetConfigPayload = z.infer<typeof UpdateFacetConfigPayloadSchema>;

/**
 * Type guard: 校验 ListFacetConfig 响应 (server 返 FacetConfig JSON).
 */
export function parseFacetConfig(raw: unknown): FacetConfig {
  return FacetConfigSchema.parse(raw);
}

/**
 * Type guard: 校验 UpdateFacetConfig 请求 body (client 出).
 */
export function parseUpdateFacetConfigPayload(raw: unknown): UpdateFacetConfigPayload {
  return UpdateFacetConfigPayloadSchema.parse(raw);
}

// ---------- R15.52 SideSpaceSuggestions ----------

// SuggestedSideSpacePost — R15.52 server 推送的副空间推荐.
// 跟 SideSpaceCatalogPost 一致, 多 reason (推卸说明) + rank.
export const SuggestedSideSpacePostSchema = z.object({
  post: SideSpaceCatalogPostSchema,
  reason: z.string().min(1),
  rank: z.number().int().min(1)
});
export type SuggestedSideSpacePost = z.infer<typeof SuggestedSideSpacePostSchema>;

// SideSpaceSuggestionsSchema — 单个对象的推荐组.
export const SideSpaceSuggestionsSchema = z.object({
  objectId: z.string().min(1),
  sideSpaceKind: z.string(), // "" 表示不推荐
  posts: z.array(SuggestedSideSpacePostSchema)
});
export type SideSpaceSuggestions = z.infer<typeof SideSpaceSuggestionsSchema>;

// ListSideSpaceSuggestionsPayload — GET 返 { suggestions: { [id]: SideSpaceSuggestions } }.
export const ListSideSpaceSuggestionsPayloadSchema = z.object({
  suggestions: z.record(z.string(), SideSpaceSuggestionsSchema)
});
export type ListSideSpaceSuggestionsPayload = z.infer<typeof ListSideSpaceSuggestionsPayloadSchema>;

/**
 * Type guard: 校验 GET /v1/facet/side-space/suggestions 响应.
 */
export function parseListSideSpaceSuggestionsPayload(raw: unknown): ListSideSpaceSuggestionsPayload {
  return ListSideSpaceSuggestionsPayloadSchema.parse(raw);
}
