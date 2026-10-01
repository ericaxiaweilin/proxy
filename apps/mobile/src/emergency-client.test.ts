import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  MAX_EMERGENCY_CONTACTS,
  EmergencyClient,
  EmergencyError,
  coarseLocationLabel,
  deliveryDisclaimer,
  handOffLabel,
  type EmergencyEvent,
} from "./emergency-client";

// SAFETY-NET-001：安全网客户端的钉子。
//
// 这一组里最重要的不是「字段有没有映射对」，而是**口径**：本仓库没有任何
// 向任意用户送达的通道（LogPushProvider 只 log.Printf，SMS/SMTP 只服务登录
// 验证码），所以：
//   ① 事件里 deliveredToContacts 恒为 false；
//   ② 客户端不提供任何「已送达 / deliveryStatus」式的包装函数；
//   ③ 界面文案必须自己说出「平台不会自动通知联系人」。
// 一旦有人把这三条里任意一条改掉，用户会以为紧急联系人已经收到通知了，
// 于是他不再自己打电话 —— 这是这个功能最坏的失败模式。

type Call = { path: string; method: string; body?: unknown };

function fakeClient(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = [];
  let index = 0;
  return {
    calls,
    authClient: {
      async request(path: string, init: { method: "GET" | "POST" | "DELETE"; body?: unknown }) {
        calls.push({ path, method: init.method, body: init.body });
        const next = responses[Math.min(index, responses.length - 1)]!;
        index += 1;
        return {
          status: next.status ?? 200,
          async json() {
            return next.body;
          },
        };
      },
    },
  };
}

const contactRow = {
  contactId: "ec_1",
  displayName: "Nguyễn Thị Hương",
  phone: "+84912345678",
  relation: "家人",
  priority: 1,
  permissionAttestedAt: "2026-10-01T00:00:00Z",
};

const eventRow = {
  eventId: "ee_1",
  kind: "SOS",
  occurredAt: "2026-10-01T01:00:00Z",
  coarseLat: 21.02,
  coarseLng: 105.83,
  coarsePrecisionM: 800,
  locationRecorded: true,
  contactIds: ["ec_1"],
  dialerOpened: true,
  dialedNumber: "113",
  smsHandoffCount: 0,
  deliveredToContacts: false,
};

describe("SAFETY-NET-001 emergency client", () => {
  it("limit matches the server's emergency.MaxContacts", () => {
    // 服务端 const MaxContacts = 3。两边不一致时，第 4 位联系人会在填完
    // 整个表单之后才被服务端拒掉。
    expect(MAX_EMERGENCY_CONTACTS).toBe(3);
  });

  it("listContacts maps rows and falls back to the server limit", async () => {
    const { authClient, calls } = fakeClient([{ body: { contacts: [contactRow], limit: 3 } }]);
    const page = await new EmergencyClient({ authClient }).listContacts();
    expect(calls[0]).toEqual({ path: "/v1/emergency/contacts", method: "GET", body: undefined });
    expect(page.limit).toBe(3);
    expect(page.contacts).toHaveLength(1);
    expect(page.contacts[0]!.displayName).toBe("Nguyễn Thị Hương");
    expect(page.contacts[0]!.relation).toBe("家人");
  });

  it("listContacts treats a missing contacts array as empty, not as an error", async () => {
    const { authClient } = fakeClient([{ body: {} }]);
    const page = await new EmergencyClient({ authClient }).listContacts();
    expect(page.contacts).toEqual([]);
    expect(page.limit).toBe(MAX_EMERGENCY_CONTACTS);
  });

  it("drops rows that have no contactId instead of inventing one", async () => {
    // 没有 id 的行无法删除、无法引用 —— 收进来只会变成一个点不动的列表项。
    const { authClient } = fakeClient([{ body: { contacts: [contactRow, { displayName: "x" }] } }]);
    const page = await new EmergencyClient({ authClient }).listContacts();
    expect(page.contacts).toHaveLength(1);
  });

  it("upsertContact always sends an explicit permissionAttested:true", async () => {
    // 服务端只存用户的声明；替用户填上就等于伪造那一列要保护的证据。
    const { authClient, calls } = fakeClient([{ body: { contact: contactRow } }]);
    await new EmergencyClient({ authClient }).upsertContact({
      displayName: "Nguyễn Thị Hương",
      phone: "+84912345678",
      priority: 1,
    });
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.permissionAttested).toBe(true);
    expect(body.contactId).toBeUndefined();
  });

  it("upsertContact sends contactId only when editing", async () => {
    const { authClient, calls } = fakeClient([{ body: { contact: contactRow } }]);
    await new EmergencyClient({ authClient }).upsertContact({
      contactId: "ec_1",
      displayName: "Nguyễn Thị Hương",
      phone: "+84912345678",
      priority: 1,
    });
    expect((calls[0]!.body as Record<string, unknown>).contactId).toBe("ec_1");
  });

  it("deleteContact uses DELETE with the id in the query string", async () => {
    const { authClient, calls } = fakeClient([{ body: { contactId: "ec_1", removed: true } }]);
    const removed = await new EmergencyClient({ authClient }).deleteContact("ec_1");
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.path).toBe("/v1/emergency/contacts?contactId=ec_1");
    expect(removed).toBe(true);
  });

  it("recordEvent sends latitude/longitude only as a pair", async () => {
    // 半个坐标服务端会拒（INVALID_EMERGENCY_LOCATION）。客户端先不发，
    // 免得把一个必然失败的请求打出去。
    const { authClient, calls } = fakeClient([{ body: { event: eventRow } }]);
    await new EmergencyClient({ authClient }).recordEvent({ kind: "SOS", latitude: 21.0285 });
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.latitude).toBeUndefined();
    expect(body.longitude).toBeUndefined();
  });

  it("recordEvent sends the pair when both are present", async () => {
    const { authClient, calls } = fakeClient([{ body: { event: eventRow } }]);
    await new EmergencyClient({ authClient }).recordEvent({
      kind: "SOS",
      latitude: 21.0285,
      longitude: 105.8542,
    });
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.latitude).toBe(21.0285);
    expect(body.longitude).toBe(105.8542);
    expect(body.kind).toBe("SOS");
  });

  it("recordEvent reads deliveredToContacts faithfully instead of assuming false", async () => {
    // 现在服务端恒发 false，但客户端不许把 false 写死 —— 写死的话，
    // 将来真的接上送达通道时界面不会跟着变，会继续告诉用户"没送出去"。
    const { authClient } = fakeClient([{ body: { event: { ...eventRow, deliveredToContacts: true } } }]);
    const event = await new EmergencyClient({ authClient }).recordEvent({ kind: "SOS" });
    expect(event.deliveredToContacts).toBe(true);
  });

  it("listEvents passes limit through and filters unusable rows", async () => {
    const { authClient, calls } = fakeClient([
      { body: { events: [eventRow, { kind: "SOS" }] } },
    ]);
    const page = await new EmergencyClient({ authClient }).listEvents(5);
    expect(calls[0]!.path).toBe("/v1/emergency/events?limit=5");
    expect(page.events).toHaveLength(1);
  });

  it("surfaces the server error code rather than a generic message", async () => {
    // 第 4 位联系人：服务端回 EMERGENCY_CONTACT_LIMIT_REACHED。界面要能
    // 据此说人话；退化成 http_400 就只剩一句"出错了"。
    const { authClient } = fakeClient([
      { status: 400, body: { error: "EMERGENCY_CONTACT_LIMIT_REACHED", details: { limit: 3 } } },
    ]);
    await expect(
      new EmergencyClient({ authClient }).upsertContact({
        displayName: "x",
        phone: "+84912345678",
        priority: 3,
      }),
    ).rejects.toMatchObject({ code: "EMERGENCY_CONTACT_LIMIT_REACHED", httpStatus: 400 });
  });

  it("surfaces the not-attested rejection", async () => {
    const { authClient } = fakeClient([
      { status: 400, body: { error: "EMERGENCY_CONTACT_PERMISSION_NOT_ATTESTED" } },
    ]);
    const error = await new EmergencyClient({ authClient })
      .upsertContact({ displayName: "x", phone: "+84912345678", priority: 1 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmergencyError);
    expect((error as EmergencyError).code).toBe("EMERGENCY_CONTACT_PERMISSION_NOT_ATTESTED");
  });

  it("treats a 401 as an error instead of an empty list", async () => {
    // 会话过期时不能返回空列表 —— 那会读成"我没有紧急联系人"。
    const { authClient } = fakeClient([{ status: 401, body: { error: "access_token_required" } }]);
    await expect(new EmergencyClient({ authClient }).listContacts()).rejects.toMatchObject({
      httpStatus: 401,
    });
  });
});

describe("SAFETY-NET-001 位置与送达口径", () => {
  const base: EmergencyEvent = {
    eventId: "ee_1",
    kind: "SOS",
    occurredAt: "2026-10-01T01:00:00Z",
    locationRecorded: false,
    contactIds: [],
    dialerOpened: false,
    smsHandoffCount: 0,
    deliveredToContacts: false,
  };

  it("says the coordinates were dropped when consent was missing", () => {
    const label = coarseLocationLabel({
      ...base,
      locationOmittedReason: "NO_LOCATION_CONSENT",
    });
    // 「取不出来」和「确实没有」必须分开说：这里要指出坐标是被**丢掉**的。
    expect(label).toContain("未记录位置");
    expect(label).toContain("授权");
  });

  it("states the coarsened precision instead of implying a precise fix", () => {
    const label = coarseLocationLabel({
      ...base,
      locationRecorded: true,
      coarseLat: 21.02,
      coarseLng: 105.83,
      coarsePrecisionM: 800,
    });
    expect(label).toContain("模糊位置");
    expect(label).toContain("800 米");
    expect(label).toContain("不是精确坐标");
  });

  it("never claims a precise location in any branch", () => {
    for (const event of [
      { ...base },
      { ...base, locationOmittedReason: "NO_LOCATION_CONSENT" },
      { ...base, locationRecorded: true, coarsePrecisionM: 1500 },
      { ...base, locationRecorded: true },
    ]) {
      expect(coarseLocationLabel(event)).not.toContain("精确位置");
      expect(coarseLocationLabel(event)).not.toContain("准确位置");
    }
  });

  it("handOffLabel only claims local actions that really happened", () => {
    expect(handOffLabel(base)).toBe("已记录这条事件");
    expect(handOffLabel({ ...base, dialerOpened: true, dialedNumber: "113" })).toContain("113");
    expect(handOffLabel({ ...base, smsHandoffCount: 2 })).toContain("2 次");
  });

  it("the delivery disclaimer says the platform does not notify contacts", () => {
    const text = deliveryDisclaimer();
    expect(text).toContain("不会自动通知");
    expect(text).toContain("自己确认");
  });
});

describe("SAFETY-NET-001 客户端不许出现「已送达」式的包装", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./emergency-client.ts", import.meta.url)),
    "utf8",
  );
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");

  it("exports no isDelivered / deliveryStatus style helper", () => {
    // 一旦有这么一个函数，调用方就会拿它渲染「已通知紧急联系人」。
    // 真实语义只有 handOffLabel（做了什么）和 deliveryDisclaimer（没做什么）。
    //
    // 注意这个判据要窄：deliveryDisclaimer 本身必须留着，所以不能简单地
    // 禁 /deliver/i —— 第一版就是这么写的，它把 deliveryDisclaimer 也判红了。
    // 这里禁的是「已经送达」这个**断言**：Delivered 这个过去分词，
    // 以及 deliveryStatus 这类状态查询。
    expect(code).not.toMatch(/export function \w*Delivered\w*/i);
    expect(code).not.toMatch(/export function \w*deliveryStatus\w*/i);
    // 反向配重：disclaimer 必须还在，否则上面那条禁了个空。
    expect(code).toMatch(/export function deliveryDisclaimer/);
  });

  it("does not hardcode deliveredToContacts to false on the way out", () => {
    // 写死 false 会让「将来接上送达通道」这件事在客户端被静默吞掉。
    expect(code).toContain("deliveredToContacts: r.deliveredToContacts === true");
  });
});
