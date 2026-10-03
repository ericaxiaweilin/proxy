/**
 * NOTIF-PUSH-001（客户端半边）：把「这台设备」变成服务端能推的目标。
 *
 * 服务端那半边已经齐了 —— `notification.PushDispatcher` 会按收件人取
 * `notification.device_tokens` 里 status='ACTIVE' 的行，再按 Platform 路由到
 * APNs / FCM。但那张表**一直是 0 行**：`NotificationClient.registerDevice`
 * 全仓零调用方。所以推送不是「没写发送代码」，是**根本没有目标**。
 *
 * 这个文件补的就是那一跳，并且把判断逻辑和原生模块**分开**：
 *  - 本文件（纯逻辑）不 import 任何原生模块，可以在 vitest 里直接跑；
 *  - 原生接触点收在 loadPushModule() 一个函数里，见下面的注释。
 *
 * 用的是 getDevicePushTokenAsync()（APNs / FCM 的**原生**令牌），不是 Expo
 * 的 push token —— 服务端直接和 Apple / Google 说话，中间不该再插一层。
 */

/** 服务端 PushDispatcher.senderFor 只认这两个值（大小写不敏感）。 */
export type PushPlatform = "IOS" | "ANDROID";

export type PushPermission = "granted" | "denied" | "undetermined";

export type PushRegistrationDecision =
  | { kind: "register"; deviceId: string; platform: PushPlatform; token: string }
  | { kind: "skip"; reason: string };

/**
 * Platform.OS → 服务端认的平台名。
 *
 * 认不出来时返回 null 而不是猜一个：猜 IOS 会把一个 web/macos 的令牌塞进
 * device_tokens，然后每次推送都为它白跑一趟 APNs 并拿到一个看不懂的 400。
 * 服务端那一侧同一条规矩（未知平台不猜），两边必须一致。
 */
export function pushPlatformFor(os: string): PushPlatform | null {
  const value = (os ?? "").trim().toLowerCase();
  if (value === "ios") return "IOS";
  if (value === "android") return "ANDROID";
  return null;
}

/**
 * 归一化令牌文本。
 *
 * iOS 的 `getDevicePushTokenAsync()` 在部分路径上会把 APNs 令牌给成
 * `<1a2b 3c4d …>` 这种带尖括号和空格的 debug 形式 —— 原样上传，服务端就会把
 * 这串「带空格的十六进制」当令牌发给 Apple，换来一个 BadDeviceToken。
 * 尖括号和空白都不是 APNs / FCM 令牌的合法字符，去掉是安全的。
 */
export function normalisePushToken(raw: string): string {
  return (raw ?? "").replace(/[\s<>]/g, "");
}

export function decidePushRegistration(input: {
  os: string;
  deviceId: string;
  permission: PushPermission;
  token: string;
  signedIn: boolean;
}): PushRegistrationDecision {
  // 没登录就没有收件人。注册上去的令牌属于**谁**都说不清，
  // 而 device_tokens.user_account_id 是推送唯一的寻址依据。
  if (!input.signedIn) return { kind: "skip", reason: "not-signed-in" };

  const platform = pushPlatformFor(input.os);
  if (!platform) return { kind: "skip", reason: "unsupported-platform" };

  // 没授权就不注册：注册了也推不到，只会让 device_tokens 里多一行永远失败的
  // 记录。用户之后在系统设置里打开通知，下次启动会重新走到这里。
  if (input.permission !== "granted") return { kind: "skip", reason: `permission-${input.permission}` };

  const deviceId = (input.deviceId ?? "").trim();
  if (!deviceId) return { kind: "skip", reason: "missing-device-id" };

  // 空令牌是**最坏**的一种：它会让服务端认为「这个用户有设备可推」，
  // 于是每一条通知都去推一次、每次都失败。宁可不注册。
  const token = normalisePushToken(input.token);
  if (!token) return { kind: "skip", reason: "missing-token" };

  return { kind: "register", deviceId, platform, token };
}

/** expo-notifications 里我们真正用到的那几个方法（其余一概不碰）。 */
export type PushModule = {
  getPermissionsAsync(): Promise<{ status?: string; granted?: boolean }>;
  requestPermissionsAsync(): Promise<{ status?: string; granted?: boolean }>;
  getDevicePushTokenAsync(): Promise<{ type?: string; data?: unknown }>;
};

/**
 * 原生模块的**唯一**接触点。
 *
 * 为什么用动态 import + try/catch，而不是顶层 `import`：
 * 原生模块是编译进二进制里的，而 JS 是 Metro 热更推上去的。只要二进制还没
 * 重建，`expo-notifications` 在运行时就不存在 —— 顶层 import 会让**整个 app**
 * 在启动时崩掉，而不只是「推送暂时用不了」。这里降级成 null，让「还没重建」
 * 的表现是「收不到推送、app 照常能用」，而不是白屏。
 *
 * ⚠️ 「二进制里到底有没有这个原生模块」在 JS 侧**没有**可靠的探测办法，两次红屏
 * 都是从这里来的（2026-10-02，iOS 模拟器，`ios/Pods/ExpoNotifications` 不存在）：
 *   ① 只靠 try/catch —— 模块顶层的 require 抛的是 Metro 的 fatal error，
 *     它不走调用方的 try/catch，红屏照弹，降级形同没写；
 *   ② 改用 RN 的 TurboModuleRegistry.get 去探 —— Expo 的模块不在那张注册表里，
 *     探出来是**假阳性的"有"**，真 import 时炸在 `new NativeEventEmitter(null)`。
 * 所以这里不猜：由**构建期**说清楚。`pod install` + 重建 dev client 之后把
 * `EXPO_PUBLIC_PUSH=1` 设上，那条路才真的能 import 到原生模块。
 */
export async function loadPushModule(): Promise<PushModule | null> {
  if (process.env.EXPO_PUBLIC_PUSH !== "1") return null;
  try {
    const mod = (await import("expo-notifications")) as unknown as PushModule;
    return mod ?? null;
  } catch {
    return null;
  }
}

export type PushRegistrationOutcome =
  | { status: "registered"; platform: PushPlatform }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

function permissionFrom(settings: { status?: string; granted?: boolean } | undefined): PushPermission {
  if (settings?.granted === true) return "granted";
  if (settings?.status === "granted") return "granted";
  if (settings?.status === "denied") return "denied";
  return "undetermined";
}

/**
 * 走完整条注册链路，**永不抛**。
 *
 * 调用方是启动流程：为了一个「可选能力」把启动打挂是最不划算的失败方式。
 * 所有失败都变成 outcome.reason，调用方按需记日志。
 *
 * ⚠️ 不要在未授权时主动 requestPermissions —— 弹窗要由**用户动作**触发
 * （比如他打开通知中心），启动时静默弹一个系统权限框是最招人烦的做法。
 * 这里只在已经 granted 时取令牌；拿不到就跳过，等下一次。
 */
export async function registerForPush(input: {
  client: { registerDevice(i: { deviceId: string; platform: string; token: string }): Promise<void> };
  os: string;
  deviceId: string;
  signedIn: boolean;
  loadModule?: () => Promise<PushModule | null>;
}): Promise<PushRegistrationOutcome> {
  const load = input.loadModule ?? loadPushModule;
  const module = await load();
  if (!module) return { status: "skipped", reason: "push-module-unavailable" };

  let permission: PushPermission = "undetermined";
  let token = "";
  try {
    permission = permissionFrom(await module.getPermissionsAsync());
    if (permission === "granted") {
      const deviceToken = await module.getDevicePushTokenAsync();
      token = typeof deviceToken?.data === "string" ? deviceToken.data : String(deviceToken?.data ?? "");
    }
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : "push-token-unavailable" };
  }

  const decision = decidePushRegistration({
    os: input.os,
    deviceId: input.deviceId,
    permission,
    token,
    signedIn: input.signedIn,
  });
  if (decision.kind === "skip") return { status: "skipped", reason: decision.reason };

  try {
    await input.client.registerDevice({ deviceId: decision.deviceId, platform: decision.platform, token: decision.token });
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : "register-device-failed" };
  }
  return { status: "registered", platform: decision.platform };
}
