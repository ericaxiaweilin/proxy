import { describe, expect, it } from "vitest";
import { ExperienceManifestSchema, RegisteredExperienceRouteSchema } from "./index";

describe("ExperienceManifest R1", () => {
  it("accepts the registered Me -> Tasks actions", () => {
    const parsed = ExperienceManifestSchema.safeParse({
      schemaVersion: "1.0",
      revision: "experience_r1",
      context: "REQUESTER",
      me: {
        sections: [
          {
            id: "my_usage",
            title: "我的使用",
            items: [
              {
                id: "my_needs",
                icon: "◇",
                label: "我的需求与订单",
                accent: true,
                action: {
                  type: "OPEN_SURFACE",
                  surface: "TASKS",
                  params: { view: "NEED" }
                }
              },
              {
                id: "my_activities",
                icon: "◎",
                label: "我的活动",
                action: {
                  type: "OPEN_SURFACE",
                  surface: "TASKS",
                  params: {
                    view: "ACTIVITY",
                    filter: "MINE"
                  }
                }
              }
            ]
          }
        ]
      }
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects arbitrary remote surface/action execution", () => {
    const parsed = ExperienceManifestSchema.safeParse({
      schemaVersion: "1.0",
      revision: "evil",
      context: "REQUESTER",
      me: {
        sections: [
          {
            id: "bad",
            title: "bad",
            items: [
              {
                id: "bad",
                icon: "!",
                label: "bad",
                action: {
                  type: "RUN_ARBITRARY_CODE",
                  surface: "SECRET_ADMIN",
                  params: {
                    javascript: "eval('bad')"
                  }
                }
              }
            ]
          }
        ]
      }
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts only allowlisted registered client routes", () => {
    const base = {
      schemaVersion: "1.0",
      revision: "experience_r2",
      context: "REQUESTER",
      me: {
        mode: "REPLACE",
        sections: [{
          id: "profile",
          title: "个人主页",
          items: [{
            id: "hub",
            icon: "○",
            label: "主页与二维码",
            action: { type: "OPEN_REGISTERED_ROUTE", route: "personalhub" }
          }]
        }]
      }
    };

    expect(ExperienceManifestSchema.safeParse(base).success).toBe(true);
    const section = base.me.sections[0]!;
    const item = section.items[0]!;
    expect(ExperienceManifestSchema.safeParse({
      ...base,
      me: {
        ...base.me,
        sections: [{
          ...section,
          items: [{
            ...item,
            action: { type: "OPEN_REGISTERED_ROUTE", route: "secret_admin" }
          }]
        }]
      }
    }).success).toBe(false);
  });

  it("removes the obsolete postfeed Me route from the protocol", () => {
    expect(RegisteredExperienceRouteSchema.safeParse("favorites").success).toBe(true);
    expect(RegisteredExperienceRouteSchema.safeParse("postfeed").success).toBe(false);
  });

  it("no longer carries a section hint — and rejects one if it comes back", () => {
    // 2026-10-09：`me.sections[].hint` 整体删除（用户：「把解释性的废话全部删除」）。
    // schema 是 `.strict()`，所以服务端要是再下发 `hint`，是**整包校验失败**而不是被
    // 静默忽略 —— 删掉的东西不许悄悄回来。
    //
    // ⚠️ 两边都要断言：只断言「带 hint 不过」的话，payload 本身不合法（比如 route
    // 没进白名单）也会让它绿 —— 那是假守卫。所以先证明同一个 payload 不带 hint 能过。
    const section = {
      id: "my_usage",
      title: "我的使用",
      items: [{
        id: "my_needs",
        icon: "◇",
        label: "我的需求与订单",
        action: { type: "OPEN_REGISTERED_ROUTE" as const, route: "myorders" }
      }]
    };
    const manifest = (s: unknown): unknown => ({
      schemaVersion: "1.0",
      revision: "experience_r1",
      context: "REQUESTER",
      me: { sections: [s] }
    });
    expect(ExperienceManifestSchema.safeParse(manifest(section)).success).toBe(true);
    expect(
      ExperienceManifestSchema.safeParse(manifest({ ...section, hint: "消费与需求" })).success
    ).toBe(false);
  });

  it("no longer carries an item description — and rejects one if it comes back", () => {
    // 2026-10-09：菜单项的 `description` 整体删除（同 `hint`，用户：「把解释性的
    // 废话全部删除」）。同样是 `.strict()`，同样是**两边都断言**：先证明不带它
    // 能过，再证明带它不过 —— 否则 payload 因别的原因不合法也会让这条绿。
    const item = {
      id: "wallet",
      icon: "coin",
      label: "钱包与结算",
      action: { type: "OPEN_REGISTERED_ROUTE" as const, route: "wallet" }
    };
    const withItem = (i: unknown): unknown => ({
      schemaVersion: "1.0",
      revision: "experience_r1",
      context: "REQUESTER",
      me: { sections: [{ id: "account", title: "账户", items: [i] }] }
    });
    expect(ExperienceManifestSchema.safeParse(withItem(item)).success).toBe(true);
    expect(
      ExperienceManifestSchema.safeParse(
        withItem({ ...item, description: "付款、收入、退款与记录" })
      ).success
    ).toBe(false);
  });
});
