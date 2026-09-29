// Activity 客户端：活动读模型（ListActivities）+ 感兴趣/参加命令。
// 计数服务端权威；operationRef 承载 payload（zod 校验，fail-closed）。
import type { Activity, ActivityJoinRecipe, CommandResult, JoinActivityPayload, ListMyActivitiesPayload } from "@proxy/contracts";
import { ActivitySchema, JoinActivityPayloadSchema, ListActivitiesPayloadSchema, ListMyActivitiesPayloadSchema, ToggleActivityInterestPayloadSchema } from "@proxy/contracts";
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
export function orderNoFromJoinRejection(error: unknown): string | undefined {
  if (!(error instanceof ActivityCommandRejectedError)) return undefined;
  if (error.result.error?.errorCode !== "ACTIVITY_ALREADY_JOINED") return undefined;
  const orderNo = error.result.error.safeDetails?.["orderNo"];
  return typeof orderNo === "string" && /^[0-9]{21,}$/.test(orderNo) ? orderNo : undefined;
}

export class ActivityClient {
  private commandSequence = 0;

  public constructor(private readonly input: ActivityClientOptions) {}

  public async listActivities(): Promise<Activity[]> {
    // R15.22 fix: 匿名 iPhone 端也要看到活动计数 (Home tab "机会 / 活动"硬编码
    // 24/46/18 随 R15.22 WIP 被改为 API 加载 — server 端 ListActivities 不限
    // actor type, 仅需 optional session, 不再要 requireSession.
    const result = await this.sendCommand(undefined, "ListActivities", { type: "Activity", id: "local" }, {});
    return ListActivitiesPayloadSchema.parse(this.decodeOperationRef(result)).activities;
  }

  // R17.x: 我的活动物化路径。返回 actor-scoped created + joined
  // 两个数组. server 侧 必须authenticated, 所以
  // requireSession 不是 optional (否则 server 会拒绝).
  // 返回 ListMyActivitiesPayload shape.
  public async listMyActivities(): Promise<ListMyActivitiesPayload> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "ListMyActivities", { type: "Activity", id: "mine" }, {});
    return ListMyActivitiesPayloadSchema.parse(this.decodeOperationRef(result));
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
