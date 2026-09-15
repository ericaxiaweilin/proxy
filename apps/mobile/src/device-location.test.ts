// DEVICE-LOCATION-001 tripwires：位置要跟着人走。
//
// 用户报告：「我移动几公里，app 没有刷新位置信息」。根因不是"刷新失败" ——
// 是从来没接设备定位：app-shell 只在挂载时从 SecureStore 读一次，之后无论走
// 到哪都不再更新。expo-location 早就在 package.json 里却一次都没用过。
//
// 这里测的是 device-location.ts（纯逻辑，注入 DeviceLocationApi）。
// 真正的 expo-location 适配器 device-location-native.ts 不进测试 ——
// 它 import native module，vitest 里没有 runtime。
//
// 每一态都要能被测出来并区分开：没授权 / 定位中 / 跟随中 / 不可用。
// 失败态绝不允许长得像成功 —— 这是全仓一贯口径。
import { describe, expect, it } from "vitest";
import {
  COARSE_ACCURACY,
  DEFAULT_DISTANCE_METERS,
  DEFAULT_INTERVAL_MS,
  formatDeviceAddress,
  startDeviceLocationWatch,
  type DeviceLocationAddress,
  type DeviceLocationApi,
  type DeviceLocationFix,
  type DeviceLocationState,
  type StartDeviceLocationOptions
} from "./device-location";

interface FakeLocation extends DeviceLocationApi {
  emit(fix: DeviceLocationFix): void;
  watchCalls: Array<{ accuracy: number; timeInterval: number; distanceInterval: number }>;
  removed: number;
  permissionChecks: number;
  permissionRequests: number;
}

function makeFake(opts?: {
  granted?: boolean;
  canAskAgain?: boolean;
  requestGrants?: boolean;
  watchFails?: string;
  reverseFails?: boolean;
  reverseRows?: DeviceLocationAddress[];
}): FakeLocation {
  const cfg = {
    granted: true,
    canAskAgain: true,
    requestGrants: true,
    watchFails: undefined as string | undefined,
    reverseFails: false,
    reverseRows: [{ city: "河内", district: "还剑湖", formattedAddress: "Hoàn Kiếm, Hà Nội" }] as DeviceLocationAddress[],
    ...opts
  };
  let cb: ((fix: DeviceLocationFix) => void) | undefined;
  const fake: FakeLocation = {
    emit: (fix) => cb?.(fix),
    watchCalls: [] as Array<{ accuracy: number; timeInterval: number; distanceInterval: number }>,
    removed: 0,
    permissionChecks: 0,
    permissionRequests: 0,
    async getForegroundPermissionsAsync() {
      fake.permissionChecks += 1;
      return { granted: cfg.granted, canAskAgain: cfg.canAskAgain };
    },
    async requestForegroundPermissionsAsync() {
      fake.permissionRequests += 1;
      return { granted: cfg.requestGrants, canAskAgain: false };
    },
    async watchPositionAsync(options, callback) {
      fake.watchCalls.push(options);
      if (cfg.watchFails !== undefined) throw new Error(cfg.watchFails);
      cb = callback;
      return { remove: () => { fake.removed += 1; } };
    },
    async reverseGeocodeAsync() {
      if (cfg.reverseFails) throw new Error("geocode down");
      return cfg.reverseRows;
    }
  };
  return fake;
}

/** 让 callback 里的 async 反查跑完。 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function collect(
  fake: FakeLocation,
  // 只覆盖默认值之外的项；location / onState 由本助手自己给。
  opts?: Partial<StartDeviceLocationOptions>
): Promise<{ states: DeviceLocationState[]; stop: () => void }> {
  const states: DeviceLocationState[] = [];
  const stop = await startDeviceLocationWatch({
    location: fake,
    onState: (s) => states.push(s),
    ...opts
  });
  return { states, stop };
}

describe("DEVICE-LOCATION-001 startDeviceLocationWatch", () => {
  it("没授权 → permission_denied，一个坐标都不取", async () => {
    // canAskAgain=false = 用户已经拒绝过（iOS 不会再弹）。这时也不许硬弹。
    const fake = makeFake({ granted: false, canAskAgain: false });
    const { states } = await collect(fake);
    expect(states).toEqual([{ kind: "permission_denied" }]);
    expect(fake.permissionRequests).toBe(0);
    // 关键：没授权就不能偷偷订阅 —— 一个 watch 都不许发。
    expect(fake.watchCalls).toHaveLength(0);
  });

  it("问了但用户还是拒绝 → permission_denied，不订阅", async () => {
    const fake = makeFake({ granted: false, canAskAgain: true, requestGrants: false });
    const { states } = await collect(fake);
    expect(fake.permissionRequests).toBe(1);
    expect(states).toEqual([{ kind: "permission_denied" }]);
    expect(fake.watchCalls).toHaveLength(0);
  });

  it("没授权但还能问 → 弹一次系统授权（法规要求的同意 UI 就在这里）", async () => {
    const fake = makeFake({ granted: false, canAskAgain: true, requestGrants: true });
    const { states } = await collect(fake);
    expect(fake.permissionRequests).toBe(1);
    expect(states[0]).toEqual({ kind: "acquiring" });
  });

  it("requestPermissionIfMissing=false 时不主动弹授权", async () => {
    const fake = makeFake({ granted: false, canAskAgain: true });
    const { states } = await collect(fake, { requestPermissionIfMissing: false });
    expect(fake.permissionRequests).toBe(0);
    expect(states).toEqual([{ kind: "permission_denied" }]);
  });

  it("拿到授权 → acquiring，然后每个 fix 都 tracking（这就是'移动几公里会刷新'）", async () => {
    const fake = makeFake();
    const { states } = await collect(fake);
    expect(states[0]).toEqual({ kind: "acquiring" });
    fake.emit({ latitude: 21.0285, longitude: 105.8542 });
    await flush();
    fake.emit({ latitude: 10.776, longitude: 106.701 });
    await flush();
    const tracking = states.filter((s) => s.kind === "tracking");
    expect(tracking).toHaveLength(2);
    // 第二个 fix 必须真的替掉第一个 —— 不是只认第一次（正是用户报的 bug）。
    expect(tracking[0]).toMatchObject({ latitude: 21.0285, longitude: 105.8542 });
    expect(tracking[1]).toMatchObject({ latitude: 10.776, longitude: 106.701, address: "Hoàn Kiếm, Hà Nội" });
  });

  it("默认用低精度 + 1 公里位移阈值（不是高精度，不触发精确定位那条线）", async () => {
    const fake = makeFake();
    await collect(fake);
    expect(fake.watchCalls).toEqual([
      { accuracy: COARSE_ACCURACY, timeInterval: DEFAULT_INTERVAL_MS, distanceInterval: DEFAULT_DISTANCE_METERS }
    ]);
    expect(COARSE_ACCURACY).toBe(2);
    expect(DEFAULT_DISTANCE_METERS).toBe(1000);
  });

  it("反查地址失败 != 定位失败：坐标照发，地址留空", async () => {
    const fake = makeFake({ reverseFails: true });
    const { states } = await collect(fake);
    fake.emit({ latitude: 21.0285, longitude: 105.8542 });
    await flush();
    const last = states[states.length - 1];
    expect(last).toEqual({ kind: "tracking", latitude: 21.0285, longitude: 105.8542 });
    // 地址必须是「没有」，不是空串，更不是拿别的城市冒充。
    expect((last as { address?: string }).address).toBeUndefined();
  });

  it("反查返回空数组 → 没地址但坐标照发", async () => {
    const fake = makeFake({ reverseRows: [] });
    const { states } = await collect(fake);
    fake.emit({ latitude: 1.5, longitude: 2.5 });
    await flush();
    expect(states[states.length - 1]).toEqual({ kind: "tracking", latitude: 1.5, longitude: 2.5 });
  });

  it("订阅失败 → unavailable 并带原因（不许静默成成功）", async () => {
    const fake = makeFake({ watchFails: "location services off" });
    const { states } = await collect(fake);
    expect(states[states.length - 1]).toEqual({ kind: "unavailable", message: "location services off" });
  });

  it("stop() 之后不再回调，且订阅真的被移除", async () => {
    const fake = makeFake();
    const { states, stop } = await collect(fake);
    fake.emit({ latitude: 1, longitude: 2 });
    await flush();
    stop();
    expect(fake.removed).toBe(1);
    const countBefore = states.length;
    fake.emit({ latitude: 3, longitude: 4 });
    await flush();
    expect(states).toHaveLength(countBefore);
    expect(states[states.length - 1]).toEqual({ kind: "idle" });
  });

  it("reverseGeocode=false 时完全不反查（坐标照样给）", async () => {
    const fake = makeFake();
    let geocodeCalls = 0;
    const wrapped: DeviceLocationApi = {
      ...fake,
      async reverseGeocodeAsync(fix) {
        geocodeCalls += 1;
        return fake.reverseGeocodeAsync(fix);
      }
    };
    const states: DeviceLocationState[] = [];
    await startDeviceLocationWatch({ location: wrapped, onState: (s) => states.push(s), reverseGeocode: false });
    fake.emit({ latitude: 9, longitude: 9 });
    await flush();
    expect(geocodeCalls).toBe(0);
    expect(states[states.length - 1]).toEqual({ kind: "tracking", latitude: 9, longitude: 9 });
  });
});

describe("DEVICE-LOCATION-001 formatDeviceAddress", () => {
  it("优先用 formattedAddress", () => {
    expect(formatDeviceAddress({ formattedAddress: "  Hoàn Kiếm, Hà Nội  ", city: "河内" })).toBe("Hoàn Kiếm, Hà Nội");
  });

  it("没有 formattedAddress 时用 city · district · street 拼", () => {
    expect(formatDeviceAddress({ city: "河内", district: "还剑湖", street: "Đinh Tiên Hoàng" })).toBe("河内 · 还剑湖 · Đinh Tiên Hoàng");
  });

  it("拼不出来返回 undefined，不是空串（'没地址' 和 '地址为空' 不许长得一样）", () => {
    expect(formatDeviceAddress(undefined)).toBeUndefined();
    expect(formatDeviceAddress({})).toBeUndefined();
    expect(formatDeviceAddress({ city: "  " })).toBeUndefined();
    expect(formatDeviceAddress({ formattedAddress: "   " })).toBeUndefined();
  });
});
