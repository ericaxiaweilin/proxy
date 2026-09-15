// DEVICE-LOCATION-001: 位置不会跟着人走。
//
// 「当前位置」以前只有两个来源，而且**都是静态的**：预设地点，或用户在地图上
// 自己放的点（components/location-store.ts 持久化）。app-shell 只在挂载时读一次
// （:317-326），之后无论走到哪都不再更新 —— 不是「刷新失败」，是从来没接设备定位。
//
// 现成方案：expo-location 早就在 package.json 里（^57），但既有的三处用法
// （market.tsx / reality-scene-map.tsx / map-canvas.tsx）全都是**按钮点一下取一次**
// 的 getCurrentPositionAsync —— 取完就完，不订阅移动。所以「移动几公里不刷新」
// 不是刷新失败，是压根没人听设备的移动事件。
// 这里用 watchPositionAsync —— 设备移动时持续回调，正对这个问题。
//
// 精度口径（重要）：这**不是**高精度定位。要的是「城市/区域级别跟着人走」，
// 所以默认 Accuracy.Low（约公里级）配合 distanceInterval 1000m —— 走约 1 公里才
// 回调一次。省电，也不会触发 Apple 对精确定位的额外审查。
// 真正的高精度（PRECISE_GPS）走 location-consent-client.ts 那套服务端同意，
// 是另一条线，本模块不碰。
//
// 同意：OS 的「使用 App 期间」授权弹窗本身就是法规要求的同意 UI
// （app.json 的 NSLocationWhenInUseUsageDescription）。本模块只认 OS 授权，
// 没拿到就如实报 permission_denied —— 不静默、不拿旧坐标假装。
//
// 为什么注入而不是直接 import：expo-location 是 native module，vitest 没有 native
// runtime。把 API 当参数传进来，测试用假的就能完整驱动 —— 跟 location-consent-client.ts
// 是同一个「纯 TS、可单测」的取向。真正的 expo-location 在 device-location-native.ts。

export interface DeviceLocationFix {
  latitude: number;
  longitude: number;
}

export interface DeviceLocationPermission {
  granted: boolean;
  canAskAgain: boolean;
}

export interface DeviceLocationAddress {
  city?: string | null;
  district?: string | null;
  street?: string | null;
  name?: string | null;
  formattedAddress?: string | null;
}

export interface DeviceLocationApi {
  getForegroundPermissionsAsync(): Promise<DeviceLocationPermission>;
  requestForegroundPermissionsAsync(): Promise<DeviceLocationPermission>;
  watchPositionAsync(
    options: { accuracy: number; timeInterval: number; distanceInterval: number },
    callback: (fix: DeviceLocationFix) => void,
  ): Promise<{ remove: () => void }>;
  reverseGeocodeAsync(fix: DeviceLocationFix): Promise<DeviceLocationAddress[]>;
  getLastKnownPositionAsync(): Promise<DeviceLocationFix | undefined>;
  getCurrentPositionAsync(options: { accuracy: number }): Promise<DeviceLocationFix>;
}

// 三态之外的每一态都要能被 UI 区分开 —— 「没授权」「正在定位」「定位不可用」
// 和「拿到了坐标」不许长得一样（失败不能冒充成功，见全仓一贯口径）。
export type DeviceLocationState =
  | { kind: "idle" }
  | { kind: "permission_denied" }
  | { kind: "acquiring" }
  | { kind: "tracking"; latitude: number; longitude: number; address?: string }
  | { kind: "unavailable"; message: string };

// Location.Accuracy.Low —— 约公里级。对「移动几公里要刷新」足够，
// 且不给用户要不必要的精度。
export const COARSE_ACCURACY = 2;
// 走约 1 公里才回调一次：既对得上「移动几公里」的诉求，又不至于频繁唤醒。
export const DEFAULT_DISTANCE_METERS = 1000;
// 最快 1 分钟一次，配合 distanceInterval 双闸。
export const DEFAULT_INTERVAL_MS = 60_000;

export interface StartDeviceLocationOptions {
  location: DeviceLocationApi;
  onState: (state: DeviceLocationState) => void;
  accuracy?: number;
  distanceMeters?: number;
  intervalMs?: number;
  /** 反查地址（城市/区域）。失败不影响坐标，见下方说明。 */
  reverseGeocode?: boolean;
  /** 没授权时是否弹系统授权框。 */
  requestPermissionIfMissing?: boolean;
}

/** 把反查结果拼成人能读的一行；拼不出来返回 undefined（不是空串）。 */
export function formatDeviceAddress(row: DeviceLocationAddress | undefined): string | undefined {
  if (!row) return undefined;
  if (row.formattedAddress && row.formattedAddress.trim()) return row.formattedAddress.trim();
  const parts = [row.city, row.district, row.street].filter((p): p is string => Boolean(p && p.trim()));
  if (parts.length === 0) return undefined;
  return parts.join(" · ");
}

/**
 * 订阅设备位置。返回 stop()：调用后立刻停止订阅、不再回调。
 *
 * 诚实约定：
 *   · 没拿到 OS 授权 → permission_denied，一个坐标都不取；
 *   · 订阅失败 → unavailable，并带上原因；
 *   · 反查地址失败**不等于**定位失败 —— 坐标照发，地址留空（地址是锦上添花）。
 */
export async function startDeviceLocationWatch(opts: StartDeviceLocationOptions): Promise<() => void> {
  const {
    location,
    onState,
    accuracy = COARSE_ACCURACY,
    distanceMeters = DEFAULT_DISTANCE_METERS,
    intervalMs = DEFAULT_INTERVAL_MS,
    reverseGeocode = true,
    requestPermissionIfMissing = true,
  } = opts;

  let permission = await location.getForegroundPermissionsAsync();
  if (!permission.granted && requestPermissionIfMissing && permission.canAskAgain) {
    permission = await location.requestForegroundPermissionsAsync();
  }
  if (!permission.granted) {
    onState({ kind: "permission_denied" });
    return () => undefined;
  }

  let stopped = false;
  onState({ kind: "acquiring" });

  let subscription: { remove: () => void } | undefined;
  try {
    subscription = await location.watchPositionAsync(
      { accuracy, timeInterval: intervalMs, distanceInterval: distanceMeters },
      (fix) => {
        if (stopped) return;
        void (async () => {
          let address: string | undefined;
          if (reverseGeocode) {
            try {
              const rows = await location.reverseGeocodeAsync(fix);
              address = formatDeviceAddress(rows[0]);
            } catch {
              // 反查失败不该把坐标一起丢掉 —— 地址留空，照常 tracking。
              address = undefined;
            }
          }
          if (stopped) return;
          onState({
            kind: "tracking",
            latitude: fix.latitude,
            longitude: fix.longitude,
            ...(address ? { address } : {}),
          });
        })();
      },
    );
  } catch (error) {
    onState({
      kind: "unavailable",
      message: error instanceof Error ? error.message : "定位不可用",
    });
    return () => undefined;
  }

  // 订阅还没 resolve 时 stop() 已经被调用了。
  if (stopped) {
    subscription.remove();
    return () => undefined;
  }

  return () => {
    stopped = true;
    subscription?.remove();
    onState({ kind: "idle" });
  };
}

export interface CurrentFixOptions {
  /** 没授权时是否弹系统授权框。默认 false —— 打开 App 就调，不能每次冷启动都弹。 */
  requestPermission?: boolean;
  /** 超时毫秒。默认 10 秒（地图"定位"按钮同口径）。 */
  timeoutMs?: number;
  /** 反查地址。默认 true；失败不影响坐标。 */
  reverseGeocode?: boolean;
}

export interface CurrentFix {
  latitude: number;
  longitude: number;
  address?: string;
}

// DEVICE-LOCATION-003: 打开 App 就定一次位 + 地图"定位"按钮，共用这一份。
// 之前两处各写一遍（缓存秒回 → GPS → 10 秒超时），改超时改两处。
// 语义：有缓存 fix 直接用（秒回）；没有才开 GPS，最多等 timeoutMs。
// 返回 undefined = 这次没拿到（没授权/超时/失败），调用方走原有回退，不许编坐标。
export async function getCurrentFix(
  location: DeviceLocationApi,
  options?: CurrentFixOptions
): Promise<CurrentFix | undefined> {
  const { requestPermission = false, timeoutMs = 10_000, reverseGeocode = true } = options ?? {};
  try {
    let permission = await location.getForegroundPermissionsAsync();
    if (!permission.granted && requestPermission && permission.canAskAgain) {
      permission = await location.requestForegroundPermissionsAsync();
    }
    if (!permission.granted) return undefined;
    const cached = await location.getLastKnownPositionAsync().catch(() => undefined);
    const fix =
      cached ??
      (await Promise.race([
        location.getCurrentPositionAsync({ accuracy: COARSE_ACCURACY }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("fix timeout")), timeoutMs)),
      ]).catch(() => undefined));
    if (!fix) return undefined;
    let address: string | undefined;
    if (reverseGeocode) {
      try {
        const rows = await location.reverseGeocodeAsync(fix);
        address = formatDeviceAddress(rows[0]);
      } catch {
        address = undefined;
      }
    }
    return { latitude: fix.latitude, longitude: fix.longitude, ...(address ? { address } : {}) };
  } catch {
    return undefined;
  }
}
