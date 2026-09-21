import type {
  ListTwinInsightsPayload,
  TwinInsight,
  TwinOperateAction,
  TwinOperateResult,
} from "@proxy/contracts";
import {
  parseListTwinInsightsPayload,
  parseTwinInsight,
  parseTwinOperateResult,
} from "@proxy/contracts";
import type { TransportResponse, TransportRequest } from "./auth-client";

// TwinInsightClient — AI 分身 · 好友洞察 mobile half (TWIN-INSIGHT-001)。
//
// 对齐 FacetClient 的传输策略：
//  - 读（list/get）走匿名 transport（PublicRequester.requestPublic），
//    公开浏览无需登录；
//  - 写（operate/summary:refresh）走认证通道（authedRequester 或
//    requester 自带的 request），无 token 服务端拒 401，这里翻译成人话。
//  - wire 解析失败 fail-closed：直接抛（ZodError），UI 必须 catch 后展示
//    重试，不许静默降级成空列表（空列表 [] = 真没有洞察，缺字段 = 协议异常）。
export type TwinInsightPublicRequester = {
  requestPublic(path: string, init: { method: TransportRequest["method"]; body?: unknown }): Promise<TransportResponse>;
  request?(path: string, init: { method: TransportRequest["method"]; body?: unknown }): Promise<TransportResponse>;
};

export type TwinInsightAuthedRequester = {
  request(path: string, init: { method: TransportRequest["method"]; body?: unknown }): Promise<TransportResponse>;
};

export class TwinInsightProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TwinInsightProtocolError";
  }
}

export class TwinInsightClient {
  public constructor(
    private readonly input: {
      requester: TwinInsightPublicRequester;
      baseUrl: string;
      authedRequester?: TwinInsightAuthedRequester;
    },
  ) {}

  private write(path: string, init: { method: TransportRequest["method"]; body?: unknown }): Promise<TransportResponse> {
    const explicit = this.input.authedRequester;
    if (explicit) return explicit.request(path, init);
    const embedded = this.input.requester.request;
    if (typeof embedded === "function") return embedded.call(this.input.requester, path, init);
    return this.input.requester.requestPublic(path, init);
  }

  private static throwIfWriteRejected(response: TransportResponse, op: string): void {
    if (response.status === 401) {
      throw new TwinInsightProtocolError(`twin-insight ${op} requires sign-in (401): 请登录后重试`);
    }
    if (response.status === 429) {
      throw new TwinInsightProtocolError(`twin-insight ${op} rate limited (429): 操作太频繁，请稍后重试`);
    }
  }

  /** 列出某分身的好友洞察（7 天窗口，服务端聚合）。 */
  public async listInsights(twinId: string): Promise<ListTwinInsightsPayload> {
    const path = `/v1/ai/twins/${encodeURIComponent(twinId)}/insights?window=7d`;
    const response = await this.input.requester.requestPublic(path, { method: "GET" });
    if (response.status < 200 || response.status >= 300) {
      throw new TwinInsightProtocolError(`twin-insight listInsights unexpected status: ${response.status}`);
    }
    return parseListTwinInsightsPayload(await response.json());
  }

  /** 取单个目标的洞察详情（展开卡用；列表已带全量时可跳过）。 */
  public async getInsight(twinId: string, targetId: string): Promise<TwinInsight> {
    const path = `/v1/ai/twins/${encodeURIComponent(twinId)}/insights/${encodeURIComponent(targetId)}`;
    const response = await this.input.requester.requestPublic(path, { method: "GET" });
    if (response.status < 200 || response.status >= 300) {
      throw new TwinInsightProtocolError(`twin-insight getInsight unexpected status: ${response.status}`);
    }
    return parseTwinInsight(await response.json());
  }

  /**
   * 运营动作：observe（先观察）/ operate（开启单独运营）。
   * 必须经认证通道；服务端写审计（谁、何时、对谁、什么动作）。
   */
  public async operate(twinId: string, targetId: string, action: TwinOperateAction): Promise<TwinOperateResult> {
    const path = `/v1/ai/twins/${encodeURIComponent(twinId)}/targets/${encodeURIComponent(targetId)}/operate`;
    const response = await this.write(path, { method: "POST", body: { action } });
    TwinInsightClient.throwIfWriteRejected(response, "operate");
    if (response.status < 200 || response.status >= 300) {
      throw new TwinInsightProtocolError(`twin-insight operate unexpected status: ${response.status}`);
    }
    return parseTwinOperateResult(await response.json());
  }

  /**
   * 重新总结（原型“重新总结”按钮）。服务端限流（建议 1 次/分钟/目标），
   * 429 翻译成人话，UI 展示 toast，不抛原生英文。
   */
  public async refreshSummary(twinId: string, targetId: string): Promise<TwinInsight> {
    const path = `/v1/ai/twins/${encodeURIComponent(twinId)}/insights/${encodeURIComponent(targetId)}/summary:refresh`;
    const response = await this.write(path, { method: "POST", body: {} });
    TwinInsightClient.throwIfWriteRejected(response, "refreshSummary");
    if (response.status < 200 || response.status >= 300) {
      throw new TwinInsightProtocolError(`twin-insight refreshSummary unexpected status: ${response.status}`);
    }
    return parseTwinInsight(await response.json());
  }
}
