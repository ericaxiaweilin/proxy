import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore } from "./secure-session";

// STORE-REC-001: 「推荐商铺进体系」客户端。
//
// 原始设计（Master PRD v1.1 §15 + CBOS）：企业/店铺是独立模块，体系增长
// 靠发展 builder + 小美（AI）/ 用户推荐商铺进入体系，运营评估后接入。
// 这里只提交推荐受理记录（append-only），接入与否由运营在 bdash 评估。

export type StoreRecommendationOrigin = "USER" | "AI";

// STORE-REC-004: 运营对一条推荐做出的结论。append-only —— 改主意是追加一条新的，
// 以最新一条为准，绝不回头改旧记录。
export type StoreRecommendationDecision = "ACCEPT" | "REJECT";

// STORE-REC-005: 队列的四种看法。PENDING = 还没出结论；ACCEPTED = 已批准接入
// （注意：批准不等于店铺已存在，商家实际入驻是另一回事）；REJECTED = 不采纳。
export type StoreRecommendationQueueStatus = "PENDING" | "ACCEPTED" | "REJECTED";

// STORE-REC-002: 运营评估队列的读模型（与服务端 StoreRecommendation 的 json tag 对齐）。
export interface StoreRecommendation {
  recommendationId: string;
  storeName: string;
  city: string;
  category: string;
  reason: string;
  recommendedByAccountId: string;
  origin: StoreRecommendationOrigin;
  createdAt: string;
  // STORE-REC-004: 运营的最新评估结论。服务端用 omitempty，没评估时这些字段
  // 根本不会出现 —— 所以「没有 decision」才代表「还没评估」。
  decision?: StoreRecommendationDecision;
  decisionReason?: string;
  decidedBy?: string;
  decidedAt?: string;
}

export interface ListStoreRecommendationsQuery {
  city?: string;
  origin?: StoreRecommendationOrigin;
  limit?: number;
  /**
   * 按最新结论筛选。不传 = 全部。
   *
   * 为什么不是布尔值：队列要有四种看法（待评估 / 已采纳待接入 / 不采纳 / 全部）。
   * 用 `只看待评估` 这种开关表达不了「只看我采纳过的」—— 而采纳完一条它就从
   * 默认视图消失了，运营看不到自己批过什么、也没法跟进商家入驻（STORE-REC-005）。
   */
  status?: StoreRecommendationQueueStatus;
}

export interface RecommendStoreInput {
  storeName: string;
  city: string;
  category: string;
  reason: string;
  origin: StoreRecommendationOrigin;
}

export class StoreRecommendationProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "StoreRecommendationProtocolError";
  }
}

// STORE-REC-003: 小美（AI）整理出来的推荐草稿。
//
// 字段允许为空字符串 —— 空代表「用户没说」，**不是服务端没填**。
// 调用方必须让用户自己补，绝不能替他编一个城市或品类出来。
export interface SuggestedStoreRecommendation {
  storeName: string;
  city: string;
  category: string;
  reason: string;
}

/**
 * 模型底座未配置或不可用。
 *
 * 这不是「用户这次操作失败」，而是**这个能力当前根本不存在**。调用方必须
 * 据此把「让小美整理」入口**藏起来**：弹一个红字报错是误导（重试也没用），
 * 留一个点了没反应的按钮更糟。
 */
export class StoreRecommendationAiUnavailableError extends Error {
  public constructor() {
    super("小美整理功能当前不可用");
    this.name = "StoreRecommendationAiUnavailableError";
  }
}

export class StoreRecommendationRejectedError extends Error {
  public constructor(public readonly result: CommandResult) {
    super(`推荐未受理：${result.error?.messageKey ?? "请稍后重试"}`);
    this.name = "StoreRecommendationRejectedError";
  }
}

export class StoreOnboardingClient {
  private commandSequence = 0;

  public constructor(private readonly input: {
    authClient: { request: (path: string, init: { method: "POST"; body: unknown }) => Promise<TransportResponse> };
    secureSessionStore: SecureSessionStore;
    now?: () => Date;
  }) {}

  /** 提交一条店铺推荐。失败会抛 —— 调用方必须让用户看见「没提交成功」。 */
  public async recommendStore(input: RecommendStoreInput): Promise<void> {
    const storeName = input.storeName.trim();
    const city = input.city.trim();
    const reason = input.reason.trim();
    if (!storeName) throw new StoreRecommendationProtocolError("店名不能为空");
    if (!city) throw new StoreRecommendationProtocolError("城市不能为空");
    if (!reason) throw new StoreRecommendationProtocolError("推荐理由不能为空");
    await this.command("RecommendStore", {
      storeName,
      city,
      category: input.category.trim(),
      reason,
      origin: input.origin
    });
  }

  /**
   * STORE-REC-002: 拉取运营评估队列。
   *
   * ⚠️ 这是 operator-only 命令。没有运营权限的账号会被服务端拒
   * （OPERATOR_PRIVILEGE_REQUIRED），这里会抛 StoreRecommendationRejectedError ——
   * 调用方必须把它显示成「没有权限」，**绝不能显示成「还没有人推荐」**。
   * 两种情况的列表都是空的，混在一起会让运营以为「没人推荐这家店」，
   * 而真实情况是他根本看不到。
   */
  public async listRecommendations(query: ListStoreRecommendationsQuery = {}): Promise<StoreRecommendation[]> {
    const payload: Record<string, unknown> = {};
    if (query.city && query.city.trim()) payload.city = query.city.trim();
    if (query.origin) payload.origin = query.origin;
    if (query.limit && query.limit > 0) payload.limit = query.limit;
    // STORE-REC-005: status 取代了旧的 pendingOnly 布尔开关。
    if (query.status) payload.status = query.status;

    const result = await this.command("ListStoreRecommendations", payload, {
      type: "STORE",
      id: "queue"
    });
    // 服务端把队列 JSON 放在 operationRef 里；没有它算协议异常，
    // 不能当成空队列 —— 同上，会把「读不出来」误报成「没人推荐」。
    const ref = result.operationRef;
    if (typeof ref !== "string") {
      throw new StoreRecommendationProtocolError("推荐队列响应缺少 operationRef");
    }
    try {
      const parsed = JSON.parse(ref) as { recommendations?: StoreRecommendation[] };
      return parsed.recommendations ?? [];
    } catch (err) {
      throw new StoreRecommendationProtocolError(
        "推荐队列解析失败: " + (err instanceof Error ? err.message : String(err))
      );
    }
  }

  /**
   * STORE-REC-003: 让小美把用户随口说的话整理成推荐草稿（**只读，不落库**）。
   *
   * 为什么需要它：origin 区分「用户推荐」与「小美推荐」，运营队列也有
   * 「小美推荐」筛选 —— 但之前没有一个地方能产生 AI 推荐，那个筛选是死 UI。
   *
   * 拿到的草稿仍然要经用户确认，再由 recommendStore 落库；小美不直接写库，
   * 也就绕不过服务端那套 fail-closed 校验。
   */
  public async suggestRecommendation(note: string): Promise<SuggestedStoreRecommendation> {
    const trimmed = note.trim();
    if (!trimmed) throw new StoreRecommendationProtocolError("先说说这家店，小美才能整理");

    let result: CommandResult;
    try {
      result = await this.command(
        "SuggestStoreRecommendation",
        { note: trimmed },
        { type: "STORE", id: "suggest" }
      );
    } catch (err) {
      if (
        err instanceof StoreRecommendationRejectedError &&
        err.result.error?.errorCode === "AI_NOT_CONFIGURED"
      ) {
        throw new StoreRecommendationAiUnavailableError();
      }
      throw err;
    }

    const ref = result.operationRef;
    if (typeof ref !== "string") {
      throw new StoreRecommendationProtocolError("小美整理结果缺少 operationRef");
    }
    try {
      const parsed = JSON.parse(ref) as Partial<SuggestedStoreRecommendation>;
      return {
        storeName: (parsed.storeName ?? "").trim(),
        city: (parsed.city ?? "").trim(),
        category: (parsed.category ?? "").trim(),
        reason: (parsed.reason ?? "").trim()
      };
    } catch (err) {
      throw new StoreRecommendationProtocolError(
        "小美整理结果解析失败: " + (err instanceof Error ? err.message : String(err))
      );
    }
  }

  /**
   * STORE-REC-004: 记录运营的评估结论（operator-only）。
   *
   * 为什么需要它：队列（STORE-REC-002）只能看不能判 —— 运营读完一条推荐，
   * 没有任何地方记录「采纳 / 不采纳」，评估结论只存在于他脑子里。
   *
   * 不采纳必须给理由（服务端会拒）：否则举证链上会留一条无法解释的拒绝。
   */
  public async decideRecommendation(input: {
    recommendationId: string;
    decision: StoreRecommendationDecision;
    reason?: string;
  }): Promise<void> {
    const recommendationId = input.recommendationId.trim();
    if (!recommendationId) throw new StoreRecommendationProtocolError("缺少推荐 id，无法记录结论");
    const payload: Record<string, unknown> = { recommendationId, decision: input.decision };
    const reason = input.reason?.trim();
    if (reason) payload.reason = reason;
    await this.command("DecideStoreRecommendation", payload, { type: "STORE", id: "disposition" });
  }

  private nextId(prefix: string): string {
    this.commandSequence += 1;
    return `${prefix}_${Date.now().toString(36)}_${this.commandSequence}`;
  }

  private async requireSession() {
    const session = await this.input.secureSessionStore.read();
    if (!session) throw new StoreRecommendationProtocolError("推荐商铺需要登录后提交");
    return session;
  }

  private async command(
    commandType: string,
    payload: Record<string, unknown>,
    target: { type: string; id: string } = { type: "STORE", id: "recommend" }
  ): Promise<CommandResult> {
    const session = await this.requireSession();
    const envelope = {
      commandId: this.nextId("command"),
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target,
      idempotencyKey: this.nextId("idempotency"),
      authContext: { sessionId: session.auth.sessionId },
      purpose: "store_recommendation",
      correlationId: this.nextId("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch (err) {
      throw new StoreRecommendationProtocolError("推荐响应读取失败: " + (err instanceof Error ? err.message : String(err)));
    }
    const result = parseCommandResult(responseBody);
    if (!result) {
      const bodyStr = (() => { try { return JSON.stringify(responseBody); } catch { return String(responseBody); } })();
      throw new StoreRecommendationProtocolError(`推荐命令响应格式异常 (status=${response.status}): ${bodyStr.slice(0, 200)}`);
    }
    if (result.outcome === "REJECTED") throw new StoreRecommendationRejectedError(result);
    if (response.status < 200 || response.status >= 300) {
      throw new StoreRecommendationProtocolError(`推荐命令意外状态: ${response.status}`);
    }
    return result;
  }
}
