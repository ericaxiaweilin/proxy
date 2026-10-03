import { describe, expect, it, vi } from "vitest";

import {
  decidePushRegistration,
  loadPushModule,
  normalisePushToken,
  pushPlatformFor,
  registerForPush,
  type PushModule,
} from "./push-registration";

// NOTIF-PUSH-001（客户端半边）：`NotificationClient.registerDevice` 全仓零调用方，
// 所以 `notification.device_tokens` 一直是 0 行 —— 服务端的推送管线再完整也没有目标。
//
// 这一组钉的是「什么情况下才允许注册」和「原生模块缺席时不许把 app 打挂」。

describe("NOTIF-PUSH-001: 设备令牌注册的准入条件", () => {
  const base = {
    os: "ios",
    deviceId: "device_abc",
    permission: "granted" as const,
    token: "1a2b3c4d5e6f",
    signedIn: true,
  };

  it("平台名必须和服务端 PushDispatcher 认的一致", () => {
    expect(pushPlatformFor("ios")).toBe("IOS");
    expect(pushPlatformFor("android")).toBe("ANDROID");
    expect(pushPlatformFor("IOS")).toBe("IOS");
    expect(pushPlatformFor(" android ")).toBe("ANDROID");
  });

  it("认不出的平台不猜 —— 猜一个会让服务端每次推送都为它白跑一趟", () => {
    // 服务端 senderFor 的 default 分支也是返回 nil（不猜），两边必须一致。
    for (const os of ["web", "macos", "windows", "", "tvos"]) {
      expect(pushPlatformFor(os), `${os} 不该被映射成某个平台`).toBeNull();
    }
  });

  it("iOS 那种 <1a2b 3c4d> 的 debug 形式会被归一化", () => {
    // 原样上传 = 把带空格的十六进制当令牌发给 Apple = BadDeviceToken。
    expect(normalisePushToken("<1a2b 3c4d 5e6f>")).toBe("1a2b3c4d5e6f");
    expect(normalisePushToken(" 1a2b \n")).toBe("1a2b");
  });

  it("授权齐全时给出注册决定，且令牌是归一化后的", () => {
    const decision = decidePushRegistration({ ...base, token: "<1a2b 3c4d>" });
    expect(decision).toEqual({
      kind: "register",
      deviceId: "device_abc",
      platform: "IOS",
      token: "1a2b3c4d",
    });
  });

  it("未登录不注册 —— 令牌属于谁都说不清，而 user_account_id 是唯一的寻址依据", () => {
    const decision = decidePushRegistration({ ...base, signedIn: false });
    expect(decision).toEqual({ kind: "skip", reason: "not-signed-in" });
  });

  it("没授权不注册 —— 注册了也推不到，只会多一行永远失败的记录", () => {
    for (const permission of ["denied", "undetermined"] as const) {
      const decision = decidePushRegistration({ ...base, permission });
      expect(decision).toEqual({ kind: "skip", reason: `permission-${permission}` });
    }
  });

  it("空令牌**绝不**注册 —— 那会让服务端以为有设备可推，于是每条通知都推一次、每次都失败", () => {
    for (const token of ["", "   ", "<>", "\n"]) {
      const decision = decidePushRegistration({ ...base, token });
      expect(decision, `token=${JSON.stringify(token)} 必须被跳过`).toEqual({
        kind: "skip",
        reason: "missing-token",
      });
    }
  });

  it("没有 deviceId 不注册 —— 服务端靠 (user, device) 做 upsert 去重", () => {
    const decision = decidePushRegistration({ ...base, deviceId: "  " });
    expect(decision).toEqual({ kind: "skip", reason: "missing-device-id" });
  });
});

function fakeModule(overrides: Partial<PushModule> = {}): PushModule {
  return {
    getPermissionsAsync: async () => ({ status: "granted", granted: true }),
    requestPermissionsAsync: async () => ({ status: "granted", granted: true }),
    getDevicePushTokenAsync: async () => ({ type: "ios", data: "<1a2b 3c4d>" }),
    ...overrides,
  };
}

describe("NOTIF-PUSH-001: 原生模块缺席时必须降级，不能把 app 打挂", () => {
  it("模块加载失败 = 跳过，不是抛异常", async () => {
    const client = { registerDevice: vi.fn() };
    const outcome = await registerForPush({
      client,
      os: "ios",
      deviceId: "device_abc",
      signedIn: true,
      loadModule: async () => null,
    });
    expect(outcome).toEqual({ status: "skipped", reason: "push-module-unavailable" });
    // 模块都没有就绝不该去调命令 —— 那会给服务端写一行推不到的死令牌。
    expect(client.registerDevice).not.toHaveBeenCalled();
  });

  it("授权齐全时真的把令牌交上去", async () => {
    const client = { registerDevice: vi.fn().mockResolvedValue(undefined) };
    const outcome = await registerForPush({
      client,
      os: "ios",
      deviceId: "device_abc",
      signedIn: true,
      loadModule: async () => fakeModule(),
    });
    expect(outcome).toEqual({ status: "registered", platform: "IOS" });
    expect(client.registerDevice).toHaveBeenCalledWith({
      deviceId: "device_abc",
      platform: "IOS",
      token: "1a2b3c4d",
    });
  });

  it("没有权限时**不弹窗**、不取令牌、不注册", async () => {
    // 启动时静默弹一个系统权限框是最招人烦的做法；弹窗要由用户动作触发。
    const requestPermissionsAsync = vi.fn();
    const getDevicePushTokenAsync = vi.fn();
    const client = { registerDevice: vi.fn() };
    const outcome = await registerForPush({
      client,
      os: "ios",
      deviceId: "device_abc",
      signedIn: true,
      loadModule: async () =>
        fakeModule({
          getPermissionsAsync: async () => ({ status: "undetermined" }),
          requestPermissionsAsync,
          getDevicePushTokenAsync,
        }),
    });
    expect(outcome).toEqual({ status: "skipped", reason: "permission-undetermined" });
    expect(requestPermissionsAsync).not.toHaveBeenCalled();
    expect(getDevicePushTokenAsync).not.toHaveBeenCalled();
    expect(client.registerDevice).not.toHaveBeenCalled();
  });

  it("取令牌失败是 failed，不是抛出去", async () => {
    const client = { registerDevice: vi.fn() };
    const outcome = await registerForPush({
      client,
      os: "ios",
      deviceId: "device_abc",
      signedIn: true,
      loadModule: async () =>
        fakeModule({
          getDevicePushTokenAsync: async () => {
            throw new Error("no APNs environment");
          },
        }),
    });
    expect(outcome).toEqual({ status: "failed", reason: "no APNs environment" });
    expect(client.registerDevice).not.toHaveBeenCalled();
  });

  it("命令被服务端拒了是 failed，启动流程不许因此中断", async () => {
    const client = { registerDevice: vi.fn().mockRejectedValue(new Error("notifications require a real sign-in")) };
    const outcome = await registerForPush({
      client,
      os: "ios",
      deviceId: "device_abc",
      signedIn: true,
      loadModule: async () => fakeModule(),
    });
    expect(outcome.status).toBe("failed");
    expect(client.registerDevice).toHaveBeenCalledTimes(1);
  });

  it("Android 走 FCM 分支，平台名不能写成 IOS", async () => {
    const client = { registerDevice: vi.fn().mockResolvedValue(undefined) };
    await registerForPush({
      client,
      os: "android",
      deviceId: "device_abc",
      signedIn: true,
      loadModule: async () =>
        fakeModule({
          getDevicePushTokenAsync: async () => ({ type: "android", data: "fcm_token_xyz" }),
        }),
    });
    expect(client.registerDevice).toHaveBeenCalledWith({
      deviceId: "device_abc",
      platform: "ANDROID",
      token: "fcm_token_xyz",
    });
  });

  it("web 平台不注册（服务端没有 web 发送器）", async () => {
    const client = { registerDevice: vi.fn() };
    const outcome = await registerForPush({
      client,
      os: "web",
      deviceId: "device_abc",
      signedIn: true,
      loadModule: async () => fakeModule(),
    });
    expect(outcome).toEqual({ status: "skipped", reason: "unsupported-platform" });
    expect(client.registerDevice).not.toHaveBeenCalled();
  });
});

// NOTIF-PUSH-NATIVE-GUARD-001（2026-10-02，用户在模拟器上连报两次红屏）：
// 「原生模块没进二进制就降级」这条降级自己把 app 打挂了 —— JS 侧探不到它在不在：
// try/catch 拦不住 Metro 的 fatal error，RN 的 TurboModuleRegistry 对 Expo 模块是
// 假阳性。所以入口改由**构建期开关**把关。这条钉的是「真的没去 import」，不是
// 「import 失败后返回 null」—— 后者两种写法都能过，抓不出这次的红屏。
const pushModuleImport = vi.hoisted(() => ({ attempts: 0 }));
vi.mock("expo-notifications", () => {
  pushModuleImport.attempts += 1;
  return {};
});

describe("NOTIF-PUSH-NATIVE-GUARD-001: 二进制没重建时绝不 import 原生推送模块", () => {
  it("开关没设 = null，而且一次都没碰那个模块", async () => {
    const previous = process.env.EXPO_PUBLIC_PUSH;
    delete process.env.EXPO_PUBLIC_PUSH;
    await expect(loadPushModule()).resolves.toBeNull();
    expect(pushModuleImport.attempts).toBe(0);
    if (previous !== undefined) process.env.EXPO_PUBLIC_PUSH = previous;
  });
});
