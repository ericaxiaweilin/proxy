import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";
import { commandErrorMessage } from "./command-error-message";

// CREATOR-SOCIAL-001：社媒条目。handle 只存用户名（服务端校验过形状），
// 显示时的 canonical 链接由 socialProfileUrl 按平台拼 —— 不拼用户给的 URL。
export type AgentSocial = { platform: string; handle: string; visibility: string };

/** 平台 → canonical 主页链接（和服务端封闭集合对齐，加平台要一起加）。 */
export function socialProfileUrl(platform: string, handle: string): string | undefined {
  switch (platform) {
    case "tiktok": return `https://www.tiktok.com/@${handle}`;
    case "instagram": return `https://www.instagram.com/${handle}`;
    case "facebook": return `https://www.facebook.com/${handle}`;
    case "zalo": return undefined; // Zalo 没有公开主页 URL 形态，只显示名字。
    default: return undefined; // 未知平台不拼 —— 拼出来就是编链接。
  }
}

export const SOCIAL_PLATFORMS = ["tiktok", "zalo", "instagram", "facebook"] as const;

/** 平台中文名（未知平台回落原文，不吞）。 */
export function socialPlatformLabel(platform: string): string {
  switch (platform) {
    case "tiktok": return "TikTok";
    case "zalo": return "Zalo";
    case "instagram": return "Instagram";
    case "facebook": return "Facebook";
    default: return platform;
  }
}
export const SOCIAL_VISIBILITIES = ["public", "merchants", "private"] as const;

export type AgentPassport = {
  // CREATOR-PROFILE-001（2026-10-02，用户「最佳匹配的creator 不能看个人主页
  // 也看不到关联的社媒账户」）：passport 里原来没有 photos —— 服务端明明发了
  // （AgentProfile.Photos），移动端类型把它丢了，于是详情页永远画不出头像。
  profile: { agentId: string; name: string; bio: string; photos: string[]; languages: string[]; serviceAreas: string[]; status: string; socials: AgentSocial[]; userAccountId?: string | undefined };
  capabilities: Array<{ capability: string; declared: boolean; verified: boolean }>;
  verifications: Array<{ id: string; capability: string; status: string }>;
  availability: Array<{ id: string; startAt: string; endAt: string; marketId: string; status: string }>;
};

/** passport 解析：照片字段缺了就给 []，不断言服务端一定发（老版本可能不发）。 */
export function parseAgentPassport(value: unknown): AgentPassport | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const p = (v.profile ?? {}) as Record<string, unknown>;
  if (typeof p.agentId !== "string" || typeof p.name !== "string") return undefined;
  const photos = Array.isArray(p.photos) ? p.photos.filter((x): x is string => typeof x === "string") : [];
  const langs = Array.isArray(p.languages) ? p.languages.filter((x): x is string => typeof x === "string") : [];
  const areas = Array.isArray(p.serviceAreas) ? p.serviceAreas.filter((x): x is string => typeof x === "string") : [];
  const caps = Array.isArray(v.capabilities) ? v.capabilities.flatMap((c) => {
    if (!c || typeof c !== "object") return [];
    const r = c as Record<string, unknown>;
    if (typeof r.capability !== "string") return [];
    return [{ capability: r.capability, declared: r.declared === true, verified: r.verified === true }];
  }) : [];
  // CREATOR-SOCIAL-001：socials 进解析。形状不对的条目整条丢掉（平台/用户名
  // 任一非法），不断言服务端一定发对 —— 老版本本来就没有这个字段。
  const socials: AgentSocial[] = Array.isArray((p as Record<string, unknown>).socials)
    ? ((p as Record<string, unknown>).socials as unknown[]).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const r = item as Record<string, unknown>;
        if (typeof r.platform !== "string" || typeof r.handle !== "string") return [];
        if (!(SOCIAL_PLATFORMS as readonly string[]).includes(r.platform)) return [];
        if (r.handle.length === 0 || r.handle.length > 64) return [];
        return [{
          platform: r.platform, handle: r.handle,
          visibility: typeof r.visibility === "string" ? r.visibility : "",
        }];
      })
    : [];
  const avail = Array.isArray(v.availability) ? v.availability.flatMap((a) => {
    if (!a || typeof a !== "object") return [];
    const r = a as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.startAt !== "string" || typeof r.endAt !== "string") return [];
    return [{
      id: r.id, startAt: r.startAt, endAt: r.endAt,
      marketId: typeof r.marketId === "string" ? r.marketId : "",
      status: typeof r.status === "string" ? r.status : "",
    }];
  }) : [];
  return {
    profile: {
      agentId: p.agentId, name: p.name,
      bio: typeof p.bio === "string" ? p.bio : "",
      photos, languages: langs, serviceAreas: areas, socials,
      ...(typeof p.userAccountId === "string" && p.userAccountId !== "" ? { userAccountId: p.userAccountId } : {}),
      status: typeof p.status === "string" ? p.status : "",
    },
    capabilities: caps,
    verifications: [],
    availability: avail,
  };
}

export class SupplyProtocolError extends Error {}

// SUPPLY-BODY-001: operationRef 是服务端 payload 的 JSON 串。解析不出来就是
// 协议损坏，不能静默返回 {} —— 那跟"成功但为空"长得一模一样：供给列表会显示
// 0 个可邀约的人（看起来是"没有供给"），实际上是一次失败。同理，解析出来不是
// 对象（裸数字 / null / 字符串）也是损坏，一样要抛，不能退化成空对象。
export function parseSupplyBody(operationRef: string | undefined): Record<string, unknown> {
  if (!operationRef) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(operationRef) as unknown;
  } catch {
    throw new SupplyProtocolError("supply response payload was malformed");
  }
  if (!parsed || typeof parsed !== "object") throw new SupplyProtocolError("supply response payload was not an object");
  return parsed as Record<string, unknown>;
}

// CREATOR-HOME-001：userAccountId 是 agent→user 链路（公开主页用）。
// 服务端从 agent_profiles.user_account_id 直接带出来；没有就是没关联，不断言一定有。
export type SupplierCandidate = {
  agentId: string;
  userAccountId?: string | undefined;
  name: string;
  photos: string[];
  languages: string[];
  serviceType: string;
  referencePrice: number;
  currency: string;
  availability?: { startAt: string; endAt: string; marketId: string };
  eligibility: { eligible: boolean; capabilitiesOk: boolean; availabilityOk: boolean; marketOk: boolean };
};

export function parseSupplierCandidates(value: unknown): SupplierCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.agentId !== "string" || typeof item.name !== "string") return [];
    const eligibility = item.eligibility && typeof item.eligibility === "object" ? item.eligibility as Record<string, unknown> : {};
    const availability = item.availability && typeof item.availability === "object" ? item.availability as Record<string, unknown> : undefined;
    const parsedAvailability = availability && typeof availability.startAt === "string" && typeof availability.endAt === "string" && typeof availability.marketId === "string" ? { startAt: availability.startAt, endAt: availability.endAt, marketId: availability.marketId } : undefined;
    return [{ agentId: item.agentId,
      ...(typeof item.userAccountId === "string" && item.userAccountId !== "" ? { userAccountId: item.userAccountId } : {}),
      name: item.name,
      photos: Array.isArray(item.photos) ? item.photos.filter((photo): photo is string => typeof photo === "string" && photo.length > 0) : [],
      languages: Array.isArray(item.languages) ? item.languages.filter((language): language is string => typeof language === "string") : [],
      serviceType: typeof item.serviceType === "string" ? item.serviceType : "",
      referencePrice: typeof item.referencePrice === "number" ? item.referencePrice : 0,
      currency: typeof item.currency === "string" ? item.currency : "VND",
      ...(parsedAvailability ? { availability: parsedAvailability } : {}),
      eligibility: { eligible: eligibility.eligible === true, capabilitiesOk: eligibility.capabilitiesOk === true, availabilityOk: eligibility.availabilityOk === true, marketOk: eligibility.marketOk === true },
    }];
  });
}

export class SupplyClient {
  private seq = 0;
  public constructor(
    private readonly input: {
      authClient: { request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse> };
      secureSessionStore: SecureSessionStore;
      now?: () => Date;
    },
  ) {}

  public async getAgentPassport(agentId?: string): Promise<AgentPassport> {
    const payload: Record<string, unknown> = {};
    if (agentId) payload.agentId = agentId;
    const body = this.body(await this.command("GetAgentPassport", { type: "AgentProfile", id: agentId ?? "mine" }, payload));
    // CREATOR-PROFILE-001：走解析不裸 cast —— SUPPLY-BODY-001 同一条规矩，
    // 解析不出对象就抛，不能静默返回 {} 假装"这个人没资料"。
    const parsed = parseAgentPassport(body);
    if (!parsed) throw new SupplyProtocolError("agent passport malformed");
    return parsed;
  }

  // CREATOR-SOCIAL-001：社媒绑定/解绑（只能绑自己的，服务端按 principal 校验）。
  public async linkAgentSocial(input: { agentId: string; platform: string; handle: string; visibility?: string }): Promise<AgentSocial[]> {
    const payload: Record<string, unknown> = { agentId: input.agentId };
    payload.platform = input.platform;
    payload.handle = input.handle;
    if (input.visibility) payload.visibility = input.visibility;
    const body = this.body(await this.command("LinkAgentSocial", { type: "AgentProfile", id: input.agentId }, payload));
    const raw = (body as Record<string, unknown>).socials;
    return Array.isArray(raw) ? (parseAgentPassport({ profile: { agentId: input.agentId, name: "", socials: raw } })?.profile.socials ?? []) : [];
  }

  public async unlinkAgentSocial(input: { agentId: string; platform: string }): Promise<void> {
    await this.command("UnlinkAgentSocial", { type: "AgentProfile", id: input.agentId }, { agentId: input.agentId, platform: input.platform });
  }

  public async declareCapability(input: { capability: string }): Promise<void> {
    await this.command("DeclareCapability", { type: "AgentProfile", id: "mine" }, input as unknown as Record<string, unknown>);
  }

  public async verifyCapability(input: { agentId: string; capability: string }): Promise<void> {
    await this.command("VerifyCapability", { type: "AgentProfile", id: input.agentId }, input as unknown as Record<string, unknown>);
  }

  public async setAvailabilityWindow(input: { startAt: string; endAt: string; marketId: string }): Promise<{ windowId: string }> {
    const body = this.body(await this.command("SetAvailabilityWindow", { type: "AvailabilityWindow", id: "new" }, input as unknown as Record<string, unknown>));
    return { windowId: (body.windowId as string) ?? (body.id as string) ?? "" };
  }

  public async querySuppliers(input: { marketId?: string; capability?: string; limit?: number }): Promise<SupplierCandidate[]> {
    // 后端 QuerySuppliers 要求 marketId + startAt + durationH，capability 映射到 Capabilities/Languages
    const startAt = new Date(Date.now() + 24 * 3600_000).toISOString();
    const payload: Record<string, unknown> = {
      marketId: input.marketId ?? "hn",
      startAt,
      durationH: 8,
      serviceType: "CITY_COMPANION",
      languages: input.capability ? [input.capability] : undefined,
      capabilities: input.capability ? [input.capability] : undefined,
    };
    // 清理 undefined
    for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
    const body = this.body(await this.command("QuerySuppliers", { type: "AgentProfile", id: "query" }, payload));
    return parseSupplierCandidates(body.suppliers ?? body.candidates).slice(0, input.limit ?? 20);
  }

  private async command(commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>): Promise<CommandResult> {
    const session = await this.requireSession();
    const next = (p: string) => `mobile_supply_${p}_${Date.now().toString(36)}_${(++this.seq).toString(36)}`;
    const envelope = {
      commandId: next("command"),
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target,
      idempotencyKey: next("idempotency"),
      authContext: { sessionId: session.auth.sessionId },
      purpose: "supply",
      correlationId: next("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload,
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new Error("supply command malformed");
    if (result.outcome === "REJECTED") throw new Error(commandErrorMessage(result.error, "supply rejected"));
    if (response.status < 200 || response.status >= 300) throw new Error(`unexpected supply status: ${response.status}`);
    return result;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new Error("authenticated principal required");
    if (session.serverSession === false) throw new Error("supply actions require a real sign-in (offline session cannot act)");
    if (session.signedOut === true) throw new OfflineFallbackSessionError();
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private body(result: CommandResult): Record<string, unknown> {
    return parseSupplyBody(result.operationRef);
  }
}
