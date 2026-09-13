import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore } from "./secure-session";

// COMP-REPORT-002: 用户举报入口的客户端。
//
// 服务端（internal/moderation，COMP-REPORT-001）已经能受理法律文件 §38
// 承诺的全部八类目标，但移动端此前只有 feed 帖子菜单里一个「举报」——
// 用户能碰到的仍然只有 1/8。接口接上了而入口没接上，等于没改：
// 平台依旧收不到「消息 / 账号 / 交易」上的线索，而出事时恰恰是这几类
// 最能说明我们有没有尽到注意义务。
//
// 理由清单与服务端 ReportableReasons 对齐，包含 MINOR_SAFETY 与
// SOLICITATION —— 这两种是我们风险最高、也最需要被单独报上来的。

export type ReportTargetType =
  | "POST"
  | "MESSAGE"
  | "ACCOUNT"
  | "ACTIVITY"
  | "OPPORTUNITY"
  | "MERCHANT"
  | "INVITE"
  | "TRANSACTION";

export type ReportReason =
  | "SPAM"
  | "HARASSMENT"
  | "UNSAFE"
  | "MINOR_SAFETY"
  | "SOLICITATION"
  | "FRAUD"
  | "IMPERSONATION"
  | "IP_VIOLATION"
  | "OTHER";

// 展示文案。SOLICITATION 直白写出来，是刻意而不是措辞粗糙：
// 用户在聊天里碰到线下付费招揽时，要能一眼找到对应的那一格。
export const REPORT_REASONS: ReadonlyArray<{ reason: ReportReason; label: string }> = [
  { reason: "SOLICITATION", label: "招嫖 / 线下付费招揽" },
  { reason: "MINOR_SAFETY", label: "涉及未成年人" },
  { reason: "FRAUD", label: "诈骗 / 钱财纠纷" },
  { reason: "HARASSMENT", label: "骚扰 / 辱骂" },
  { reason: "UNSAFE", label: "人身安全威胁" },
  { reason: "IMPERSONATION", label: "冒充他人 / 虚假身份" },
  { reason: "SPAM", label: "垃圾广告" },
  { reason: "IP_VIOLATION", label: "侵犯知识产权" },
  { reason: "OTHER", label: "其他" },
];

// 命令 target 的聚合类型：服务端只校验业务字段，这里按目标给个合适的
// 聚合名，便于操作审计里看出「报的是哪一类对象」。
const TARGET_AGGREGATE: Record<ReportTargetType, string> = {
  POST: "Post",
  MESSAGE: "Message",
  ACCOUNT: "Account",
  ACTIVITY: "Activity",
  OPPORTUNITY: "Opportunity",
  MERCHANT: "Merchant",
  INVITE: "Invite",
  TRANSACTION: "Transaction"
};

export type ModerationCommandTransport = {
  request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse>;
};

export class ModerationProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ModerationProtocolError";
  }
}

export class ModerationCommandRejectedError extends Error {
  public constructor(public readonly result: CommandResult) {
    super(result.error?.messageKey ?? "moderation command rejected");
    this.name = "ModerationCommandRejectedError";
  }
}

export class ModerationClient {
  private commandSequence = 0;

  public constructor(private readonly input: {
    authClient: ModerationCommandTransport;
    secureSessionStore: SecureSessionStore;
    now?: () => Date;
  }) {}

  /**
   * 提交一条举报。失败会抛 —— 调用方必须让用户看见「没提交成功」，
   * 不能当成已受理（用户以为平台收到了，实际上什么都没存下来）。
   */
  public async reportTarget(
    targetType: ReportTargetType,
    targetId: string,
    reason: ReportReason,
    note?: string
  ): Promise<void> {
    const id = targetId.trim();
    if (!id) throw new ModerationProtocolError("report target id is required");
    await this.command("ReportTarget", { type: TARGET_AGGREGATE[targetType], id }, {
      targetType,
      targetId: id,
      reason,
      ...(note && note.trim() ? { note: note.trim() } : {})
    });
  }

  private nextId(prefix: string): string {
    this.commandSequence += 1;
    return `${prefix}_${Date.now().toString(36)}_${this.commandSequence}`;
  }

  private async requireSession() {
    const session = await this.input.secureSessionStore.read();
    if (!session) throw new ModerationProtocolError("moderation command requires a signed-in session");
    return session;
  }

  private async command(
    commandType: string,
    target: { type: string; id: string },
    payload: Record<string, unknown>
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
      purpose: "moderation_report",
      correlationId: this.nextId("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch (err) {
      throw new ModerationProtocolError("moderation response body read failed: " + (err instanceof Error ? err.message : String(err)));
    }
    const result = parseCommandResult(responseBody);
    if (!result) {
      const bodyStr = (() => { try { return JSON.stringify(responseBody); } catch { return String(responseBody); } })();
      throw new ModerationProtocolError(`moderation command response was malformed (status=${response.status}): ${bodyStr.slice(0, 200)}`);
    }
    if (result.outcome === "REJECTED") throw new ModerationCommandRejectedError(result);
    if (response.status < 200 || response.status >= 300) {
      throw new ModerationProtocolError(`unexpected moderation command status: ${response.status}`);
    }
    return result;
  }
}
