import { describe, expect, it } from "vitest";
import { ExperienceManifestSchema } from "./index.js";

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
            hint: "消费与需求",
            items: [
              {
                id: "my_needs",
                icon: "◇",
                label: "我的需求与订单",
                description: "进行中、待确认、历史与复用",
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
                description: "已参加 / 发起的现实活动",
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
                description: "bad",
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
            description: "Proxy 名片",
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
});
