// MEETUP-SHARE-001: 双人共享地址 + 地图导航纯逻辑管线。
//
// 现状缺口（2026-09-16）：
//   · `ConversationClient.sendMessage` 已支持 `messageType: "LOCATION"`，
//     但 `conversation.tsx` / `messages.tsx` 只渲染 IMAGE/VIDEO/AUDIO ——
//     LOCATION 掉回 raw body，好友收到一串字，不知道是哪里。
//   · 选点页只有单人复制 + Google 打开（LOC-SHARE-001），没有好友对好友的
//     可解析格式、中点、步行耗时、Apple/geo 外链。
//
// 本模块只做纯 TS（无 JSX、无 react-native import，vitest 可直引）：
//   encode（发）/ decode（收）/ 外链 / 中点 / 距离 / 步行耗时 / 列表预览。
// fail-closed：坐标非法一律返回 undefined，调用方按失败态渲染，绝不编坐标。

import { formatLocationTitle, googleMapsUrl, gridToLatLng, metersBetweenPoints, type AnyLocation } from "./components/location-options";

export interface MeetupPoint {
  lat: number;
  lng: number;
  /** 人话标签（地址/地点名）。没有就是没有 —— 不许拿区名冒充。 */
  label?: string | undefined;
}

/** 经纬度合法：有限数 + lat ±90 + lng ±180。 */
export function isValidLatLng(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// 小数位数：发出去统一 5 位（约 1 米），收回来按数值比，不按字符串比。
function fmt(n: number): string {
  return n.toFixed(5);
}

/**
 * 编一条发给好友的位置文本。
 * 格式：有标签 `label\nlat,lng`，无标签 `lat,lng`。
 * 非法坐标返回 undefined（调用方弹错，不发）。
 */
export function encodeMeetupLocation(point: MeetupPoint): string | undefined {
  if (!isValidLatLng(point.lat, point.lng)) return undefined;
  const coord = `${fmt(point.lat)},${fmt(point.lng)}`;
  const label = point.label?.trim();
  if (label && label.length > 0) return `${label}\n${coord}`;
  return coord;
}

// 文本里找坐标：支持 `lat,lng` 裸写、google `?q=lat,lng`、apple `?q=lat,lng`、
// `geo:lat,lng`。多组取最后一组（用户粘贴的正文在前，坐标在后）。
const COORD_RE = /(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/g;
const COORD_TEST = /-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?/;

export interface DecodedMeetup {
  lat: number;
  lng: number;
  /** 首行非坐标文本（URL 行不算）。没有就是没有。 */
  label?: string | undefined;
}

/**
 * 解析好友发来的位置文本。解不出返回 undefined（渲染原文，不猜）。
 * label 只取首行：多行正文不拼，避免把聊天记录当地址。
 */
export function decodeMeetupLocation(body: string): DecodedMeetup | undefined {
  const text = body?.trim();
  if (!text) return undefined;
  const matches = [...text.matchAll(COORD_RE)];
  if (matches.length === 0) return undefined;
  const last = matches[matches.length - 1]!;
  const lat = Number(last[1]);
  const lng = Number(last[2]);
  if (!isValidLatLng(lat, lng)) return undefined;
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  const isUrlLine = /^https?:\/\/|^geo:/i.test(firstLine);
  const isCoordLine = COORD_TEST.test(firstLine);
  if (!firstLine || isUrlLine || isCoordLine) return { lat, lng };
  return { lat, lng, label: firstLine.slice(0, 48) };
}

/**
 * 三端外链。Google（已装 App 接住、没装进网页）、Apple（iOS 直达地图）、
 * geo:（Android chooser）。非法坐标返回 undefined。
 */
export function meetupMapsUrls(point: MeetupPoint): { google: string; apple: string; geo: string } | undefined {
  if (!isValidLatLng(point.lat, point.lng)) return undefined;
  const q = `${point.lat},${point.lng}`;
  const labelSuffix = point.label?.trim() ? `(${encodeURIComponent(point.label.trim().slice(0, 48))})` : "";
  return {
    google: googleMapsUrl(point.lat, point.lng),
    apple: `https://maps.apple.com/?q=${q}`,
    geo: `geo:${q}?q=${q}${labelSuffix}`,
  };
}

/** 两人中点：算术平均（城市级 <100km 足够，文档写明，不装球面插值）。 */
export function meetupMidpoint(a: MeetupPoint, b: MeetupPoint): MeetupPoint | undefined {
  if (!isValidLatLng(a.lat, a.lng) || !isValidLatLng(b.lat, b.lng)) return undefined;
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

/** 两人距离（米）。非法返回 undefined。 */
export function meetupDistanceMeters(a: MeetupPoint, b: MeetupPoint): number | undefined {
  if (!isValidLatLng(a.lat, a.lng) || !isValidLatLng(b.lat, b.lng)) return undefined;
  return metersBetweenPoints({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
}

// 步行 5km/h ≈ 83.33 米/分钟。
const WALK_METERS_PER_MIN = 5000 / 60;

/** 步行耗时（分钟，向上取整，至少 1）。<50 米算“很近”返回 1。 */
export function walkMinutesFor(distanceMeters: number): number | undefined {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return undefined;
  if (distanceMeters < 50) return 1;
  return Math.max(1, Math.ceil(distanceMeters / WALK_METERS_PER_MIN));
}

export interface MeetupSummary {
  midpoint: MeetupPoint;
  distanceMeters: number;
  walkMinutes: number;
}

/** 双人见面小结：中点 + 相距 + 步行耗时。任一非法返回 undefined。 */
export function meetupSummary(a: MeetupPoint, b: MeetupPoint): MeetupSummary | undefined {
  const midpoint = meetupMidpoint(a, b);
  const distanceMeters = meetupDistanceMeters(a, b);
  if (!midpoint || distanceMeters === undefined) return undefined;
  const walkMinutes = walkMinutesFor(distanceMeters);
  if (walkMinutes === undefined) return undefined;
  return { midpoint, distanceMeters, walkMinutes };
}

/**
 * 会话列表预览：能解出坐标才返回 `[位置]`（带短标签），解不出返回 undefined
 * —— 调用方回落原文。补 `messages.tsx:1021` 只有 IMAGE/VIDEO 分支的缺口。
 */
export function meetupPreview(body: string): string | undefined {
  const decoded = decodeMeetupLocation(body);
  if (!decoded) return undefined;
  if (decoded.label) return `[位置] ${decoded.label}`;
  return "[位置]";
}

/**
 * 选点页结果 → 可发送的碰头点（供会话“📍 位置”入口复用 LocationPickerSheet）。
 *   · CUSTOM：优先真实 lat/lng；老数据只有网格时按同城网格换算（用户自己放的点，
 *     不是编的）；都拿不到返回 undefined。
 *   · DEVICE：设备真值。
 *   · PRESET：无坐标，返回 undefined —— 调用方提示用户用“地图选点”定点再发，
 *     不拿城市中心冒充。
 * label 走 formatLocationTitle（与选点页显示同一口径）。
 */
export function meetupPointFromLocation(location: AnyLocation): MeetupPoint | undefined {
  if (location.kind === "DEVICE") {
    if (!isValidLatLng(location.device.lat, location.device.lng)) return undefined;
    const label = formatLocationTitle(location).trim();
    return {
      lat: location.device.lat,
      lng: location.device.lng,
      ...(label ? { label } : {}),
    };
  }
  if (location.kind === "CUSTOM") {
    const custom = location.custom;
    const label = formatLocationTitle(location).trim() || undefined;
    if (
      typeof custom.lat === "number" &&
      typeof custom.lng === "number" &&
      isValidLatLng(custom.lat, custom.lng)
    ) {
      return { lat: custom.lat, lng: custom.lng, ...(label ? { label } : {}) };
    }
    const grid = gridToLatLng(location.city, custom.gridX, custom.gridY);
    if (!isValidLatLng(grid.lat, grid.lng)) return undefined;
    return { lat: grid.lat, lng: grid.lng, ...(label ? { label } : {}) };
  }
  return undefined;
}
