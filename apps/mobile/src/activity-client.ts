// Activity 客户端：活动读模型（ListActivities）+ 感兴趣/参加命令。
// 计数服务端权威；operationRef 承载 payload（zod 校验，fail-closed）。
import type { Activity, ActivityJoinRecipe, CommandResult, CompanionBookedSlot, JoinActivityPayload, ListMyActivitiesPayload } from "@proxy/contracts";
import { ActivitySchema, JoinActivityPayloadSchema, ListActivitiesPayloadSchema, ListCompanionBookedSlotsPayloadSchema, ListMyActivitiesPayloadSchema, PUBLIC_NUMBER_PATTERN, ToggleActivityInterestPayloadSchema } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import { requireAuthenticatedServerSession, type SecureSessionStore, type StoredSession } from "./secure-session";
import { commandErrorMessage } from "./command-error-message";

export type ActivityCommandTransport = {
  request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse>;
  requestPublic?(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse>;
};

export type ActivityClientOptions = {
  authClient: ActivityCommandTransport;
  secureSessionStore: SecureSessionStore;
  now?: () => Date;
};

export type PublishActivityInput = {
  title: string;
  time: string;
  capacity: number;
  venueName: string;
  venueIcon: string;
  venueType: "CAFE" | "RESTAURANT" | "PARK" | "LAKE" | "STREET" | "OTHER";
  realitySceneId: string;
  desc: string;
  consumptionTerm: "SPLIT" | "HOST_COVERS";
  // R58: 报名方式 + 主题（可选，不传按 OPEN / 无主题）。
  signupMode?: "OPEN" | "REVIEW" | "INVITE_ONLY";
  theme?: string;
  // MERCHANT-PUBLISH-001: 以商家名义发布时带店 id（server 验成员后盖章）。
  // 个人发布不传。
  merchantId?: string;
  // ACTIVITY-COVER-001: 封面图的**媒体资产 id**，不是 URL —— 先用 MediaClient
  // 上传拿到 mediaAssetId 再传这里。服务端只认能安全拼成 thumb URL 的裸 token。
  coverMediaAssetId?: string;
};

export class ActivityProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ActivityProtocolError";
  }
}

export class ActivityCommandRejectedError extends Error {
  public constructor(public readonly result: CommandResult) {
    super(commandErrorMessage(result.error, "activity command rejected"));
    this.name = "ActivityCommandRejectedError";
  }
}

// 报名失败说人话（各 Surface 共用）：调用方曾经把所有失败都报成
// "登录后重试"或直接吞掉。按错因分流——没登录/掉登录才提登录，
// 报过名/满员/活动没了说具体事，其他归网络或稍后重试。
// 文案与 requester-home 的 joinErrorMessage 对齐。
export function describeJoinError(error: unknown): string {
  if (error instanceof ActivityCommandRejectedError) {
    switch (error.result.error?.errorCode) {
      case "ACTIVITY_ALREADY_JOINED":
        return "你已报过名，不用重复点";
      case "ACTIVITY_FULL":
        return "名额已满，下次早点来";
      case "ACTIVITY_NOT_FOUND":
        return "该活动不存在或已结束";
      case "ACTIVITY_ACTOR_REQUIRED":
      case "AI_ACTION_FORBIDDEN":
        return "登录已过期，请重新登录";
      default:
        return "报名失败，请稍后重试";
    }
  }
  if (error instanceof ActivityProtocolError) {
    // requireSession 把原错包了一层，只剩 message 可认。
    if (/principal is required|offline fallback|signed out|re-authenticate|sign in/i.test(error.message)) {
      return "登录后可报名";
    }
    return "报名失败，请稍后重试";
  }
  return "网络异常，请检查连接后重试";
}

// ACT-ORDER-NO-001 / HOME-FORYOU-ORDER-004：这单之前就下过（ACTIVITY_ALREADY_JOINED）
// 时，服务端在 safeDetails.orderNo 里回传既有编号 —— 票本来就在你手上，照样显示。
// 形状判据用契约里那一份 PUBLIC_NUMBER_PATTERN（16 位起：main 时代的旧号也算），
// 不要在这里自己写死 `{21,}` —— 旧号被这里挡掉，用户看到的是"没有编号"。
export function orderNoFromJoinRejection(error: unknown): string | undefined {
  if (!(error instanceof ActivityCommandRejectedError)) return undefined;
  if (error.result.error?.errorCode !== "ACTIVITY_ALREADY_JOINED") return undefined;
  const orderNo = error.result.error.safeDetails?.["orderNo"];
  return typeof orderNo === "string" && PUBLIC_NUMBER_PATTERN.test(orderNo) ? orderNo : undefined;
}

export class ActivityClient {
  private commandSequence = 0;

  public constructor(private readonly input: ActivityClientOptions) {}

  public async listActivities(): Promise<Activity[]> {
    // R15.22 fix: 匿名 iPhone 端也要看到活动计数 (Home tab "机会 / 活动"硬编码
    // 24/46/18 随 R15.22 WIP 被改为 API 加载 — server 端 ListActivities 不限
    // actor type, 仅需 optional session, 不再要 requireSession.
    const result = await this.sendCommand(undefined, "ListActivities", { type: "Activity", id: "local" }, {});
    return parseActivityList(this.decodeOperationRef(result));
  }

  // R17.x: 我的活动物化路径。返回 actor-scoped created + joined
  // 两个数组. server 侧 必须authenticated, 所以
  // requireSession 不是 optional (否则 server 会拒绝).
  // 返回 ListMyActivitiesPayload shape.
  public async listMyActivities(): Promise<ListMyActivitiesPayload> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "ListMyActivities", { type: "Activity", id: "mine" }, {});
    // ACT-LIST-TOLERANT-001：created / joined 也逐条校验——报过名的脏活动不能让
    // 「我的订单」和 For You 的下单守卫一起读不出来。
    const raw = this.decodeOperationRef(result) as { created?: unknown; joined?: unknown } | undefined;
    return ListMyActivitiesPayloadSchema.parse({
      ...(raw ?? {}),
      created: parseActivityList({ activities: Array.isArray(raw?.created) ? raw.created : [] }),
      joined: parseActivityList({ activities: Array.isArray(raw?.joined) ? raw.joined : [] }),
    });
  }

  // FOR-YOU-SLOT-001：这批小美里哪些时段已经被约走了（任何人约的都算）。For You 四宫格
  // 用它判断「这个人在这个时段还有没有空」。
  public async listCompanionBookedSlots(companionIds: readonly string[]): Promise<CompanionBookedSlot[]> {
    if (companionIds.length === 0) return [];
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "ListCompanionBookedSlots", { type: "Activity", id: "companion-slots" }, { companionIds: [...companionIds] });
    return ListCompanionBookedSlotsPayloadSchema.parse(this.decodeOperationRef(result)).slots;
  }

  public async toggleInterest(activityId: string): Promise<{ activity: Activity; interested: boolean }> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "ToggleActivityInterest", { type: "Activity", id: activityId }, { activityId });
    return ToggleActivityInterestPayloadSchema.parse(this.decodeOperationRef(result));
  }

  // ORDER-RECIPE-001：recipe 是 For You 下单时选定的组合，服务端存进票面快照。
  // ACT-ORDER-NO-001：返回里带 participation（含这笔报名自己的全数字订单编号）和票面快照。
  public async join(activityId: string, recipe?: ActivityJoinRecipe): Promise<JoinActivityPayload> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "JoinActivity", { type: "Activity", id: activityId }, recipe ? { activityId, recipe } : { activityId });
    return JoinActivityPayloadSchema.parse(this.decodeOperationRef(result));
  }

  public async publish(input: PublishActivityInput): Promise<Activity> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "PublishActivity", { type: "Activity", id: "new" }, { ...input });
    const body = this.decodeOperationRef(result) as { activity?: unknown };
    return ActivitySchema.parse(body.activity);
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    try {
      return await requireAuthenticatedServerSession({ store: this.input.secureSessionStore });
    } catch (error) {
      throw new ActivityProtocolError(error instanceof Error ? error.message : "an authenticated principal is required");
    }
  }

  // R15.22 fix: 同 LocalNetClient.optionalSession — server 端 ListActivities
  // (server.go: server listActivities) 不需 actor, 读 anonymouse 读 OK.
  // 报 "an authenticated principal is required" 是 R15.22 WIP 沿用
  // requireSession 造成 — 匿名本可读. 读 session 本身抛错 (keychain
  // entitlement 缺失) 时 返回 undefined, 跳过 actor/principal 字段.
  private async optionalSession(): Promise<(StoredSession & { principal: NonNullable<StoredSession["principal"]> }) | undefined> {
    try {
      const session = await this.input.secureSessionStore.read();
      return session?.principal ? (session as StoredSession & { principal: NonNullable<StoredSession["principal"]> }) : undefined;
    } catch {
      return undefined;
    }
  }

  private async sendCommand(
    session: (StoredSession & { principal: NonNullable<StoredSession["principal"]> }) | undefined,
    commandType: string,
    target: { type: string; id: string },
    payload: Record<string, unknown>
  ): Promise<CommandResult> {
    const commandId = this.nextId("command");
    // R15.22 fix: optionalSession 允许匿名走 PUBLIC actor (同
    // LocalNetClient.optionalSession 模式). server 端 requiresAuthentication
    // 不会拒 ListActivities.
    const envelope = {
      commandId,
      commandType,
      commandVersion: 1,
      actor: session ? { type: "USER", id: session.userAccountId } : { type: "PUBLIC", id: "anonymous_reader" },
      principal: session?.principal ?? { type: "PUBLIC", id: "anonymous_reader" },
      target,
      idempotencyKey: this.nextId("idempotency"),
      authContext: session ? { sessionId: session.auth.sessionId } : {},
      purpose: "local_activity_hub",
      correlationId: this.nextId("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload
    };
    const request = commandType === "ListActivities" && this.input.authClient.requestPublic
      ? this.input.authClient.requestPublic.bind(this.input.authClient)
      : this.input.authClient.request.bind(this.input.authClient);
    const response = await request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new ActivityProtocolError("activity command response was malformed");
    if (result.outcome === "REJECTED") throw new ActivityCommandRejectedError(result);
    if (response.status < 200 || response.status >= 300) {
      throw new ActivityProtocolError(`unexpected activity command status: ${response.status}`);
    }
    return result;
  }

  private decodeOperationRef(result: CommandResult): unknown {
    if (!result.operationRef) throw new ActivityProtocolError("activity response missing operationRef");
    try {
      return JSON.parse(result.operationRef);
    } catch {
      throw new ActivityProtocolError("activity operationRef was not valid JSON");
    }
  }

  private nextId(prefix: string): string {
    this.commandSequence += 1;
    return `mobile_activity_${prefix}_${Date.now().toString(36)}_${this.commandSequence.toString(36)}`;
  }
}

/**
 * ACT-LIST-TOLERANT-001（用户「最近 for you 特别烂 搞坏了」2026-10-04）：活动列表以前
 * 整包 zod 校验——只要有**一条**活动不合规，整个列表就解析失败，调用方 catch 掉之后
 * 拿到的是空列表：For You 四宫格整块消失，市场活动也一起空。实测根因：共享开发库里
 * 被集成测试写进去 36 条脏活动，其中 6 条 origin 是空串。现在逐条校验，不合规的
 * 那几条丢掉（打一条 warn），其余照常显示。
 */
export function parseActivityList(raw: unknown): Activity[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { activities?: unknown }).activities)
    ? (raw as { activities: unknown[] }).activities
    : undefined;
  if (!list) return ListActivitiesPayloadSchema.parse(raw).activities;
  const out: Activity[] = [];
  let dropped = 0;
  for (const item of list) {
    const parsed = ActivitySchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
    else dropped += 1;
  }
  if (dropped > 0 && typeof console !== "undefined") console.warn(`ListActivities: dropped ${dropped} malformed activit${dropped === 1 ? "y" : "ies"}`);
  return out;
}
