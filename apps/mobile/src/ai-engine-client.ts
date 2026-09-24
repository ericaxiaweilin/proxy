import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import { commandErrorMessage } from "./command-error-message";
import type { SecureSessionStore, StoredSession } from "./secure-session";

// AI-MANAGE-002：AI 管理页（我的 → 账户 → AI 管理）的设置与本月 Token 读写。
// 走 command 信封（GetAiEngineSettings / UpdateAiEngineSettings），owner 永远
// 是服务端盖章的 actor —— 客户端伪造 userAccountId 无效。

export type AiChatTone = "cool" | "warm" | "softer" | "lively" | "pro";
export type AiChatReplyLength = "xshort" | "short" | "medium" | "long";
export type AiChatEmoji = "never" | "sometimes" | "often" | "every";
export type AiChatRhythm = "instant" | "human_3_5" | "human_10_30" | "random";
export type AiPermission = "off" | "confirm" | "auto";
export type AiPostPace = "daily" | "every_3_days" | "weekly";
export type AiImageAspect = "3:4" | "1:1" | "16:9";
export type AiImageQuality = "1024" | "1536" | "2048";

export interface AiEngineSettings {
  userAccountId: string;
  paused: boolean;
  chatTone: AiChatTone;
  chatReplyLength: AiChatReplyLength;
  chatEmoji: AiChatEmoji;
  chatRhythm: AiChatRhythm;
  chatPermission: AiPermission;
  imageScene: string;
  imagePose: string;
  imageCamera: string;
  imagePrompt: string;
  imagePromptHistory: string[];
  imageAspect: AiImageAspect;
  imageQuality: AiImageQuality;
  imageVendorPref: string;
  imageModelPref: string;
  postPace: AiPostPace;
  postTopics: string[];
  postPermission: AiPermission;
  version: number;
}

export interface AiTokenUsage {
  userAccountId: string;
  period: string;
  promptTokens: number;
  outputTokens: number;
}

export interface AiEngineSnapshot {
  exists: boolean;
  settings: AiEngineSettings;
  usage: AiTokenUsage;
  period: string;
}

const DEFAULT_SETTINGS: AiEngineSettings = {
  userAccountId: "",
  paused: false,
  chatTone: "warm",
  chatReplyLength: "short",
  chatEmoji: "sometimes",
  chatRhythm: "human_3_5",
  chatPermission: "confirm",
  imageScene: "cafe",
  imagePose: "",
  imageCamera: "static",
  imagePrompt: "",
  imagePromptHistory: [],
  imageAspect: "3:4",
  imageQuality: "1536",
  imageVendorPref: "platform_default",
  imageModelPref: "",
  postPace: "every_3_days",
  postTopics: [],
  postPermission: "off",
  version: 0,
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toSettings(value: unknown, fallbackUser: string): AiEngineSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS, userAccountId: fallbackUser };
  const raw = value as Record<string, unknown>;
  const pick = <T>(key: string, allowed: readonly T[], fallback: T): T => {
    const candidate = raw[key];
    return allowed.includes(candidate as T) ? (candidate as T) : fallback;
  };
  return {
    userAccountId: typeof raw.userAccountId === "string" ? raw.userAccountId : fallbackUser,
    paused: raw.paused === true,
    chatTone: pick("chatTone", ["cool", "warm", "softer", "lively", "pro"] as const, "warm"),
    chatReplyLength: pick("chatReplyLength", ["xshort", "short", "medium", "long"] as const, "short"),
    chatEmoji: pick("chatEmoji", ["never", "sometimes", "often", "every"] as const, "sometimes"),
    chatRhythm: pick("chatRhythm", ["instant", "human_3_5", "human_10_30", "random"] as const, "human_3_5"),
    chatPermission: pick("chatPermission", ["off", "confirm", "auto"] as const, "confirm"),
    imageScene: typeof raw.imageScene === "string" && raw.imageScene ? raw.imageScene : "cafe",
    imagePose: typeof raw.imagePose === "string" ? raw.imagePose : "",
    imageCamera: typeof raw.imageCamera === "string" && raw.imageCamera ? raw.imageCamera : "static",
    imagePrompt: typeof raw.imagePrompt === "string" ? raw.imagePrompt : "",
    imagePromptHistory: asStringArray(raw.imagePromptHistory).slice(0, 20),
    imageAspect: pick("imageAspect", ["3:4", "1:1", "16:9"] as const, "3:4"),
    imageQuality: pick("imageQuality", ["1024", "1536", "2048"] as const, "1536"),
    imageVendorPref: typeof raw.imageVendorPref === "string" && raw.imageVendorPref ? raw.imageVendorPref : "platform_default",
    imageModelPref: typeof raw.imageModelPref === "string" ? raw.imageModelPref : "",
    postPace: pick("postPace", ["daily", "every_3_days", "weekly"] as const, "every_3_days"),
    postTopics: asStringArray(raw.postTopics).slice(0, 20),
    postPermission: pick("postPermission", ["off", "confirm", "auto"] as const, "off"),
    version: typeof raw.version === "number" && Number.isFinite(raw.version) ? raw.version : 0,
  };
}

function toUsage(value: unknown, period: string, fallbackUser: string): AiTokenUsage {
  if (!value || typeof value !== "object") {
    return { userAccountId: fallbackUser, period, promptTokens: 0, outputTokens: 0 };
  }
  const raw = value as Record<string, unknown>;
  const int = (key: string): number => (typeof raw[key] === "number" && Number.isFinite(raw[key]) && raw[key] >= 0 ? Math.floor(raw[key] as number) : 0);
  return {
    userAccountId: typeof raw.userAccountId === "string" ? raw.userAccountId : fallbackUser,
    period: typeof raw.period === "string" && raw.period ? raw.period : period,
    promptTokens: int("promptTokens"),
    outputTokens: int("outputTokens"),
  };
}

export type SecureSessionStoreLike = SecureSessionStore;

export class AiEngineClient {
  private sequence = 0;
  private writeChain: Promise<unknown> = Promise.resolve(DEFAULT_SETTINGS);

  public constructor(
    private readonly input: {
      authClient: { request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse> };
      secureSessionStore: SecureSessionStore;
      now?: () => Date;
    },
  ) {}

  public async read(): Promise<AiEngineSnapshot> {
    const session = await this.requireSession();
    const result = await this.command(session, "GetAiEngineSettings", {});
    const body = this.body(result);
    const period = typeof body.period === "string" && body.period ? body.period : "";
    const settings = toSettings(body.settings, session.userAccountId);
    // 读成功后种子 write 链：否则首个 write 会在 DEFAULT 上 merge，把服务端
    // 已有字段按默认值盖掉（normalize 补默认 ≠ 保留用户已改值）。
    this.writeChain = Promise.resolve(settings);
    return {
      exists: body.exists === true,
      settings,
      usage: toUsage(body.usage, period, session.userAccountId),
      period,
    };
  }

  public write(patch: Partial<AiEngineSettings>): Promise<AiEngineSettings> {
    const operation = this.writeChain.then(async (current) => {
      const session = await this.requireSession();
      const merged: AiEngineSettings = {
        ...(typeof current === "object" && current ? (current as AiEngineSettings) : DEFAULT_SETTINGS),
        ...patch,
        userAccountId: session.userAccountId,
      };
      const payload: Record<string, unknown> = {
        paused: merged.paused,
        chatTone: merged.chatTone,
        chatReplyLength: merged.chatReplyLength,
        chatEmoji: merged.chatEmoji,
        chatRhythm: merged.chatRhythm,
        chatPermission: merged.chatPermission,
        imageScene: merged.imageScene,
        imagePose: merged.imagePose,
        imageCamera: merged.imageCamera,
        imagePrompt: merged.imagePrompt,
        imagePromptHistory: merged.imagePromptHistory,
        imageAspect: merged.imageAspect,
        imageQuality: merged.imageQuality,
        imageVendorPref: merged.imageVendorPref,
        imageModelPref: merged.imageModelPref,
        postPace: merged.postPace,
        postTopics: merged.postTopics,
        postPermission: merged.postPermission,
      };
      const result = await this.command(session, "UpdateAiEngineSettings", payload);
      const saved = toSettings(this.body(result).settings ?? payload, session.userAccountId);
      return saved;
    });
    this.writeChain = operation.catch(() => DEFAULT_SETTINGS);
    return operation;
  }

  public togglePaused(current: boolean): Promise<AiEngineSettings> {
    return this.write({ paused: !current });
  }

  private async command(session: StoredSession & { principal: NonNullable<StoredSession["principal"]> }, commandType: string, payload: Record<string, unknown>): Promise<CommandResult> {
    const next = (kind: string) => `mobile_ai_engine_${kind}_${Date.now().toString(36)}_${(++this.sequence).toString(36)}`;
    const envelope = {
      commandId: next("command"),
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target: { type: "AiEngineSettings", id: session.userAccountId },
      idempotencyKey: next("idempotency"),
      authContext: { sessionId: session.auth.sessionId },
      purpose: "ai_engine_settings",
      correlationId: next("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload,
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new Error("ai engine response malformed");
    if (result.outcome === "REJECTED") throw new Error(commandErrorMessage(result.error, "ai engine rejected"));
    if (response.status < 200 || response.status >= 300) throw new Error(`unexpected ai engine status: ${response.status}`);
    return result;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal || session.serverSession === false || session.signedOut === true) {
      throw new Error("ai engine settings require a real sign-in");
    }
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private body(result: CommandResult): Record<string, unknown> {
    if (!result.operationRef) throw new Error("ai engine payload missing");
    const parsed = JSON.parse(result.operationRef) as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error("ai engine payload malformed");
    return parsed as Record<string, unknown>;
  }
}
