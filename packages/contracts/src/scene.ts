import { z } from "zod";

/**
 * R15.13 Scene Value Exchange — P0 Concept Freeze
 * Doc: Proxy_Scene_Value_Exchange_Product_Engineering_R15_13.md
 * Core: Person-to-Scene Funding, Scene Independence Test, Net Acceptance
 */

// ── 6–8 Scene Tools (P0) ─────────────────────────────────────
export const SceneToolIdSchema = z.enum([
  "PHOTO",
  "COMPANION",
  "COFFEE_MEAL",
  "ACTIVITY",
  "TRIP",
  "CREATOR",
]);
export type SceneToolId = z.infer<typeof SceneToolIdSchema>;

export const SceneToolSchema = z.object({
  id: SceneToolIdSchema,
  label: z.string().min(1),
  intentPrompt: z.string().min(1),
});
export type SceneTool = z.infer<typeof SceneToolSchema>;

export const SCENE_TOOLS: ReadonlyArray<SceneTool> = [
  { id: "PHOTO", label: "拍照", intentPrompt: "想拍照" },
  { id: "COMPANION", label: "同行", intentPrompt: "找人同行" },
  { id: "COFFEE_MEAL", label: "吃饭", intentPrompt: "一起吃饭" },
  { id: "ACTIVITY", label: "活动", intentPrompt: "参加活动" },
  { id: "TRIP", label: "出去玩", intentPrompt: "出去玩" },
  { id: "CREATOR", label: "创作", intentPrompt: "找个地方坐坐" },
];

// ── Anchor (Venue / Merchant / Activity / Route / Trip) ───────
export const SceneAnchorTypeSchema = z.enum([
  "MERCHANT",
  "VENUE",
  "ACTIVITY",
  "ROUTE",
  "TRIP",
  "RESERVATION",
]);
export type SceneAnchorType = z.infer<typeof SceneAnchorTypeSchema>;

export const SceneAnchorSchema = z.object({
  type: SceneAnchorTypeSchema,
  id: z.string().min(1),
  label: z.string().min(1),
  cityScope: z.string().optional(),
});
export type SceneAnchor = z.infer<typeof SceneAnchorSchema>;

// ── Participation / Cost / Benefit (前台只露简单枚举) ──────────
export const ParticipationStructureSchema = z.enum([
  "PRIVATE_INVITE",
  "RELATIONSHIP_INVITE",
  "OPEN_SIGNUP",
  "CREATOR_INVITE",
  "MERCHANT_INVITE",
  "HYBRID",
]);
export type ParticipationStructure = z.infer<typeof ParticipationStructureSchema>;

export const CostStructureSchema = z.enum([
  "AA",
  "HOST_PAY",
  "HOST_SPONSORED",
  "MERCHANT_SPONSORED",
  "VOUCHER",
  "CREATOR_BENEFIT",
  "FREE",
]);
export type CostStructure = z.infer<typeof CostStructureSchema>;

export const BenefitKindSchema = z.enum([
  "FREE_DRINK",
  "MEAL",
  "TICKET",
  "TRANSPORT_SUPPORT",
  "VOUCHER",
  "PRIORITY_RESERVATION",
  "PHOTO_FRIENDLY_VENUE",
  "CREATOR_REWARD",
  "UPGRADE",
]);
export type BenefitKind = z.infer<typeof BenefitKindSchema>;

export const SceneBenefitSchema = z.object({
  kind: BenefitKindSchema,
  label: z.string().min(1),
  valueMinor: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  voucherId: z.string().optional(),
});
export type SceneBenefit = z.infer<typeof SceneBenefitSchema>;

// ── Scene ──────────────────────────────────────────────────────
export const SceneStatusSchema = z.enum([
  "DRAFT",
  "COMPOSING",
  "INVITING",
  "READY",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]);
export type SceneStatus = z.infer<typeof SceneStatusSchema>;

export const SceneSchema = z.object({
  sceneId: z.string().min(1),
  tool: SceneToolIdSchema,
  title: z.string().min(1),
  intent: z.string().min(1),
  anchor: SceneAnchorSchema.optional(),
  participation: ParticipationStructureSchema,
  cost: CostStructureSchema,
  benefits: z.array(SceneBenefitSchema).default([]),
  venueId: z.string().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  capacityMin: z.number().int().positive().optional(),
  capacityMax: z.number().int().positive().optional(),
  confirmedCount: z.number().int().nonnegative().default(0),
  hostUserId: z.string().min(1),
  cityScope: z.string().optional(),
  status: SceneStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Scene = z.infer<typeof SceneSchema>;

export const CreateScenePayloadSchema = z.object({
  tool: SceneToolIdSchema,
  intent: z.string().min(1).max(500),
  anchor: SceneAnchorSchema.optional(),
  participation: ParticipationStructureSchema,
  cost: CostStructureSchema,
  benefits: z.array(SceneBenefitSchema).max(10).optional(),
  venueId: z.string().min(1).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  capacityMin: z.number().int().positive().optional(),
  capacityMax: z.number().int().positive().optional(),
  cityScope: z.string().optional(),
});
export type CreateScenePayload = z.infer<typeof CreateScenePayloadSchema>;

// ── Invitation / Consent ───────────────────────────────────────
export const InvitationStatusSchema = z.enum([
  "PENDING",
  "ACCEPTED",
  "DECLINED",
  "ASK",
  "SAVED",
  "EXPIRED",
]);
export type InvitationStatus = z.infer<typeof InvitationStatusSchema>;

export const InviteCardSchema = z.object({
  what: z.string().min(1),
  where: z.string().min(1),
  when: z.string().min(1),
  who: z.string().min(1),
  whatIncluded: z.array(z.string().min(1)).default([]),
  whyYouMayLike: z.string().optional(),
  hostLabel: z.string().min(1),
  isHostParticipating: z.boolean().default(true),
});
export type InviteCard = z.infer<typeof InviteCardSchema>;

export const CreateInvitationPayloadSchema = z.object({
  sceneId: z.string().min(1),
  inviteeUserId: z.string().min(1),
  card: InviteCardSchema,
});
export type CreateInvitationPayload = z.infer<typeof CreateInvitationPayloadSchema>;

// ── Attendance / Outcome ───────────────────────────────────────
export const AttendanceStatusSchema = z.enum(["INVITED", "ACCEPTED", "ATTENDED", "NO_SHOW", "CANCELLED"]);
export type AttendanceStatus = z.infer<typeof AttendanceStatusSchema>;

export const SceneOutcomeSchema = z.object({
  sceneId: z.string().min(1),
  inviteSent: z.number().int().nonnegative(),
  inviteAccepted: z.number().int().nonnegative(),
  actualAttendance: z.number().int().nonnegative(),
  voucherRedeemed: z.number().int().nonnegative(),
  merchantSpendMinor: z.number().int().nonnegative().optional(),
  satisfaction: z.number().min(0).max(5).optional(),
  repeatInteraction: z.boolean().optional(),
});
export type SceneOutcome = z.infer<typeof SceneOutcomeSchema>;

// ── Scene Acceptance Guard ─────────────────────────────────────
export const SceneGuardResultSchema = z.enum([
  "GOOD_FIT",
  "NEEDS_REFRAMING",
  "NEEDS_MORE_SCENE_VALUE",
  "NEEDS_MORE_INFORMATION",
  "HIGH_TRANSACTION_FEELING",
  "HIGH_SAFETY_RISK",
  "NOT_RECOMMEND",
]);
export type SceneGuardResult = z.infer<typeof SceneGuardResultSchema>;

export function sceneGuardLabel(result: SceneGuardResult): string {
  switch (result) {
    case "GOOD_FIT": return "适合推荐";
    case "NEEDS_REFRAMING": return "需要重构表达";
    case "NEEDS_MORE_SCENE_VALUE": return "场景价值不足";
    case "NEEDS_MORE_INFORMATION": return "信息不完整";
    case "HIGH_TRANSACTION_FEELING": return "交易感过重";
    case "HIGH_SAFETY_RISK": return "安全风险高";
    case "NOT_RECOMMEND": return "不推荐";
  }
}

// ── Improvement suggestion order (钱最后) ─────────────────────
export const SceneImprovementKindSchema = z.enum([
  "SCENE_FIT",
  "TIME_LOCATION",
  "SOCIAL_STRUCTURE",
  "VENUE_QUALITY",
  "CONVENIENCE",
  "RELATIONSHIP",
  "BENEFIT",
  "MONETARY_SUPPORT",
]);
export type SceneImprovementKind = z.infer<typeof SceneImprovementKindSchema>;

// ── Scene Independence Test gate ───────────────────────────────
export function passesIndependenceTest(scene: Pick<Scene, "title" | "benefits" | "anchor">): boolean {
  return Boolean(scene.title && scene.anchor);
}

export const ListMyScenesPayloadSchema = z.object({ limit: z.number().int().positive().max(50).optional() });
export type ListMyScenesPayload = z.infer<typeof ListMyScenesPayloadSchema>;
export const ListMyInvitationsPayloadSchema = z.object({ limit: z.number().int().positive().max(50).optional() });
export type ListMyInvitationsPayload = z.infer<typeof ListMyInvitationsPayloadSchema>;

// ── Command Types ──────────────────────────────────────────────
// ── R15.13 P2: Memory domain (post-outcome audit trail) ──────────
//
// A Memory is what happened after the Scene was actually lived. It is
// the per-scene snapshot that the platform keeps for reputation / feed
// aesthetic asset re-use / price corridor back-pressure. One Memory
// per Scene (a re-record is an upsert, not an edit).

export const MemoryRoleSchema = z.enum(["HOST", "GUEST"]);
export type MemoryRole = z.infer<typeof MemoryRoleSchema>;

export const MemorySchema = z.object({
  memoryId: z.string().min(1),
  sceneId: z.string().min(1),
  sceneType: z.string().min(1).optional(),
  actualSpend: z.number().int().nonnegative(),
  plannedBudget: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  durationMin: z.number().int().nonnegative().optional(),
  rating: z.number().min(0).max(1).optional(),
  notes: z.string().optional(),
  createdAt: z.string().datetime(),
  // When the memory is enumerated via ListMyMemories, this role
  // reflects how the requester participated. When fetched via
  // GetMemory, the mobile UI infers role from the session's
  // userAccountId vs the memory's hostId/guestId.
  role: MemoryRoleSchema.optional(),
});
export type Memory = z.infer<typeof MemorySchema>;

export const RecordOutcomePayloadSchema = z.object({
  guestId: z.string().min(1),
  actualSpend: z.number().int().nonnegative(),
  durationMin: z.number().int().nonnegative().optional(),
  notes: z.string().max(2000).optional(),
  aestheticAssets: z.array(z.record(z.unknown())).max(20).optional(),
});
export type RecordOutcomePayload = z.infer<typeof RecordOutcomePayloadSchema>;

export const ListMyMemoriesPayloadSchema = z.object({ limit: z.number().int().positive().max(50).optional() });
export type ListMyMemoriesPayload = z.infer<typeof ListMyMemoriesPayloadSchema>;

export const GetMemoryPayloadSchema = z.object({}).strict();
export type GetMemoryPayload = z.infer<typeof GetMemoryPayloadSchema>;

// ── Command Types ──────────────────────────────────────
export const SceneCommandTypeSchema = z.enum([
  "CreateScene",
  "UpdateScene",
  "PublishScene",
  "CreateInvitation",
  "RespondInvitation",
  "RecordAttendance",
  "RecordOutcome",
  "ListMyScenes",
  "ListMyInvitations",
  // R15.13 P2: Memory commands. The mobile client must include these
  // in the SceneCommandType union so the envelope builder accepts
  // them and the dispatch path is type-checked end-to-end.
  "ListMyMemories",
  "GetMemory",
]);
export type SceneCommandType = z.infer<typeof SceneCommandTypeSchema>;
