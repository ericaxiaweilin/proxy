import type { TransportResponse } from "./auth-client";

// AiPersonaClient — 真分身中心 mobile half (TWIN-CENTER-003)。
//
// 分身中心之前是静态 showcase：Twin 列表、审计日志全是写死数据，「创建」
// 按钮 onPress 是空函数。后端其实早就有真接口（POST /v1/ai/personas 建、
// GET /v1/ai/personas?ownerId= 查、POST …/consents 授权、POST …/consents/revoke
// 收回），这个 client 把它们接起来。plain REST，不走 command 信封。
//
// 约定（和服务端对齐，见 apps/api-go/internal/api/aipersona_handlers.go）：
// - 列表空 = []，只有缺数组才是协议异常 —— 「没有分身」和「没读出来」
//   是两种 UI，必须分开。
// - 查 live consent 返回 204 = 没有生效中的授权，不是失败。
// - 收回时没有生效授权返回 404 no_live_consent —— 没授过权就不要
//   显示成「收回成功」。
// - 建分身被未成年人门禁拒绝（COMP-AI-MINOR-001，fail-closed）时，
//   服务端 reason 是英文，client 翻译成人话再抛。

export type TwinPersonaType = "USER_TWIN";

export interface TwinPersona {
  id: string;
  ownerId: string;
  displayName: string;
  personaType: TwinPersonaType;
  description?: string;
  createdAt: string;
  archivedAt?: string;
}

// AI-TWIN-GALLERY-001: 图库两个 tab 的真实来源——ai 是这个分身生成过的
// 资产（persona_id 范围），raw 是这个人自己上传、还没被标成 AI 来源的
// 原始素材（owner 范围，见 GET /v1/ai/personas/{id}/media?source=）。
export type PersonaGallerySource = "ai" | "raw";

export interface PersonaGalleryItem {
  id: string;
  thumbnailUrl: string;
  playbackUrl?: string;
  aiGenerationSource: string;
  createdAt: string;
}

export type TwinConsentKind = "VISUAL" | "VOICE" | "VISUAL_AND_VOICE";

export interface TwinConsent {
  id: string;
  personaId: string;
  subjectId: string;
  consentKind: TwinConsentKind;
  termsVersion: string;
  grantedAt: string;
  revokedAt?: string;
  expiresAt?: string;
}

export class TwinNoLiveConsentError extends Error {
  public constructor() {
    super("该分身当前没有生效中的形象授权，无需收回。");
    this.name = "TwinNoLiveConsentError";
  }
}

export class TwinMinorForbiddenError extends Error {
  public constructor() {
    super("未成年人暂不能创建数字分身。");
    this.name = "TwinMinorForbiddenError";
  }
}

// COMP-AI-MINOR-001 fail-closed 的第二种拒因：老账号（COMP-AGE-001 之前
// 注册、当时没填出生日期）没有任何年龄断言。跟「确认未成年」是两回事 ——
// 前者补一条年龄信息就能用，后者不能。服务端 reason 原文是
// "no age evidence on file for this account"，这里翻译成人话。
export class TwinNoAgeEvidenceError extends Error {
  public constructor() {
    super("这个账号没有年龄记录（老账号注册时没填出生日期）。新注册的账号自带，找运营补一条也行，补完即可创建分身。");
    this.name = "TwinNoAgeEvidenceError";
  }
}

type RestTransport = {
  request(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<TransportResponse>;
};

function isTwinPersona(value: unknown): value is TwinPersona {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && item.id !== ""
    && typeof item.ownerId === "string" && item.ownerId !== ""
    && typeof item.displayName === "string" && item.displayName !== ""
    && item.personaType === "USER_TWIN"
    && typeof item.createdAt === "string" && item.createdAt !== "";
}

function isPersonaGalleryItem(value: unknown): value is PersonaGalleryItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && item.id !== ""
    && typeof item.thumbnailUrl === "string" && item.thumbnailUrl !== ""
    && typeof item.aiGenerationSource === "string" && item.aiGenerationSource !== ""
    && typeof item.createdAt === "string" && item.createdAt !== "";
}

function isTwinConsent(value: unknown): value is TwinConsent {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && item.id !== ""
    && typeof item.personaId === "string" && item.personaId !== ""
    && typeof item.subjectId === "string" && item.subjectId !== ""
    && (item.consentKind === "VISUAL" || item.consentKind === "VOICE" || item.consentKind === "VISUAL_AND_VOICE")
    && typeof item.termsVersion === "string" && item.termsVersion !== ""
    && typeof item.grantedAt === "string" && item.grantedAt !== "";
}

export class AiPersonaClient {
  public constructor(private readonly input: { authClient: RestTransport }) {}

  public async listMine(ownerId: string): Promise<TwinPersona[]> {
    const response = await this.input.authClient.request(`/v1/ai/personas?ownerId=${encodeURIComponent(ownerId)}`, { method: "GET" });
    const payload = await this.readJson(response, "分身列表");
    const personas = (payload as { personas?: unknown }).personas;
    if (!Array.isArray(personas)) throw new Error("分身列表响应缺少 personas 数组");
    return personas.filter(isTwinPersona);
  }

  // AI-TWIN-GALLERY-001: 服务端要求登录（跟这个 client 其余大部分方法不
  // 同——分身列表/consents 目前对未登录也开放，见 aipersona_handlers.go
  // 的注释）。401/403 翻译成人话，不是让调用方自己猜状态码。
  public async listGallery(personaId: string, source: PersonaGallerySource): Promise<PersonaGalleryItem[]> {
    const response = await this.input.authClient.request(
      `/v1/ai/personas/${encodeURIComponent(personaId)}/media?source=${source}`,
      { method: "GET" },
    );
    const payload = await this.readJson(response, "图库");
    if (response.status === 401) throw new Error("登录已失效，请重新登录后查看图库。");
    if (response.status === 403) throw new Error("这个分身不属于当前账号，看不到它的图库。");
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`图库没读出来（${response.status}），请稍后重试。`);
    }
    const items = (payload as { items?: unknown }).items;
    if (!Array.isArray(items)) throw new Error("图库响应缺少 items 数组");
    return items.filter(isPersonaGalleryItem);
  }

  public async createTwin(input: { ownerId: string; displayName: string; description?: string }): Promise<TwinPersona> {
    const name = input.displayName.trim();
    if (!name) throw new Error("给分身起个名字才能创建。");
    let response: TransportResponse;
    try {
      response = await this.input.authClient.request("/v1/ai/personas", {
        method: "POST",
        body: { ownerId: input.ownerId, displayName: name, personaType: "USER_TWIN", description: input.description?.trim() ?? "" },
      });
    } catch (err) {
      throw this.translateTransportError(err);
    }
    const payload = await this.readJson(response, "创建分身");
    if (response.status === 400 && (payload as { error?: unknown }).error === "create_failed") {
      throw this.translateCreateError((payload as { reason?: unknown }).reason);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`创建分身失败（${response.status}），请稍后重试。`);
    }
    if (!isTwinPersona(payload)) throw new Error("创建分身响应缺少分身记录");
    return payload;
  }

  // 没有生效授权时返回 undefined（服务端 204），不是抛错 ——
// 调用方据此渲染「未授权」而不是「加载失败」。
  public async getLiveConsent(personaId: string, subjectId: string): Promise<TwinConsent | undefined> {
    const response = await this.input.authClient.request(
      `/v1/ai/personas/${encodeURIComponent(personaId)}/consents?subjectId=${encodeURIComponent(subjectId)}`,
      { method: "GET" },
    );
    if (response.status === 204) return undefined;
    const payload = await this.readJson(response, "授权状态");
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`授权状态没读出来（${response.status}），请稍后重试。`);
    }
    if (!isTwinConsent(payload)) throw new Error("授权状态响应缺少授权记录");
    return payload;
  }

  public async grantConsent(personaId: string, subjectId: string, kind: TwinConsentKind): Promise<TwinConsent> {
    const response = await this.input.authClient.request(`/v1/ai/personas/${encodeURIComponent(personaId)}/consents`, {
      method: "POST",
      body: { subjectId, consentKind: kind },
    });
    const payload = await this.readJson(response, "形象授权");
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`形象授权失败（${response.status}），请稍后重试。`);
    }
    if (!isTwinConsent(payload)) throw new Error("形象授权响应缺少授权记录");
    return payload;
  }

  public async revokeConsent(personaId: string, subjectId: string): Promise<TwinConsent> {
    const response = await this.input.authClient.request(`/v1/ai/personas/${encodeURIComponent(personaId)}/consents/revoke`, {
      method: "POST",
      body: { subjectId },
    });
    const payload = await this.readJson(response, "收回授权");
    if (response.status === 404 && (payload as { error?: unknown }).error === "no_live_consent") {
      throw new TwinNoLiveConsentError();
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`收回授权失败（${response.status}），请稍后重试。`);
    }
    if (!isTwinConsent(payload)) throw new Error("收回授权响应缺少授权记录");
    return payload;
  }

  // AGE-BACKFILL-001: 老账号补年龄断言（SELF_DECLARED_BACKFILL，append-only）。
  // 注册时没填出生日期的账号建分身会被门禁拦（TwinNoAgeEvidenceError），
  // 补上这条就能用。未成年也如实记录 —— 门禁去判，这里只管写。
  public async recordAgeAssertion(dateOfBirth: string): Promise<void> {
    const dob = dateOfBirth.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) throw new Error("出生日期格式不对，用 YYYY-MM-DD。");
    const response = await this.input.authClient.request("/v1/identity/age-assertion", {
      method: "POST",
      body: { dateOfBirth: dob },
    });
    const payload = await this.readJson(response, "补年龄信息");
    if (response.status < 200 || response.status >= 300) {
      const reason = (payload as { reason?: unknown }).reason;
      throw new Error(typeof reason === "string" && reason ? `补年龄信息失败：${reason}` : `补年龄信息失败（${response.status}），请稍后重试。`);
    }
  }

  private translateCreateError(reason: unknown): Error {
    if (typeof reason === "string") {
      if (/minor/i.test(reason)) return new TwinMinorForbiddenError();
      if (/no age evidence/i.test(reason)) return new TwinNoAgeEvidenceError();
      if (reason) return new Error(`创建分身失败：${reason}`);
    }
    return new Error("创建分身失败，请稍后重试。");
  }

  private translateTransportError(err: unknown): Error {
    if (err instanceof Error) return err;
    return new Error("网络不可用，创建分身没发出去。");
  }

  private async readJson(response: TransportResponse, what: string): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new Error(`${what}响应解析失败，请稍后重试。`);
    }
  }
}
