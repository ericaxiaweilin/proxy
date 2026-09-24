import type { CommandResult, TaskDraftChanges } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";
import { commandErrorMessage } from "./command-error-message";

export type AuthenticatedCommandTransport = {
  request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse>;
};

export type DemandClientOptions = {
  authClient: AuthenticatedCommandTransport;
  secureSessionStore: SecureSessionStore;
  now?: () => Date;
};

export class DemandCommandRejectedError extends Error {
  public constructor(public readonly result: CommandResult) {
    super(commandErrorMessage(result.error, "demand command rejected"));
    this.name = "DemandCommandRejectedError";
  }
}

export class DemandProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DemandProtocolError";
  }
}

export class DemandClient {
  private commandSequence = 0;

  public constructor(private readonly input: DemandClientOptions) {}

  public async createDraft(sourceInput: string): Promise<CommandResult> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "CreateTaskDraft", { type: "TaskDraft", id: "new" }, {
      ownerUserAccountId: session.userAccountId,
      principal: session.principal,
      sourceInput
    });
    return this.requireAcceptedAggregate(result, "TaskDraft");
  }

  public async updateDraft(draftId: string, expectedVersion: number, changes: TaskDraftChanges): Promise<CommandResult> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "UpdateTaskDraft", { type: "TaskDraft", id: draftId }, {
      expectedVersion,
      changes
    }, expectedVersion);
    return this.requireAcceptedAggregate(result, "TaskDraft");
  }

  public async previewDraft(draftId: string, expectedVersion: number): Promise<CommandResult> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "PreviewTaskDraft", { type: "TaskDraft", id: draftId }, {
      expectedVersion
    }, expectedVersion);
    return this.requireAcceptedAggregate(result, "DemandPreview");
  }

  public async publishTask(draftId: string, expectedVersion: number): Promise<CommandResult> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "PublishTask", { type: "TaskDraft", id: draftId }, {
      expectedVersion,
      online: true
    }, expectedVersion);
    if (result.outcome !== "ACCEPTED" && result.outcome !== "PENDING" && result.outcome !== "ALREADY_APPLIED") {
      throw new DemandProtocolError("publish response did not contain an actionable outcome");
    }
    return result;
  }

  // Server-backed Requester Home read model. Returns the actor's
  // in-progress drafts (lifecycle=DRAFT) and committed tasks
  // (lifecycle=COMMITTED), ordered by recency, scoped to the
  // authenticated actor. Replaces the hardcoded "CONTINUE_ITEMS"
  // placeholder in RequesterHome so the App can hydrate the Continue
  // strip on relaunch from durable server state.
  public async listHomeItems(limit: number = 10): Promise<RequesterHomeItemsPayload> {
    const session = await this.requireSession();
    const result = await this.sendCommand(session, "ListRequesterHomeItems", { type: "RequesterHomeItems", id: session.userAccountId }, {
      limit
    });
    if (result.outcome !== "ACCEPTED") {
      throw new DemandProtocolError(`home items response outcome=${result.outcome}`);
    }
    if (result.aggregate?.type !== "RequesterHomeItems") {
      throw new DemandProtocolError("home items response did not contain RequesterHomeItems aggregate");
    }
    return parseRequesterHomeItemsPayload(result.operationRef);
  }

  // R15.22 fix: RequesterHome 匿名不应误报 "加载失败". 让 caller
  // (RequesterHomeSurface) 能先查询 session 是否就绪 — 不就绪保持
  // placeholder + idle 状态, 不调 listHomeItems 避免
  // DemandProtocolError (an authenticated principal is required).
  // 读 session 本身可能拒 (expo-secure-store keychain entitlement 缺失
  // 时会抛 KeyChainException — 在 simulator / 没有设置 entitlement 的设备
  // 出现), 这种情况当作 anonymous 看待, 返回 false, 不让 caller 误报 error.
  // MATCH-LIVE-001：城市同行的真实候选（以前「找人」页显示的是前端写死的 Linh 26 单 / Mai 12 单）。
  // 先建一个城市同行需求，再按版本号拿后端排好序的候选（internal/matching：履约 / 评价 / 经验 / 响应 / 预算）。
  // meeting 在后端就是市场代码（hn / hcm），集合点文字只用于展示。
  public async listCityCompanionCandidates(input: { duration: "4H" | "8H"; language: string; market: string; budgetVnd?: number; interests?: string[] }): Promise<CityCompanionCandidate[]> {
    const session = await this.requireSession();
    const created = await this.sendCommand(session, "CreateCityCompanionNeed", { type: "CityCompanionNeed", id: "new" }, {
      duration: input.duration,
      language: input.language,
      meeting: input.market,
      interests: input.interests ?? [],
      ...(input.budgetVnd ? { budgetVnd: input.budgetVnd } : {})
    });
    const needId = created.aggregate?.type === "CityCompanionNeed" ? created.aggregate.id : undefined;
    if (created.outcome !== "ACCEPTED" || !needId) throw new DemandCommandRejectedError(created);
    const listed = await this.sendCommand(session, "ListCityCompanionCandidates", { type: "CityCompanionNeed", id: needId }, {
      expectedVersion: created.aggregate?.version ?? 1
    });
    if (listed.outcome !== "ACCEPTED" || typeof listed.operationRef !== "string") throw new DemandCommandRejectedError(listed);
    let body: { candidates?: unknown };
    try {
      body = JSON.parse(listed.operationRef) as { candidates?: unknown };
    } catch {
      throw new DemandProtocolError("candidate list response was not JSON");
    }
    if (!Array.isArray(body.candidates)) throw new DemandProtocolError("candidate list response did not contain candidates");
    return body.candidates.map(parseCityCompanionCandidate).filter((c): c is CityCompanionCandidate => c !== undefined);
  }

  public async hasAuthenticatedSession(): Promise<boolean> {
    try {
      const session = await this.input.secureSessionStore.read();
      return Boolean(session?.principal);
    } catch {
      return false;
    }
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new DemandProtocolError("an authenticated principal is required");
    // R15.34.1 P0: 拒绝离线 fallback session 发写命令
    if (session.serverSession === false) {
      throw new DemandProtocolError("creating or publishing demands requires a real sign-in (offline session cannot act)");
    }
    if (session.signedOut === true) throw new OfflineFallbackSessionError();
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private async sendCommand(
    session: StoredSession & { principal: NonNullable<StoredSession["principal"]> },
    commandType: string,
    target: { type: string; id: string },
    payload: Record<string, unknown>,
    expectedAggregateVersion?: number
  ): Promise<CommandResult> {
    const commandId = this.nextId("command");
    const envelope = {
      commandId,
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target,
      idempotencyKey: this.nextId("idempotency"),
      ...(expectedAggregateVersion !== undefined ? { expectedAggregateVersion } : {}),
      authContext: { sessionId: session.auth.sessionId },
      purpose: "requester_demand_builder",
      correlationId: this.nextId("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new DemandProtocolError("demand command response was malformed");
    if (result.outcome === "REJECTED") throw new DemandCommandRejectedError(result);
    if (response.status < 200 || response.status >= 300) {
      throw new DemandProtocolError(`unexpected demand command status: ${response.status}`);
    }
    return result;
  }

  private requireAcceptedAggregate(result: CommandResult, aggregateType: string): CommandResult {
    if ((result.outcome !== "ACCEPTED" && result.outcome !== "ALREADY_APPLIED") || result.aggregate?.type !== aggregateType) {
      throw new DemandProtocolError(`demand response did not contain ${aggregateType}`);
    }
    return result;
  }

  private nextId(prefix: string): string {
    this.commandSequence += 1;
    return `mobile_demand_${prefix}_${Date.now().toString(36)}_${this.commandSequence.toString(36)}`;
  }
}

// ---------- Requester Home read-model types ----------

export type RequesterHomeDraftItem = {
  kind: "DRAFT";
  id: string;
  lifecycle: string;
  version: number;
  sourceInput: string;
  draftProgress: number;
  lastCompletedStep: number;
  updatedAt: string;
};

export type RequesterHomeTaskItem = {
  kind: "TASK";
  id: string;
  draftId: string;
  lifecycle: string;
  version: number;
  sourceInput: string;
  createdAt: string;
};

export type RequesterHomeItemsPayload = {
  actorId: string;
  limit: number;
  drafts: RequesterHomeDraftItem[];
  tasks: RequesterHomeTaskItem[];
};

// Exported for unit tests in demand-client.test.ts. Treat the
// returned object as read-only: the consumer must not mutate
// `drafts` or `tasks` because we deliberately hand back the same
// references the server sent.
export function parseRequesterHomeItemsPayload(operationRef: string | undefined): RequesterHomeItemsPayload {
  if (!operationRef) {
    throw new DemandProtocolError("home items response missing operationRef");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(operationRef);
  } catch (error) {
    throw new DemandProtocolError(`home items operationRef not parseable: ${(error as Error).message}`);
  }
  const top = parsed as { actorId?: unknown; limit?: unknown; drafts?: unknown; tasks?: unknown };
  const actorId = typeof top.actorId === "string" ? top.actorId : "";
  const limit = typeof top.limit === "number" ? top.limit : 0;
  const drafts = Array.isArray(top.drafts) ? (top.drafts as RequesterHomeDraftItem[]) : [];
  const tasks = Array.isArray(top.tasks) ? (top.tasks as RequesterHomeTaskItem[]) : [];
  return { actorId, limit, drafts, tasks };
}

// MATCH-LIVE-001：后端候选（已排序）。hasTrackRecord=false 表示还没有完成过订单 —— 显示「新人 · 暂无记录」，
// 不把 0% 画成「履约很差」。
export type CityCompanionCandidate = {
  agentId: string;
  name: string;
  offerVnd: number;
  fulfillmentRate: number;
  satisfactionRate: number;
  completedOrders: number;
  hasTrackRecord: boolean;
  languages: string[];
  proofs: string[];
};

function parseCityCompanionCandidate(raw: unknown): CityCompanionCandidate | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as Record<string, unknown>;
  if (typeof c.agentId !== "string" || typeof c.name !== "string") return undefined;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    agentId: c.agentId,
    name: c.name,
    offerVnd: num(c.offerVnd),
    fulfillmentRate: num(c.fulfillmentRate),
    satisfactionRate: num(c.satisfactionRate),
    completedOrders: num(c.completedCityOrders),
    hasTrackRecord: c.hasTrackRecord === true,
    languages: strings(c.languages),
    proofs: strings(c.proofs)
  };
}
