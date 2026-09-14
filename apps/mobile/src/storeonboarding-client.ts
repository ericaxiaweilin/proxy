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
}

export interface ListStoreRecommendationsQuery {
  city?: string;
  origin?: StoreRecommendationOrigin;
  limit?: number;
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
