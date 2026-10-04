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
  // MERCHANT-CREATOR-TAGS-001：只含 VERIFIED 未过期的能力编码（服务端 verifiedCapabilityCodes）。
  // 老服务端不带该字段时解析为 []，调用方按“无标签”处理。
  verifiedCapabilities?: string[];
  // MERCHANT-CREATOR-TAGS-001：粉丝数没有聚合来源；商家看到的是已关联
  // 社媒账号（platform + handle + 自填粉丝数，可见性已在服务端按调用方过滤）。
  // followerCount 必有（缺失记 0=未披露）。老服务端不带 socials 字段时为空数组。
  socials?: Array<{ platform: string; handle: string; followerCount: number }>;
  // MERCHANT-CREATOR-TAGS-001：评价分有真实来源 —— 服务端 matching.Score
  // 算出来的 Total（0..100；履约40/评价30/经验15/响应10/预算5）。
  // 无成交记录时 Total 取先验值、hasTrackRecord=false，UI 印「新人」不编分。
  // completedOrders 是真实成交单量（Postgres 订单表），商家页「服务量」来源。
  rating?: { total: number; hasTrackRecord: boolean; satisfactionRate: number; fulfillmentRate: number; completedOrders: number };
  // MERCHANT-CREATOR-TAGS-001：创作者自声明内容垂类（展示过滤在客户端）。
  // 老服务端不带该字段时解析为 []。
  verticalTags?: string[];
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
    // 评价分：total 必须是数（服务端 matching.Score 的真实输出），不是数
    // 说明是老服务端 —— 不编，调用方按「无评分」处理（不渲染胶囊）。
    const ratingRaw = item.rating && typeof item.rating === "object" ? item.rating as Record<string, unknown> : undefined;
    const parsedRating = ratingRaw && typeof ratingRaw.total === "number" ? {
      total: ratingRaw.total,
      hasTrackRecord: ratingRaw.hasTrackRecord === true,
      satisfactionRate: typeof ratingRaw.satisfactionRate === "number" ? ratingRaw.satisfactionRate : 0,
      fulfillmentRate: typeof ratingRaw.fulfillmentRate === "number" ? ratingRaw.fulfillmentRate : 0,
      completedOrders: typeof ratingRaw.completedOrders === "number" && ratingRaw.completedOrders > 0 ? Math.floor(ratingRaw.completedOrders) : 0,
    } : undefined;
    return [{ agentId: item.agentId,
      ...(typeof item.userAccountId === "string" && item.userAccountId !== "" ? { userAccountId: item.userAccountId } : {}),
      name: item.name,
      photos: Array.isArray(item.photos) ? item.photos.filter((photo): photo is string => typeof photo === "string" && photo.length > 0) : [],
      languages: Array.isArray(item.languages) ? item.languages.filter((language): language is string => typeof language === "string") : [],
      verticalTags: Array.isArray(item.verticalTags) ? item.verticalTags.filter((tag): tag is string => typeof tag === "string" && tag.length > 0) : [],
      socials: Array.isArray(item.socials) ? item.socials.flatMap((entry): Array<{ platform: string; handle: string; followerCount: number }> => {
        if (!entry || typeof entry !== "object") return [];
        const record = entry as Record<string, unknown>;
        if (typeof record.platform !== "string" || typeof record.handle !== "string" || record.handle === "") return [];
        // 粉丝数字段必有：缺失/非法一律记 0（未披露），调用方不再需要判空。
        const count = typeof record.followerCount === "number" && record.followerCount > 0 ? Math.floor(record.followerCount) : 0;
        return [{ platform: record.platform, handle: record.handle, followerCount: count }];
      }) : [],
      verifiedCapabilities: Array.isArray(item.verifiedCapabilities) ? item.verifiedCapabilities.filter((capability): capability is string => typeof capability === "string" && capability.length > 0) : [],
      serviceType: typeof item.serviceType === "string" ? item.serviceType : "",
      referencePrice: typeof item.referencePrice === "number" ? item.referencePrice : 0,
      currency: typeof item.currency === "string" ? item.currency : "VND",
      ...(parsedAvailability ? { availability: parsedAvailability } : {}),
      ...(parsedRating ? { rating: parsedRating } : {}),
      eligibility: { eligible: eligibility.eligible === true, capabilitiesOk: eligibility.capabilitiesOk === true, availabilityOk: eligibility.availabilityOk === true, marketOk: eligibility.marketOk === true },
    }];
  });
}

// MERCHANT-CREATOR-INVITE-001：定向邀约。商家发（带 merchantId，网关验成员
// 身份后盖章）、creator 收（按 principal == agentId 鉴权）。状态只有
// PENDING 能流转；ACCEPTED/DECLINED/CANCELLED/EXPIRED 是终态展示。
export type CollabInvitationStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "EXPIRED";

export type CollabInvitation = {
  id: string;
  merchantId: string;
  agentId: string;
  serviceType: string;
  startAt?: string | undefined;
  durationH: number;
  priceVnd: number;
  currency: string;
  message: string;
  status: CollabInvitationStatus;
  createdAt: string;
  respondedAt?: string | undefined;
  expiresAt: string;
};

const INVITATION_STATUSES: ReadonlySet<string> = new Set(["PENDING", "ACCEPTED", "DECLINED", "CANCELLED", "EXPIRED"]);

export function parseCollabInvitation(value: unknown): CollabInvitation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || item.id === "") return undefined;
  if (typeof item.merchantId !== "string" || typeof item.agentId !== "string") return undefined;
  if (typeof item.status !== "string" || !INVITATION_STATUSES.has(item.status)) return undefined;
  if (typeof item.createdAt !== "string" || typeof item.expiresAt !== "string") return undefined;
  return {
    id: item.id,
    merchantId: item.merchantId,
    agentId: item.agentId,
    serviceType: typeof item.serviceType === "string" ? item.serviceType : "",
    ...(typeof item.startAt === "string" && item.startAt !== "" ? { startAt: item.startAt } : {}),
    durationH: typeof item.durationH === "number" ? item.durationH : 0,
    priceVnd: typeof item.priceVnd === "number" ? item.priceVnd : 0,
    currency: typeof item.currency === "string" ? item.currency : "VND",
    message: typeof item.message === "string" ? item.message : "",
    status: item.status as CollabInvitationStatus,
    createdAt: item.createdAt,
    ...(typeof item.respondedAt === "string" && item.respondedAt !== "" ? { respondedAt: item.respondedAt } : {}),
    expiresAt: item.expiresAt,
  };
}

export function parseCollabInvitations(value: unknown): CollabInvitation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = parseCollabInvitation(entry);
    return parsed ? [parsed] : [];
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

  // MERCHANT-CREATOR-INVITE-001：商家发定向邀约。merchantId 进 payload，
  // 网关验成员身份后盖章（伪造别人 merchantId 到不了 service）。
  public async inviteCreator(input: { merchantId: string; agentId: string; priceVnd?: number; message?: string }): Promise<CollabInvitation> {
    const payload: Record<string, unknown> = { merchantId: input.merchantId, agentId: input.agentId, serviceType: "CITY_COMPANION" };
    if (input.priceVnd !== undefined) payload.priceVnd = input.priceVnd;
    if (input.message !== undefined) payload.message = input.message;
    const body = this.body(await this.command("InviteCreator", { type: "CollabInvitation", id: "new" }, payload));
    const parsed = parseCollabInvitation(body.invitation);
    if (!parsed) throw new SupplyProtocolError("invitation malformed");
    return parsed;
  }

  public async listSentInvitations(input: { merchantId: string }): Promise<CollabInvitation[]> {
    const body = this.body(await this.command("ListCollabInvitations", { type: "CollabInvitation", id: "query" }, { merchantId: input.merchantId, role: "sent" }));
    return parseCollabInvitations(body.invitations);
  }

  public async cancelInvitation(input: { merchantId: string; invitationId: string }): Promise<void> {
    await this.command("CancelCollabInvitation", { type: "CollabInvitation", id: input.invitationId }, { merchantId: input.merchantId, invitationId: input.invitationId });
  }

  // MERCHANT-CREATOR-INVITE-001：creator 收邀约 + 回复。principal 就是 agent 本人，
  // 服务端按 Principal.ID == agentID 校验 —— 调这个方法的面必须保证是本人视角。
  public async listReceivedInvitations(): Promise<CollabInvitation[]> {
    const body = this.body(await this.command("ListCollabInvitations", { type: "CollabInvitation", id: "query" }, { role: "received" }));
    return parseCollabInvitations(body.invitations);
  }

  public async respondInvitation(input: { invitationId: string; decision: "ACCEPTED" | "DECLINED" }): Promise<CollabInvitation> {
    const body = this.body(await this.command("RespondCollabInvitation", { type: "CollabInvitation", id: input.invitationId }, { invitationId: input.invitationId, decision: input.decision }));
    const parsed = parseCollabInvitation(body.invitation);
    if (!parsed) throw new SupplyProtocolError("invitation malformed");
    return parsed;
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
