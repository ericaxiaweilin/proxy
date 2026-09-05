import { z } from "zod";

export const ActorTypeSchema = z.enum(["USER", "OPERATOR", "SYSTEM", "PROVIDER"]);
export type ActorType = z.infer<typeof ActorTypeSchema>;

export const PrincipalTypeSchema = z.enum(["INDIVIDUAL", "BUSINESS", "SYSTEM"]);
export type PrincipalType = z.infer<typeof PrincipalTypeSchema>;

export const CommandEnvelopeSchema = z.object({
  commandId: z.string().min(1),
  commandType: z.string().min(1),
  commandVersion: z.number().int().positive(),
  actor: z.object({ type: ActorTypeSchema, id: z.string().min(1) }),
  principal: z.object({ type: PrincipalTypeSchema, id: z.string().min(1) }),
  target: z.object({ type: z.string().min(1), id: z.string().min(1) }),
  idempotencyKey: z.string().min(8),
  expectedAggregateVersion: z.number().int().nonnegative().optional(),
  policySnapshot: z.object({ policySetId: z.string(), policySetVersion: z.string() }).optional(),
  authContext: z.object({
    sessionId: z.string().optional(),
    reauthenticatedAt: z.string().datetime().optional(),
    operatorAccessGrantId: z.string().optional()
  }),
  purpose: z.string().min(1),
  correlationId: z.string().min(1),
  causationId: z.string().min(1).optional(),
  requestedAt: z.string().datetime(),
  payload: z.record(z.unknown())
});

export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;

export const ErrorCategorySchema = z.enum([
  "AUTHENTICATION",
  "AUTHORIZATION",
  "ACCOUNT_STATE",
  "VALIDATION",
  "BUSINESS_STATE",
  "ELIGIBILITY",
  "CONSENT_PERMISSION",
  "PAYMENT",
  "CONCURRENCY",
  "PROVIDER",
  "PRIVACY",
  "INTERNAL"
]);
export type ErrorCategory = z.infer<typeof ErrorCategorySchema>;

export const RetryabilitySchema = z.enum(["NO", "SAFE_RETRY", "AFTER_REAUTH", "AFTER_USER_ACTION", "ASYNC_PENDING"]);
export type Retryability = z.infer<typeof RetryabilitySchema>;

export type ErrorEnvelope = {
  errorCode: string;
  category: ErrorCategory;
  retryability: Retryability;
  messageKey: string;
  safeDetails: Record<string, unknown>;
  requiredAction?: string;
  correlationId: string;
  supportCaseRef?: string;
};

export type CommandResult = {
  commandId: string;
  outcome: "ACCEPTED" | "REJECTED" | "PENDING" | "ALREADY_APPLIED";
  aggregate?: { type: string; id: string; version: number; state?: string };
  eventRefs: string[];
  operationRef?: string;
  auth?: SessionAuthTokens;
  error?: ErrorEnvelope;
  correlationId: string;
};

export type SessionAuthTokens = {
  sessionId: string;
  userAccountId: string;
  principal: PrincipalContext;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  rotation: number;
};

export type DomainEvent<TPayload = Record<string, unknown>> = {
  eventId: string;
  eventType: string;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  principalId: string;
  occurredAt: string;
  correlationId: string;
  causationId?: string;
  payload: TPayload;
};

export type ReadModelEnvelope<TData> = {
  modelType: string;
  modelVersion: number;
  aggregateRefs: string[];
  lastEventId?: string;
  asOf: string;
  freshness: "CURRENT" | "STALE" | "PENDING_REBUILD";
  allowedActions: string[];
  redactions: string[];
  data: TData;
};

export type OutcomeComparisonResult = "IMPROVED" | "WORSE" | "SAME" | "UNKNOWN";
export type ObservationSetStatus = "DRAFT" | "FINALIZED";
export type OutcomeLearningStatus = "SUGGESTED" | "CONFIRMED" | "DISMISSED" | "EXPIRED";

export type OutcomeComparisonGateInput = {
  baselineStatus: ObservationSetStatus;
  resultStatus: ObservationSetStatus;
  sameTarget: boolean;
  compatibleTemplateLineage: boolean;
  sameVenueOrEntity: boolean;
  compatibleUnitOrScale: boolean;
  comparisonPolicyVersion?: string;
};

export type OutcomeComparisonGateResult =
  | { allowed: true; comparisonPolicyVersion: string }
  | { allowed: false; reason: "NOT_FINALIZED" | "TARGET_MISMATCH" | "TEMPLATE_LINEAGE_MISMATCH" | "ENTITY_MISMATCH" | "UNIT_OR_SCALE_MISMATCH" | "POLICY_MISSING" };

export const IdentityCommandTypeSchema = z.enum([
	"CreateAnonymousSession",
  "RequestLoginChallenge",
  "VerifyLoginChallenge",
  "CreateSession",
  "RegisterDevice",
  "RevokeSession",
  "RevokeAllSessions",
  "SwitchPrincipalContext",
  "RequestAccountRecovery",
  "RefreshSession",
  "ResumeTrustedDeviceSession"
]);
export type IdentityCommandType = z.infer<typeof IdentityCommandTypeSchema>;

export const PrincipalContextSchema = z.object({
  type: z.enum(["INDIVIDUAL", "BUSINESS"]),
  id: z.string().min(1)
});
export type PrincipalContext = z.infer<typeof PrincipalContextSchema>;

export const CreateAnonymousSessionPayloadSchema = z.object({
  deviceId: z.string().min(1),
  platform: z.enum(["IOS", "ANDROID"]),
  deviceCredential: z.string().min(32)
});
export type CreateAnonymousSessionPayload = z.infer<typeof CreateAnonymousSessionPayloadSchema>;

export const RequestLoginChallengePayloadSchema = z.object({
  loginIdentityId: z.string().min(1),
  deviceId: z.string().min(1),
  channel: z.enum(["EMAIL", "SMS"])
});
export type RequestLoginChallengePayload = z.infer<typeof RequestLoginChallengePayloadSchema>;

export const VerifyLoginChallengePayloadSchema = z.object({
  challengeId: z.string().min(1),
  code: z.string().min(1)
});
export type VerifyLoginChallengePayload = z.infer<typeof VerifyLoginChallengePayloadSchema>;

export const CreateSessionPayloadSchema = z.object({
  userAccountId: z.string().min(1),
  loginIdentityId: z.string().min(1),
  deviceId: z.string().min(1),
  challengeId: z.string().min(1),
  deviceCredential: z.string().min(32),
  requestedPrincipal: PrincipalContextSchema
});
export type CreateSessionPayload = z.infer<typeof CreateSessionPayloadSchema>;

export const RegisterDevicePayloadSchema = z.object({
  userAccountId: z.string().min(1),
  deviceId: z.string().min(1),
  platform: z.enum(["IOS", "ANDROID"]),
  pushTokenRef: z.string().min(1).optional()
});
export type RegisterDevicePayload = z.infer<typeof RegisterDevicePayloadSchema>;

export const RevokeSessionPayloadSchema = z.object({
  reason: z.enum(["USER_LOGOUT", "SECURITY", "DEVICE_REVOKED"])
});
export type RevokeSessionPayload = z.infer<typeof RevokeSessionPayloadSchema>;

export const RevokeAllSessionsPayloadSchema = z.object({
  reason: z.enum(["USER_LOGOUT", "SECURITY", "DEVICE_REVOKED"])
});
export type RevokeAllSessionsPayload = z.infer<typeof RevokeAllSessionsPayloadSchema>;

export const SwitchPrincipalContextPayloadSchema = z.object({
  principal: PrincipalContextSchema
});
export type SwitchPrincipalContextPayload = z.infer<typeof SwitchPrincipalContextPayloadSchema>;

export const RequestAccountRecoveryPayloadSchema = z.object({
  loginIdentity: z.string().min(1),
  requestedChannel: z.enum(["EMAIL", "SMS"])
});
export type RequestAccountRecoveryPayload = z.infer<typeof RequestAccountRecoveryPayloadSchema>;

export const RefreshSessionPayloadSchema = z.object({
  refreshToken: z.string().min(1),
  deviceId: z.string().min(1),
  deviceCredential: z.string().min(32)
});
export type RefreshSessionPayload = z.infer<typeof RefreshSessionPayloadSchema>;

export const ResumeTrustedDeviceSessionPayloadSchema = z.object({
  deviceId: z.string().min(1),
  deviceCredential: z.string().min(32)
});
export type ResumeTrustedDeviceSessionPayload = z.infer<typeof ResumeTrustedDeviceSessionPayloadSchema>;

export const DemandCommandTypeSchema = z.enum([
  "CreateTaskDraft",
  "UpdateTaskDraft",
  "PreviewTaskDraft",
  "PublishTask"
]);
export type DemandCommandType = z.infer<typeof DemandCommandTypeSchema>;

export const TaskBudgetSchema = z.object({
  currency: z.string().length(3),
  amountMinor: z.number().int().nonnegative(),
  pricingMode: z.enum(["PER_SLOT_FIXED", "HOURLY"])
});
export type TaskBudget = z.infer<typeof TaskBudgetSchema>;

export const TaskSlotGroupSchema = z.object({
  roleId: z.string().min(1),
  quantity: z.number().int().positive(),
  mustCapabilities: z.array(z.string().min(1)).default([])
});
export type TaskSlotGroup = z.infer<typeof TaskSlotGroupSchema>;

export const TaskLocationSchema = z.object({
  mode: z.enum(["APPROX_ONLY", "PLACE_ONLY", "EXACT_PRIVATE"]),
  label: z.string().min(1)
});
export type TaskLocation = z.infer<typeof TaskLocationSchema>;

export const DemandConfirmationSchema = z.object({
  scopeConfirmed: z.boolean(),
  materialChangePolicyConfirmed: z.boolean(),
  fundingAuthorizationConfirmed: z.boolean(),
  maxBudgetMinor: z.number().int().nonnegative().optional()
});
export type DemandConfirmation = z.infer<typeof DemandConfirmationSchema>;

export const TaskDraftChangesSchema = z.object({
  industry: z.string().min(1).optional(),
  scenario: z.string().min(1).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  location: TaskLocationSchema.optional(),
  slotGroups: z.array(TaskSlotGroupSchema).min(1).optional(),
  mustRequirements: z.array(z.string().min(1)).optional(),
  preferences: z.array(z.string().min(1)).optional(),
  deliverables: z.array(z.string().min(1)).optional(),
  budget: TaskBudgetSchema.optional(),
  matchingMode: z.enum(["FAST", "CURATED"]).optional(),
  catalogVersion: z.string().min(1).optional(),
  policySnapshot: z.object({ policySetId: z.string().min(1), policySetVersion: z.string().min(1) }).optional(),
  confirmation: DemandConfirmationSchema.optional(),
  draftProgress: z.number().int().min(0).max(100).optional(),
  lastCompletedStep: z.number().int().min(0).max(11).optional()
});
export type TaskDraftChanges = z.infer<typeof TaskDraftChangesSchema>;

export const CreateTaskDraftPayloadSchema = z.object({
  ownerUserAccountId: z.string().min(1),
  principal: PrincipalContextSchema,
  sourceInput: z.string().min(1),
  catalogVersion: z.string().min(1).optional(),
  policySnapshot: z.object({ policySetId: z.string().min(1), policySetVersion: z.string().min(1) }).optional()
});
export type CreateTaskDraftPayload = z.infer<typeof CreateTaskDraftPayloadSchema>;

export const UpdateTaskDraftPayloadSchema = z.object({
  expectedVersion: z.number().int().positive(),
  changes: TaskDraftChangesSchema
});
export type UpdateTaskDraftPayload = z.infer<typeof UpdateTaskDraftPayloadSchema>;

export const PreviewTaskDraftPayloadSchema = z.object({
  expectedVersion: z.number().int().positive()
});
export type PreviewTaskDraftPayload = z.infer<typeof PreviewTaskDraftPayloadSchema>;

export const PublishTaskPayloadSchema = z.object({
  expectedVersion: z.number().int().positive(),
  online: z.literal(true)
});
export type PublishTaskPayload = z.infer<typeof PublishTaskPayloadSchema>;

// ---- LocalNet Feed 读模型（服务端驱动：前端只渲染下发的 payload）----

export const PostMediaRefSchema = z.object({
  mediaAssetId: z.string().min(1),
  sortOrder: z.number().int().nonnegative(),
  altText: z.string().trim().max(500).optional()
});
export type PostMediaRef = z.infer<typeof PostMediaRefSchema>;

export const PostContextRefSchema = z.object({
  contextType: z.string().min(1),
  contextId: z.string().min(1),
  relationType: z.string().optional()
});
export type PostContextRef = z.infer<typeof PostContextRefSchema>;

// R15.24 P0：Post.Poll — 简单的帖内投票。
// 后端尚未实现。发送时 client 依然走 body 序列化作为兼容路径（ComposerV2Screen 的
// assembleComposerBody），后端落地后可同时填 ephemeralUntil / poll，服务端优先以新字段为准。
export const PostPollOptionSchema = z.object({
  optionId: z.string().min(1),
  label: z.string().min(1).max(80),
  // 顺序：0..n-1，UI 渲染时按此排序
  sortOrder: z.number().int().nonnegative()
});
export type PostPollOption = z.infer<typeof PostPollOptionSchema>;

export const PostPollSchema = z.object({
  // 投票到期时间（ISO 8601）。过后 server 自动关闭。
  expiresAt: z.string(),
  options: z.array(PostPollOptionSchema).min(2).max(8),
  // 是否多选；不传 / undefined = 单选。
  multiSelect: z.boolean().optional()
});
export type PostPoll = z.infer<typeof PostPollSchema>;

export const FeedPostSchema = z.object({
  postId: z.string().min(1),
  authorType: z.enum(["USER", "AGENT", "MERCHANT", "PLATFORM_SPECIAL", "AI_NATIVE"]),
  authorId: z.string().min(1),
  authorDisplayName: z.string().optional(),
  // R15.76: AI Author Kind — R1 AI Identity System PRD 透出 (3 类: AI Native / Twin / Detection).
  //   server 暂不传, 全部 undefined → 跟以前一样. client-side 可以填 mock 帖表记.
  aiAuthorKind: z.enum(["NATIVE", "TWIN", "DETECTED"]).optional(),
  body: z.string(),
  mediaRefs: z.array(PostMediaRefSchema).default([]),
  visibility: z.enum(["PUBLIC", "FOLLOWERS", "AGENT_ONLY"]).optional(),
  cityScope: z.string().optional(),
  // R15.15 P1: Post.SceneType — 解锁 per-(city, sceneType) 背景
  // 缓存。不传 = UNKNOWN，listFeed 仍查到样本 (只是会跌进
  // UNKNOWN 同一区。
  sceneType: z.enum(["UNKNOWN", "ROOFTOP", "BRUNCH", "SPA", "CINEMA", "PHOTO", "NIGHTLIFE", "OUTDOOR", "COFFEE", "FOOD", "WALK", "MARKET", "BIKE", "DINNER", "ACTIVITY"]).optional(),
  status: z.string(),
  contextRefs: z.array(PostContextRefSchema).default([]),
  createdAt: z.string(),
  // R15.24 P0：Post.EphemeralUntil — 临时动态到期时间。
  // 已过期帖子 feed 不返回（除非显式未过滤）。不传 = 永久动态。
  ephemeralUntil: z.string().optional(),
  // R15.24 P0：Post.Poll — 帖内投票。
  poll: PostPollSchema.optional()
});
export type FeedPost = z.infer<typeof FeedPostSchema>;

export const MediaVariantPurposeSchema = z.enum([
  "ORIGINAL", "FEED_1X", "FEED_2X", "GALLERY", "SHARE_OG", "PLACEHOLDER"
]);
export type MediaVariantPurpose = z.infer<typeof MediaVariantPurposeSchema>;

export const MediaVariantSchema = z.object({
  mediaVariantId: z.string().min(1),
  mediaAssetId: z.string().min(1),
  purpose: MediaVariantPurposeSchema,
  recipeVersion: z.string().min(1),
  format: z.string().min(1),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative().optional(),
  url: z.string().min(1),
  contentHash: z.string().optional(),
  status: z.enum(["PROCESSING", "READY", "FAILED", "REMOVED"])
});
export type MediaVariant = z.infer<typeof MediaVariantSchema>;

// 语音推文上限：录音与上传校验共用。服务端超时长的音频资产直接拒绝。
export const MAX_AUDIO_DURATION_MS = 30_000;

export const FeedMediaItemSchema = z.object({
  mediaAssetId: z.string().min(1),
  mediaType: z.enum(["IMAGE", "VIDEO", "AUDIO"]),
  thumbnailUrl: z.string().optional(),
  playbackUrl: z.string().optional(),
  placeholderUrl: z.string().optional(),
  feedUrl: z.string().optional(),
  feed2xUrl: z.string().optional(),
  feed2xHintUrl: z.string().optional(),
  feed2xNaturalUrl: z.string().optional(),
  galleryUrl: z.string().optional(),
  dominantColorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  originalAvailable: z.boolean().optional(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  aspectRatio: z.number(),
  durationMs: z.number().int().nonnegative().optional(),
  animated: z.boolean().optional(),
  processingStatus: z.string(),
  moderationStatus: z.enum([
    "QUARANTINED",
    "APPROVED",
    "REJECTED_TECHNICAL",
    // R15.17: 内容拒 — admin 手动 review 路径
    // 现在是状态机位, 不接 production 默认门, 仅给
    // ReviewMediaAsset (operator-gated) 写入。未来 AI 内容审核
    // 接入也走 ReviewMediaAsset, 不在 server 隐式 reject。
    "REJECTED_CONTENT_NUDITY",
    "REJECTED_CONTENT_POLITICS",
    "REJECTED_CONTENT_VIOLENCE"
  ]),
  sortOrder: z.number().int().nonnegative(),
  // 服务端 composition hint（§5.2.2）。可选；缺时前端走启发式。
  compositionHint: MediaCompositionHintSchema.optional()
});
export type FeedMediaItem = z.infer<typeof FeedMediaItemSchema>;

export const ListFeedPostsPayloadSchema = z.object({
  posts: z.array(FeedPostSchema),
  media: z.record(z.string(), z.array(FeedMediaItemSchema)).default({}),
  note: z.string().optional(),
  // R15.14: 回显服务端实际使用的过滤 city。客户端用这个字段证明
  // 顶 chip “查看 · 河内” 与 feed content 真的同源。如果客户端传
  // viewingCity=“河内” 服务端仅河内帖子过滤，field 就是 “河内”；
  // 不传或空，服务端全量，field 也会是 undefined。无法静默降级。
  viewingCity: z.string().optional(),
  // R15.14: 同样回显全量不过滤 (client 没传或传 "" 等于 “全量”).
  unfiltered: z.boolean().optional(),
  nextCursor: z.string().optional(),
  hasMore: z.boolean().optional()
});
export type ListFeedPostsPayload = z.infer<typeof ListFeedPostsPayloadSchema>;

export const CreatePostPayloadSchema = z.object({
  authorType: z.enum(["USER", "AGENT", "MERCHANT", "PLATFORM_SPECIAL"]).optional(),
  authorDisplayName: z.string().optional(),
  body: z.string(),
  mediaRefs: z.array(PostMediaRefSchema).max(6).optional(),
  visibility: z.enum(["PUBLIC", "FOLLOWERS", "AGENT_ONLY"]).optional(),
  cityScope: z.string().optional(),
  // R15.15 P1: Post.SceneType。Server 在 CreatePost 处
  // 验证合法性。不传=UNKNOWN（依然合规）。发虚假值服务器 reject。
  // R15.22 扩: 同 FeedPostSchema.sceneType — 加 FOOD/WALK/MARKET/BIKE/
  // DINNER/ACTIVITY, 保持两端一致.
  sceneType: z.enum([
    "UNKNOWN",
    "ROOFTOP",
    "BRUNCH",
    "SPA",
    "CINEMA",
    "PHOTO",
    "NIGHTLIFE",
    "OUTDOOR",
    "COFFEE",
    "FOOD",
    "WALK",
    "MARKET",
    "BIKE",
    "DINNER",
    "ACTIVITY"
  ]).optional(),
  contextRefs: z.array(PostContextRefSchema).optional(),
  // R15.24 P0：可携带 ephemeralUntil 和 poll。后端尚未实现，发送时
  // client 仍然走 body 序列化作为兼容路径。等后端落地后，本字段成为单一事实来源。
  ephemeralUntil: z.string().optional(),
  poll: PostPollSchema.optional()
});
export type CreatePostPayload = z.infer<typeof CreatePostPayloadSchema>;

// ---- Activity 读模型（活动页服务端驱动）----

// ActivitySchema：本地活动读模型 wire 契约。
//
// 设计原则 (R16.x 能力边界冻结)：
//   * origin ∈ { PLATFORM, MERCHANT, USER, TEST } — AI 永远不是 origin
//     主体，AI 是 platform/merchant/user 在“起草”阶段的助理
//     (aiStatus=AI_ASSISTED 或 AI_GENERATED)。
//   * aiStatus 标识“内容生成方式”：NONE = 真人手写；AI_ASSISTED =
//     AI 改写/提醒；AI_GENERATED = AI 生成 (平台或商家作为发布方)。
//   * aiActorKind 标识“AI 是哪个助理”：PLATFORM_AI = 平台 AI 小美，
//     USER_TWIN = 用户数字分身 (需 LC-07 consent)，USER_ASSISTANT =
//     用户助理 (起草类)。
//   * MoneyFlow / PriceLabel 把“金额”跟“资金方向”拆开：MoneyFlow ∈
//     {FREE, PAY_TO_JOIN, PAID_TO_ATTEND}，PriceLabel 是中文语义副本
//     (免费参加 / 你需支付 / 参加后你可获得)。server 端 normalize
//     后下发，客户端不允许传空。
export const ActivitySchema = z.object({
  activityId: z.string().min(1),
  origin: z.enum(["PLATFORM", "MERCHANT", "USER", "TEST"]),
  title: z.string().min(1),
  time: z.string(),
  people: z.string(),
  price: z.string(),
  moneyFlow: z.enum(["FREE", "PAY_TO_JOIN", "PAID_TO_ATTEND"]),
  priceLabel: z.string().min(1),
  consumption: z.string(),
  venueIcon: z.string(),
  venueName: z.string(),
  realitySceneId: z.string().min(1).optional(),
  venueSpend: z.string(),
  venueType: z.enum(["CAFE", "RESTAURANT", ""]),
  venueTypeLabel: z.string(),
  // 活动封面图（R17.x 预留）：HTTPS URL，上传管线接好之前 server 不下发，
  // 客户端无此字段时必须显示诚实占位（不得用假图冒充实拍）。
  coverImageUrl: z.string().min(1).optional(),
  desc: z.string(),
  benefit: z.string(),
  qaCount: z.number().int().nonnegative(),
  interested: z.number().int().nonnegative(),
  joined: z.number().int().nonnegative(),
  capacity: z.number().int().positive().optional(),
  shares: z.number().int().nonnegative(),
  parentTitle: z.string().optional(),
  ownerId: z.string().optional(),
  status: z.enum(["PUBLISHED", "CANCELLED"]).optional(),
  consumptionTerm: z.enum(["SPLIT", "HOST_COVERS"]).optional(),
  // AI 助理信息。aiStatus != NONE 时客户端必显示 AI 标注 + persona
  // 头像 + 名字 (跟 X / Threads / 抖音 / 小红书的 "AI 生成" 标注
  // 一致)。aiPersona* 三件只当 aiStatus 表明是 AI 生成/辅助时才下发，
  // 其他情况 omitempty。
  aiPersonaId: z.string().min(1).optional(),
  aiPersonaName: z.string().min(1).optional(),
  aiPersonaAvatar: z.string().optional(),
  // R17.x: 平台 AI 角色 photo 资产引用。ai_001-ai_005 都有 SVG
  // 头像 (apps/mobile/assets/ai-personas/) — 三件套 (id / name /
  // photo) 一同下发, mobile 端 Image 组件优先 photo, fallback
  // 到 avatar emoji. 不允许“看起来像真人": photo 是 AI-rendered
  // 头像, 不是真人拍提. (PR LC-07 语义在 aipersona service.
  // LikenessConsent 走 — ActivitySchema 只负责 wire contract.)
  aiPersonaPhoto: z.string().min(1).optional(),
  aiStatus: z.enum(["NONE", "AI_ASSISTED", "AI_GENERATED"]).default("NONE"),
  aiActorKind: z.enum(["PLATFORM_AI", "USER_TWIN", "USER_ASSISTANT"]).optional()
});
export type Activity = z.infer<typeof ActivitySchema>;

export const ListActivitiesPayloadSchema = z.object({
  activities: z.array(ActivitySchema),
  note: z.string().optional()
});
export type ListActivitiesPayload = z.infer<typeof ListActivitiesPayloadSchema>;

// ListMyActivitiesPayloadSchema：R17.x "我的活动" 物化路径。返回
// actor-scoped 两个数组 — created (我发起的) + joined (我参加的)。
// 两个数组都是 activityId 唯一排序 (服务侧 created_at DESC);
// 客户端可以一次走完两个 tab，不需要走两次 server。
export const ListMyActivitiesPayloadSchema = z.object({
  created: z.array(ActivitySchema),
  joined: z.array(ActivitySchema),
  note: z.string().optional()
});
export type ListMyActivitiesPayload = z.infer<typeof ListMyActivitiesPayloadSchema>;

// MarketOpportunitySchema：机会读模型 wire 契约。
//
// 设计原则 (R16.x 资金方向冻结)：
//   * Price + MoneyFlow + PriceLabel 三件总是同步下发，缺一不可。
//   * MoneyFlow ∈ { EARN, PAY, FREE, TBD } — 表达"价格栏究竟是什
//     么"。EARN = 接单者赚；PAY = 接单者付；FREE = 0₫；TBD = 费用
//     待确认（双方面谈，公开卡片不显示金额）。
//   * server 端 normalizeOpportunityMoney() 强制 4 选 1，客户端禁止
//     传空 MoneyFlow。PriceLabel 是中文语义副本（完成后你可获得 /
//     你需支付 / 免费 / 费用待确认）。
//   * 客户端不允许"裸金额"——任何一个 Opportunity 在 wire 上必须
//     三件齐备，否则 zod parse 会拒绝。这与 Activity 规则保持一致。
export const MarketOpportunityMoneyFlowSchema = z.enum(["EARN", "PAY", "FREE", "TBD"]);
export type MarketOpportunityMoneyFlow = z.infer<typeof MarketOpportunityMoneyFlowSchema>;

export const MarketOpportunitySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  shortTitle: z.string(),
  theme: z.string(),
  date: z.string(),
  time: z.string(),
  location: z.string().min(1),
  price: z.string(),
  moneyFlow: MarketOpportunityMoneyFlowSchema,
  priceLabel: z.string().min(1),
  owner: z.string().min(1),
  ownerType: z.enum(["BUSINESS", "PERSON"]),
  match: z.string(),
  responses: z.number().int().nonnegative(),
  posted: z.string(),
  skills: z.string(),
  verified: z.boolean(),
  lens: z.array(z.enum(["NOW", "NEARBY", "BOOKED", "REMOTE"])).min(1),
  travel: z.number().int().nullable(),
  signal: z.string(),
  signalClass: z.string(),
  countdown: z.string(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  travelSource: z.enum(["seeded", "user_distance", "unknown"]).optional(),
  ownedByViewer: z.boolean().optional(),
  appliedByViewer: z.boolean().optional(),
  viewerApplicationId: z.string().optional(),
  viewerApplicationStatus: z.enum(["SUBMITTED", "SELECTED", "NOT_SELECTED", "CONFIRMED"]).optional(),
  viewerOrderRef: z.string().optional()
});
export type MarketOpportunity = z.infer<typeof MarketOpportunitySchema>;

export const ListMarketOpportunitiesPayloadSchema = z.object({
  opportunities: z.array(MarketOpportunitySchema)
});
export type ListMarketOpportunitiesPayload = z.infer<typeof ListMarketOpportunitiesPayloadSchema>;

export const PublishMarketOpportunityPayloadSchema = z.object({
  opportunity: MarketOpportunitySchema
});
export type PublishMarketOpportunityPayload = z.infer<typeof PublishMarketOpportunityPayloadSchema>;

// PublishMarketOpportunityInputSchema：机会发布路径（client → server）
// 的 wire 契约。跟 MarketOpportunitySchema 读模型不同：读模型是
// server-authoritative 完整 row（含 id/owner/responses/posted/verified
// 等 server-only 字段），发布输入只包含 publisher 能填的字段。
//
// R16.x (MONEYFLOW-004) 明确 PriceLabel 是 server-authoritative：client
// 可以不传 / 传空 / 传任何值，server normalizeOpportunityMoney() 都
// 会推 opportunityPriceLabel(MoneyFlow)。这里把 priceLabel 设为
// optional 是为“防误传”提供 schema 级保证，client SDK
// 不会再“必须“带中文文案。
export const PublishMarketOpportunityInputSchema = z.object({
  title: z.string().min(1),
  shortTitle: z.string(),
  theme: z.string(),
  date: z.string(),
  time: z.string(),
  location: z.string().min(1),
  price: z.string(),
  moneyFlow: MarketOpportunityMoneyFlowSchema,
  priceLabel: z.string().optional(),
  skills: z.string(),
  lens: z.array(z.enum(["NOW", "NEARBY", "BOOKED", "REMOTE"])).min(1),
  travel: z.number().int().nullable().optional()
});
export type PublishMarketOpportunityInput = z.infer<typeof PublishMarketOpportunityInputSchema>;

export const MarketApplicationSchema = z.object({
  applicationId: z.string().min(1),
  opportunityId: z.string().min(1),
  applicantId: z.string().min(1),
  quote: z.string().min(1),
  scope: z.string(),
  status: z.enum(["SUBMITTED", "SELECTED", "NOT_SELECTED", "CONFIRMED"]),
  createdAt: z.string().min(1),
  selectedAt: z.string().optional(),
  confirmedAt: z.string().optional(),
  orderRef: z.string().optional()
});
export type MarketApplication = z.infer<typeof MarketApplicationSchema>;

export const ListMarketApplicationsPayloadSchema = z.object({ applications: z.array(MarketApplicationSchema) });
export const MarketApplicationPayloadSchema = z.object({ application: MarketApplicationSchema, orderRef: z.string().optional() });

export const ActivityRefPayloadSchema = z.object({
  activityId: z.string().min(1)
});
export type ActivityRefPayload = z.infer<typeof ActivityRefPayloadSchema>;

export const ToggleActivityInterestPayloadSchema = z.object({
  activity: ActivitySchema,
  interested: z.boolean()
});
export type ToggleActivityInterestPayload = z.infer<typeof ToggleActivityInterestPayloadSchema>;

export const JoinActivityPayloadSchema = z.object({
  activity: ActivitySchema,
  joined: z.boolean()
});
export type JoinActivityPayload = z.infer<typeof JoinActivityPayloadSchema>;


// ---- Experience Manifest R1 (Server-driven navigation) ----
//
// Apple-safe boundary:
// - server sends structured data/configuration only
// - client executes only pre-registered action vocabulary
// - no remote JS / JSX / executable code
//
// R1 deliberately supports only the first proven navigation slice:
// Me -> Tasks / Need
// Me -> Tasks / Activity / Mine
export const ExperienceContextSchema = z.enum([
  "REQUESTER",
  "BUSINESS"
]);
export type ExperienceContext = z.infer<typeof ExperienceContextSchema>;

export const TasksExperienceParamsSchema = z.object({
  view: z.enum(["NEED", "ACTIVITY"]),
  filter: z
    .enum(["RECOMMENDED", "CAFE", "RESTAURANT", "MINE"])
    .optional()
}).strict();

export type TasksExperienceParams = z.infer<typeof TasksExperienceParamsSchema>;

export const ExperienceOpenTasksActionSchema = z.object({
  type: z.literal("OPEN_SURFACE"),
  surface: z.literal("TASKS"),
  params: TasksExperienceParamsSchema
}).strict();

export const RegisteredExperienceRouteSchema = z.enum([
  "personalhub",
  "socialidentity",
  "socialanalytics",
  "messages",
  "addfriend",
  "friendcrm",
  "available",
  "myorders",
  "myactivities",
  "favorites",
  "wallet",
  "appbehavior",
  "bdash",
  "vouchers"
]);
export type RegisteredExperienceRoute = z.infer<typeof RegisteredExperienceRouteSchema>;

export const ExperienceOpenRegisteredRouteActionSchema = z.object({
  type: z.literal("OPEN_REGISTERED_ROUTE"),
  route: RegisteredExperienceRouteSchema
}).strict();

export const ExperienceActionSchema = z.discriminatedUnion("type", [
  ExperienceOpenTasksActionSchema,
  ExperienceOpenRegisteredRouteActionSchema
]);
export type ExperienceAction = z.infer<typeof ExperienceActionSchema>;

export const ExperienceMenuItemSchema = z.object({
  id: z.string().min(1),
  icon: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  accent: z.boolean().optional(),
  action: ExperienceActionSchema
}).strict();
export type ExperienceMenuItem = z.infer<typeof ExperienceMenuItemSchema>;

export const ExperienceMenuSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  hint: z.string().optional(),
  items: z.array(ExperienceMenuItemSchema)
}).strict();
export type ExperienceMenuSection = z.infer<typeof ExperienceMenuSectionSchema>;

export const ExperienceManifestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  revision: z.string().min(1),
  context: ExperienceContextSchema,
  me: z.object({
    mode: z.enum(["MERGE", "REPLACE"]).optional(),
    sections: z.array(ExperienceMenuSectionSchema)
  }).strict()
}).strict();

export type ExperienceManifest = z.infer<typeof ExperienceManifestSchema>;

// Media Composition Hint (Social Media Pipeline §5.2.2) — re-export from sibling module
import { MediaCompositionHintSchema } from "./media-composition";
export {
  MediaSubjectTypeSchema,
  MediaBoxSchema,
  MediaCompositionHintSchema,
  resolveFillStrategy,
  canSafelyCover,
  shouldUseExtendedBackdrop,
  selectVariantForViewport,
  selectVideoPlaybackUrl,
  isForbiddenInFeed,
  isFrameBackgroundSafe,
  resolveFrameBackground,
  FEED_WIDE_BREAKPOINT_PT,
  FRAME_BACKGROUND_HEX,
  FEED_FORBIDDEN_PURPOSES,
  selectImageShape,
  PREFERRED_FORWARD_BUFFER_SECONDS,
  COLD_START_TO_FIRST_FRAME_BUDGET_MS,
  shouldPreloadVideo,
  FULLSCREEN_MODE
} from "./media-composition";
export type {
  MediaSubjectType,
  MediaBox,
  MediaCompositionHint,
  MediaFillStrategy,
  ImageShape,
  FullscreenMode
} from "./media-composition";
import type { FeedRenderVariant, FeedRenderSelection } from "./media-composition";
export type { FeedRenderVariant, FeedRenderSelection };

// Scene Value Exchange R15.13 — re-export
export * from "./scene";
// Context-Driven Experience Runtime — re-export
export * from "./experience-runtime";
// R15.22: canonical city key (LocationContext.filter ↔ Post.CityScope).
// The mobile cache store and LocationContext composer both import
// normalizeCityKey from "@proxy/contracts"; re-exporting here keeps the
// single-source-of-truth in src/city-key.ts.
export * from "./city-key";

// R15.25: FACET — object-oriented content operation (Phase 1 = list only).
// Single-source-of-truth for the wire shape. Both mobile (FacetHomeSurface)
// and the localnet GET handler (facet-objects.go) import from this module,
// so any rename forces a compile error on both ends.
export * from "./facet";
export * from "./engagement";

// R15.33: map contracts 撤了 — 独立 map tab 已删。
