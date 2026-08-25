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
  "RefreshSession"
]);
export type IdentityCommandType = z.infer<typeof IdentityCommandTypeSchema>;

export const PrincipalContextSchema = z.object({
  type: z.enum(["INDIVIDUAL", "BUSINESS"]),
  id: z.string().min(1)
});
export type PrincipalContext = z.infer<typeof PrincipalContextSchema>;

export const CreateAnonymousSessionPayloadSchema = z.object({
  deviceId: z.string().min(1),
  platform: z.enum(["IOS", "ANDROID"])
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
  refreshToken: z.string().min(1)
});
export type RefreshSessionPayload = z.infer<typeof RefreshSessionPayloadSchema>;

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

export const FeedPostSchema = z.object({
  postId: z.string().min(1),
  authorType: z.enum(["USER", "AGENT", "MERCHANT", "PLATFORM_SPECIAL"]),
  authorId: z.string().min(1),
  authorDisplayName: z.string().optional(),
  body: z.string(),
  mediaRefs: z.array(PostMediaRefSchema).default([]),
  visibility: z.enum(["PUBLIC", "FOLLOWERS", "AGENT_ONLY"]).optional(),
  cityScope: z.string().optional(),
  status: z.string(),
  contextRefs: z.array(PostContextRefSchema).default([]),
  createdAt: z.string()
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

export const FeedMediaItemSchema = z.object({
  mediaAssetId: z.string().min(1),
  mediaType: z.enum(["IMAGE", "VIDEO"]),
  thumbnailUrl: z.string().optional(),
  playbackUrl: z.string().optional(),
  placeholderUrl: z.string().optional(),
  feedUrl: z.string().optional(),
  feed2xUrl: z.string().optional(),
  galleryUrl: z.string().optional(),
  originalAvailable: z.boolean().optional(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  aspectRatio: z.number(),
  durationMs: z.number().int().nonnegative().optional(),
  processingStatus: z.string(),
  moderationStatus: z.enum(["QUARANTINED", "APPROVED", "REJECTED_TECHNICAL"]),
  sortOrder: z.number().int().nonnegative()
});
export type FeedMediaItem = z.infer<typeof FeedMediaItemSchema>;

export const ListFeedPostsPayloadSchema = z.object({
  posts: z.array(FeedPostSchema),
  media: z.record(z.string(), z.array(FeedMediaItemSchema)).default({}),
  note: z.string().optional()
});
export type ListFeedPostsPayload = z.infer<typeof ListFeedPostsPayloadSchema>;

export const CreatePostPayloadSchema = z.object({
  authorType: z.enum(["USER", "AGENT", "MERCHANT", "PLATFORM_SPECIAL"]).optional(),
  authorDisplayName: z.string().optional(),
  body: z.string(),
  mediaRefs: z.array(PostMediaRefSchema).max(6).optional(),
  visibility: z.enum(["PUBLIC", "FOLLOWERS", "AGENT_ONLY"]).optional(),
  cityScope: z.string().optional(),
  contextRefs: z.array(PostContextRefSchema).optional()
});
export type CreatePostPayload = z.infer<typeof CreatePostPayloadSchema>;

// ---- Activity 读模型（活动页服务端驱动）----

export const ActivitySchema = z.object({
  activityId: z.string().min(1),
  origin: z.enum(["PLATFORM", "MERCHANT", "USER"]),
  title: z.string().min(1),
  time: z.string(),
  people: z.string(),
  price: z.string(),
  consumption: z.string(),
  venueIcon: z.string(),
  venueName: z.string(),
  venueSpend: z.string(),
  venueType: z.enum(["CAFE", "RESTAURANT"]),
  venueTypeLabel: z.string(),
  desc: z.string(),
  benefit: z.string(),
  qaCount: z.number().int().nonnegative(),
  interested: z.number().int().nonnegative(),
  joined: z.number().int().nonnegative(),
  capacity: z.number().int().positive().optional(),
  shares: z.number().int().nonnegative(),
  parentTitle: z.string().optional()
});
export type Activity = z.infer<typeof ActivitySchema>;

export const ListActivitiesPayloadSchema = z.object({
  activities: z.array(ActivitySchema),
  note: z.string().optional()
});
export type ListActivitiesPayload = z.infer<typeof ListActivitiesPayloadSchema>;

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
  "postfeed",
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
