import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { commandErrorMessage } from "./command-error-message";

// SERVICE-DISABLED-MSG-001：运营拨下 kill switch 后，命令被拒时服务端给的
// messageKey 是 `compliance.service_disabled` —— 一个**机器串**，不是句子。
// 各 *-client.ts 原本直接 throw new Error(messageKey ?? errorCode ?? …)，
// 于是英文代码直接给用户看了。这里钉两件事：
//   ① 已知的「服务被停」码必须翻译成人话；
//   ② **每一个**会拒绝命令的 client 出口都真的走了这个映射（不是只改一处）。
describe("SERVICE-DISABLED-MSG-001: 被拒的命令说人话，不说机器串", () => {
  const read = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it("SERVICE_DISABLED 翻译成人话，并保留原始错误码便于排查", () => {
    const msg = commandErrorMessage({ errorCode: "SERVICE_DISABLED", messageKey: "compliance.service_disabled" }, "payment rejected");
    expect(msg).toContain("服务已暂停");
    // 先例（native-app.tsx 的 loginChallengeErrorMessage）刻意把原始码留在括号里，
    // 别把它删掉 —— 客服要靠它对得上服务端的日志。
    expect(msg).toContain("SERVICE_DISABLED");
    // 不能还是那个机器串本身。
    expect(msg).not.toBe("compliance.service_disabled");
  });

  it("只有 messageKey、没有 errorCode 时也能认出来", () => {
    expect(commandErrorMessage({ messageKey: "compliance.service_disabled" }, "fulfillment rejected")).toContain("服务已暂停");
  });

  it("未映射的码保持原行为（messageKey ?? errorCode ?? fallback），不扩大改动面", () => {
    // scene-client 的测试断言 /scene\.guard_rejected/ —— 所以这条行为不能动。
    expect(commandErrorMessage({ messageKey: "scene.guard_rejected" }, "x")).toBe("scene.guard_rejected");
    expect(commandErrorMessage({ errorCode: "SOME_OTHER_CODE" }, "x")).toBe("SOME_OTHER_CODE");
    expect(commandErrorMessage(undefined, "payment rejected")).toBe("payment rejected");
    expect(commandErrorMessage(null, "supply rejected")).toBe("supply rejected");
  });

  it("每一个拒绝命令的 client 出口都走了映射（不是只改一处）", () => {
    // 这就是 LC-06 那条教训的同一形状：钉「某个文件里有这个符号」抓不到
    // 「这一处出口没接」。第一版只接了 7 个 commerce client，grep 一查还有
    // 18 处同样的漏翻译 —— 其中 marketplace-client 正是「MARKETPLACE 被停、
    // 用户点下单」那条路。所以这里**逐个文件**钉。
    const wired = [
      "./payment-client.ts",
      "./fulfillment-client.ts",
      "./supply-client.ts",
      "./voucher-client.ts",
      "./social-settings-client.ts",
      "./socialspace-client.ts",
      "./benefit-client.ts",
      "./login-client.ts",
      "./relationship-client.ts",
      "./profile-client.ts",
      "./engagement-client.ts",
      "./experience-client.ts",
      "./moderation-client.ts",
      "./activity-client.ts",
      "./marketplace-client.ts",
      "./session-client.ts",
      "./demand-client.ts",
      "./notification-client.ts",
      "./outcome-client.ts",
      "./business-client.ts",
      "./localnet-client.ts",
      "./storeonboarding-client.ts",
      "./scene-client.ts",
      "./media-client.ts",
      "./experience-runtime/client.ts",
      // 场景域的命令出口从 surfaces/reality-scene-map.tsx 搬到了
      // ./scene-commands.ts（分类列表/单店详情也要发同一种命令，封包只留
      // 一份）。这一条钉的是「发命令的地方必须把 messageKey 翻成人话」——
      // 所以跟着代码走：现在真正发命令、真正调 commandErrorMessage 的是
      // scene-commands.ts，还盯着 reality-scene-map.tsx 就是假守卫。
      "./scene-commands.ts",
    ];
    for (const rel of wired) {
      const code = read(rel);
      expect(code, `${rel} 没有走 commandErrorMessage`).toContain("commandErrorMessage");
    }
    // 出口不许再直接把 messageKey 当文案抛出去。
    // 例外：media-client 的 console.log 是**调试日志**，刻意打印原始
    // messageKey / errorCode —— 那不是给用户看的，别去"修"它。
    for (const rel of wired.filter((r) => r !== "./media-client.ts")) {
      const code = read(rel);
      expect(code, `${rel} 仍在直接抛 messageKey`).not.toMatch(/result\.error\?\.messageKey\s*(\?\?|\|\|)/);
    }
  });
});

// POST-PROFILE-GATE-001：没有用户名 / 头像不能发动态 —— 给人话 + 去哪补，不露机器码。
describe("profile incomplete", () => {
  it("tells the user to complete avatar and username", () => {
    const text = commandErrorMessage({ errorCode: "PROFILE_INCOMPLETE", messageKey: "localnet.profile_incomplete" }, "fallback");
    expect(text).toContain("头像和用户名");
    expect(text).not.toContain("localnet.");
  });
});
