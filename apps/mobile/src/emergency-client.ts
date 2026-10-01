// SAFETY-NET-001：用户自己的安全网客户端（紧急联系人 + 紧急事件）。
//
// 服务端：/v1/emergency/contacts（GET / POST / DELETE）与
//         /v1/emergency/events（GET / POST），需会话 Bearer。
// 五条命令：ListEmergencyContacts / UpsertEmergencyContact /
//           DeleteEmergencyContact / RecordEmergencyEvent / ListEmergencyEvents。
//
// 这个文件是纯 TypeScript（没有 React、没有 react-native），vitest 可以直接
// import —— 与 location-consent-client.ts 同一套理由。
//
// ── 这个文件里最重要的一件事：不许把「交出去」说成「送到了」────────────
//
// 本仓库**没有任何**向任意用户推送 / 发短信 / 发邮件的通道：
// notification.LogPushProvider 只是 log.Printf，SMS/SMTP 只服务登录验证码。
// 所以服务端 eventBody.deliveredToContacts **恒为 false**，而且它存在本身
// 就是为了让「字段缺失」不能被读成「已送达」。
//
// 这里同样不提供任何 deliveredToContacts 的包装函数（不叫
// isDelivered / deliveryStatus 之类）—— 一旦有这么一个函数，调用方就会
// 用它去渲染「已通知紧急联系人」，而那句话是假的。
// 真实语义只有两种，各有专门的函数：
//   · handOffLabel()    —— 我们真的做了什么（记录 / 打开拨号盘 / 交给短信）
//   · deliveryDisclaimer() —— 我们**没有**做什么（不会自动通知任何人）

import type { TransportResponse } from "./auth-client";

// 服务端 emergency.MaxContacts。第 4 位联系人会被服务端拒
// （EMERGENCY_CONTACT_LIMIT_REACHED），客户端在这里先拦一次只是为了
// 别让用户填完整个表单才被拒。
export const MAX_EMERGENCY_CONTACTS = 3;

export type EmergencyContact = {
  contactId: string;
  displayName: string;
  phone: string;
  relation?: string;
  // 1..3，越小越先联系。服务端有 (user_id, priority) 的部分唯一索引，
  // 所以同一用户不能有两个 priority 相同的联系人。
  priority: number;
  // 用户「声明」该联系人同意被列入的时间。这不是平台的核验结果 ——
  // 服务端只存用户的声明，没有 verified 标志，客户端也不许造一个。
  permissionAttestedAt: string;
};

export type EmergencyEventKind = "SOS" | "MEETUP_CHECKIN";

export const ALL_EMERGENCY_EVENT_KINDS: ReadonlyArray<EmergencyEventKind> = [
  "SOS",
  "MEETUP_CHECKIN",
];

export type EmergencyEvent = {
  eventId: string;
  kind: EmergencyEventKind;
  occurredAt: string;
  // 粗化后的坐标。服务端在写库前就粗化了，这里拿到的**从来不是**精确点。
  coarseLat?: number;
  coarseLng?: number;
  coarsePrecisionM?: number;
  // 显式布尔值：把「根本没发坐标」和「发了坐标但没有授权所以被丢掉」
  // 分开。后者看 locationOmittedReason。
  locationRecorded: boolean;
  locationOmittedReason?: string;
  contactIds: string[];
  dialerOpened: boolean;
  dialedNumber?: string;
  smsHandoffCount: number;
  note?: string;
  // 恒为 false。见文件头。
  deliveredToContacts: boolean;
};

export type EmergencyContactInput = {
  // 有 contactId = 改，没有 = 新增。
  contactId?: string;
  displayName: string;
  phone: string;
  relation?: string;
  priority: number;
};

export type EmergencyEventInput = {
  kind: EmergencyEventKind;
  latitude?: number;
  longitude?: number;
  contactIds?: string[];
  dialerOpened?: boolean;
  dialedNumber?: string;
  smsHandoffCount?: number;
  note?: string;
};

export type EmergencyContactsPage = {
  contacts: EmergencyContact[];
  limit: number;
};

export type EmergencyEventsPage = {
  events: EmergencyEvent[];
};

export class EmergencyError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details: Record<string, unknown>;
  constructor(code: string, httpStatus: number, details: Record<string, unknown> = {}) {
    super(code);
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    this.name = "EmergencyError";
  }
}

export interface EmergencyClientOptions {
  authClient: {
    request(
      path: string,
      init: { method: "GET" | "POST" | "DELETE"; body?: unknown },
    ): Promise<TransportResponse>;
  };
}

export class EmergencyClient {
  private readonly authClient: EmergencyClientOptions["authClient"];

  constructor(opts: EmergencyClientOptions) {
    this.authClient = opts.authClient;
  }

  async listContacts(): Promise<EmergencyContactsPage> {
    const body = await this.request<Record<string, unknown>>("GET", "/v1/emergency/contacts");
    return {
      contacts: normaliseContacts(body.contacts),
      limit: typeof body.limit === "number" ? body.limit : MAX_EMERGENCY_CONTACTS,
    };
  }

  async upsertContact(input: EmergencyContactInput): Promise<EmergencyContact> {
    // permissionAttested 必须是**显式的 true**。服务端对缺失/false 一律拒绝
    // （EMERGENCY_CONTACT_PERMISSION_NOT_ATTESTED），因为那一列存的是
    // 「用户声明联系人同意了」这个证据 —— 替用户填上就等于伪造证据。
    // 所以这个客户端也把它做成必传参数，而不是默认 true。
    const payload: Record<string, unknown> = {
      displayName: input.displayName,
      phone: input.phone,
      priority: input.priority,
      permissionAttested: true,
    };
    if (input.contactId) payload.contactId = input.contactId;
    if (input.relation) payload.relation = input.relation;
    const body = await this.request<Record<string, unknown>>(
      "POST",
      "/v1/emergency/contacts",
      payload,
    );
    const contact = normaliseContact(body.contact);
    if (!contact) {
      throw new EmergencyError("EMERGENCY_CONTACT_WRITE_FAILED", 200, {});
    }
    return contact;
  }

  async deleteContact(contactId: string): Promise<boolean> {
    const path = `/v1/emergency/contacts?contactId=${encodeURIComponent(contactId)}`;
    const body = await this.request<Record<string, unknown>>("DELETE", path);
    return body.removed === true;
  }

  async recordEvent(input: EmergencyEventInput): Promise<EmergencyEvent> {
    const payload: Record<string, unknown> = { kind: input.kind };
    // 纬度/经度必须成对。只发一个会被服务端拒
    // （INVALID_EMERGENCY_LOCATION），因为半个坐标没法用。
    if (typeof input.latitude === "number" && typeof input.longitude === "number") {
      payload.latitude = input.latitude;
      payload.longitude = input.longitude;
    }
    if (input.contactIds) payload.contactIds = input.contactIds;
    if (input.dialerOpened) payload.dialerOpened = true;
    if (input.dialedNumber) payload.dialedNumber = input.dialedNumber;
    if (typeof input.smsHandoffCount === "number") {
      payload.smsHandoffCount = input.smsHandoffCount;
    }
    if (input.note) payload.note = input.note;
    const body = await this.request<Record<string, unknown>>(
      "POST",
      "/v1/emergency/events",
      payload,
    );
    const event = normaliseEvent(body.event);
    if (!event) {
      throw new EmergencyError("EMERGENCY_EVENT_WRITE_FAILED", 200, {});
    }
    return event;
  }

  async listEvents(limit?: number): Promise<EmergencyEventsPage> {
    const path =
      typeof limit === "number" && limit > 0
        ? `/v1/emergency/events?limit=${limit}`
        : "/v1/emergency/events";
    const body = await this.request<Record<string, unknown>>("GET", path);
    const raw = Array.isArray(body.events) ? body.events : [];
    return {
      events: raw
        .map((row) => normaliseEvent(row))
        .filter((row): row is EmergencyEvent => row !== null),
    };
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await this.authClient.request(path, {
      method,
      ...(body === undefined ? {} : { body }),
    });
    const raw = await res.json().catch(() => null);
    if (res.status >= 400) {
      const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const code = typeof record.error === "string" ? record.error : `http_${res.status}`;
      const details =
        record.details && typeof record.details === "object"
          ? (record.details as Record<string, unknown>)
          : {};
      throw new EmergencyError(code, res.status, details);
    }
    return raw as T;
  }
}

// resolveEmergencyClient 用已认证的 SessionAuthClient 构造。绝不裸 fetch：
// 这两条路由要 Bearer，且要 /v1 前缀（与 resolveLocationConsentClient 同形）。
export function resolveEmergencyClient(input: {
  authClient: EmergencyClientOptions["authClient"];
}): EmergencyClient {
  return new EmergencyClient({ authClient: input.authClient });
}

// ── 解析（服务端字段缺失时不许「猜」出一个可用值）──────────────────────

function normaliseContact(raw: unknown): EmergencyContact | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.contactId !== "string" || r.contactId === "") return null;
  if (typeof r.displayName !== "string") return null;
  if (typeof r.phone !== "string") return null;
  const contact: EmergencyContact = {
    contactId: r.contactId,
    displayName: r.displayName,
    phone: r.phone,
    priority: typeof r.priority === "number" ? r.priority : 0,
    permissionAttestedAt:
      typeof r.permissionAttestedAt === "string" ? r.permissionAttestedAt : "",
  };
  if (typeof r.relation === "string" && r.relation !== "") contact.relation = r.relation;
  return contact;
}

function normaliseContacts(raw: unknown): EmergencyContact[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => normaliseContact(row))
    .filter((row): row is EmergencyContact => row !== null);
}

function normaliseEvent(raw: unknown): EmergencyEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.eventId !== "string" || r.eventId === "") return null;
  const kind = r.kind === "SOS" || r.kind === "MEETUP_CHECKIN" ? r.kind : null;
  if (!kind) return null;
  const event: EmergencyEvent = {
    eventId: r.eventId,
    kind,
    occurredAt: typeof r.occurredAt === "string" ? r.occurredAt : "",
    locationRecorded: r.locationRecorded === true,
    contactIds: Array.isArray(r.contactIds)
      ? r.contactIds.filter((id): id is string => typeof id === "string")
      : [],
    dialerOpened: r.dialerOpened === true,
    smsHandoffCount: typeof r.smsHandoffCount === "number" ? r.smsHandoffCount : 0,
    // 服务端恒发 false；万一将来它发了 true，这里也不拦 —— 但 UI 的
    // deliveryDisclaimer() 说的是「本版本没有送达通道」，那时必须一起改。
    deliveredToContacts: r.deliveredToContacts === true,
  };
  if (typeof r.coarseLat === "number") event.coarseLat = r.coarseLat;
  if (typeof r.coarseLng === "number") event.coarseLng = r.coarseLng;
  if (typeof r.coarsePrecisionM === "number") event.coarsePrecisionM = r.coarsePrecisionM;
  if (typeof r.locationOmittedReason === "string" && r.locationOmittedReason !== "") {
    event.locationOmittedReason = r.locationOmittedReason;
  }
  if (typeof r.dialedNumber === "string" && r.dialedNumber !== "") {
    event.dialedNumber = r.dialedNumber;
  }
  if (typeof r.note === "string" && r.note !== "") event.note = r.note;
  return event;
}

// ── 展示口径 ──────────────────────────────────────────────────────────

// 越南报警/急救号码。三个都是真的（2026-10 核实）：
//   113 警察 / 114 消防 / 115 急救。
// 这里**只**提供号码与拨号，不提供任何「已报警」的措辞 —— 拨出去之后
// 发生什么，平台不知道。
export const VN_EMERGENCY_NUMBERS: ReadonlyArray<{ number: string; label: string }> = [
  { number: "113", label: "警察" },
  { number: "114", label: "消防" },
  { number: "115", label: "急救" },
];

// 位置已记录时的说法。故意把「粗化到多大范围」写出来：这是安全功能，
// 让用户以为平台知道精确位置、实际只知道一个格子，方向是错的。
export function coarseLocationLabel(event: EmergencyEvent): string {
  if (!event.locationRecorded) {
    if (event.locationOmittedReason === "NO_LOCATION_CONSENT") {
      return "未记录位置：当时没有生效的位置授权，坐标已丢弃";
    }
    return "未记录位置";
  }
  const meters = event.coarsePrecisionM;
  if (typeof meters !== "number") return "已记录模糊位置";
  return `已记录模糊位置：精度约 ${formatMeters(meters)}（不是精确坐标）`;
}

function formatMeters(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} 米`;
  return `${(meters / 1000).toFixed(1)} 公里`;
}

// handOffLabel 说「我们真的做了什么」。三样都是有据可查的本地动作：
// 事件行、拨号盘、短信交接次数。
export function handOffLabel(event: EmergencyEvent): string {
  const parts: string[] = ["已记录这条事件"];
  if (event.dialerOpened) {
    parts.push(event.dialedNumber ? `已打开拨号盘（${event.dialedNumber}）` : "已打开拨号盘");
  }
  if (event.smsHandoffCount > 0) parts.push(`已转交短信 ${event.smsHandoffCount} 次`);
  return parts.join(" · ");
}

// deliveryDisclaimer 说「我们没有做什么」。这句话的存在理由是本仓库
// 根本没有向任意用户送达的通道；不写清楚，用户会以为紧急联系人已经
// 收到通知了 —— 那是最坏的一种假承诺（他因此不去自己打电话）。
export function deliveryDisclaimer(): string {
  return "平台目前不会自动通知你的紧急联系人：这里只做记录，并协助你拨打或转交短信。请自己确认对方已收到。";
}
