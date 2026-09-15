// DEVICE-LOCATION-001: 把真的 expo-location 适配成 DeviceLocationApi。
//
// 纯逻辑在 device-location.ts（可单测、不碰 native runtime），这里只做适配。
// 测试从不 import 本文件。
//
// 注意：本文件**不是**全仓唯一 import expo-location 的地方 —— market.tsx /
// reality-scene-map.tsx / map-canvas.tsx 各自也 import 了，但它们都是按钮触发
// 的一次性 getCurrentPositionAsync，不做移动订阅，所以走不到这条链路上。
import * as Location from "expo-location";
import type { DeviceLocationApi, DeviceLocationAddress } from "./device-location";

export const expoLocationApi: DeviceLocationApi = {
  async getForegroundPermissionsAsync() {
    const result = await Location.getForegroundPermissionsAsync();
    return { granted: result.granted, canAskAgain: result.canAskAgain };
  },
  async requestForegroundPermissionsAsync() {
    const result = await Location.requestForegroundPermissionsAsync();
    return { granted: result.granted, canAskAgain: result.canAskAgain };
  },
  watchPositionAsync(options, callback) {
    return Location.watchPositionAsync(
      {
        accuracy: options.accuracy as Location.LocationAccuracy,
        timeInterval: options.timeInterval,
        distanceInterval: options.distanceInterval,
      },
      // expo 回调给的是 LocationObject（坐标在 .coords 里），
      // 这里抹平成 DeviceLocationFix，别把 native 的形状漏到业务层。
      (loc) => callback({ latitude: loc.coords.latitude, longitude: loc.coords.longitude }),
    );
  },
  async reverseGeocodeAsync(fix) {
    return (await Location.reverseGeocodeAsync(fix)) as DeviceLocationAddress[];
  },
};
