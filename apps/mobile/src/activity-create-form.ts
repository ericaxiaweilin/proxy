// ACTIVITY-CREATE-FORM-001: 十块渐进式创建表单的纯逻辑（原型 deepseek_html_20260928_34cc3e）。
//
// tsx 组件 import 不进 vitest（react-native），所以状态机、时间拼装、
// 草稿编解码、目录解析全放这里 —— 薄 tsx 只负责渲染。服务端映射口径
// 沿用 activity-moments.buildActivityPublishInput（capacity 取上沿、
// AA/自定义→SPLIT + 金额进 desc），这里只产出 specs。

export type CreateCategoryId =
  | "cafe" | "food" | "drink" | "sport" | "walk" | "art" | "photo" | "music";

export const CREATE_CATEGORIES: ReadonlyArray<{ id: CreateCategoryId; emoji: string }> = [
  { id: "cafe", emoji: "☕" },
  { id: "food", emoji: "🍜" },
  { id: "drink", emoji: "🍻" },
  { id: "sport", emoji: "🏸" },
  { id: "walk", emoji: "🚶" },
  { id: "art", emoji: "🎨" },
  { id: "photo", emoji: "📷" },
  { id: "music", emoji: "🎵" },
];

export type CreateSignupId = "OPEN" | "REVIEW" | "INVITE_ONLY";
export type CreateFeeId = "FREE" | "AA" | "CUSTOM";
export type CreateDuration = 60 | 120 | 240 | "all";

export interface CreateFormState {
  cat: CreateCategoryId | undefined;
  name: string;
  peopleMin: number;
  peopleMax: number;
  /** 本地 yyyy-mm-dd。 */
  dateISO: string;
  hour: number;
  minute: 0 | 30;
  duration: CreateDuration;
  /** 目录选中的场景 id；手输文字只做筛选，不直接发布（无 sceneId 的活动在场景页不可见）。 */
  placeId: string | undefined;
  placeName: string;
  signup: CreateSignupId;
  fee: CreateFeeId;
  customFee: string;
  note: string;
}

export const PEOPLE_MIN = 2;
export const PEOPLE_MAX = 50;

export function todayLocalISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map((x) => Number(x));
  const dt = new Date(y || 1970, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  return todayLocalISO(dt);
}

export function weekdayIndexISO(iso: string): number {
  const [y, m, d] = iso.split("-").map((x) => Number(x));
  return new Date(y || 1970, (m || 1) - 1, d || 1).getDay();
}

export function dayOfMonthISO(iso: string): number {
  const d = Number(iso.split("-")[2]);
  return Number.isFinite(d) ? d : 1;
}

export function defaultCreateForm(todayISO: string): CreateFormState {
  return {
    cat: undefined,
    name: "",
    peopleMin: 4,
    peopleMax: 6,
    dateISO: todayISO,
    hour: 14,
    minute: 0,
    duration: 120,
    placeId: undefined,
    placeName: "",
    signup: "OPEN",
    fee: "FREE",
    customFee: "",
    note: "",
  };
}

/** 进度 0..7（原型口径：分类/名称/人数/日期/时间/时长/地点，日期时间恒算）。 */
export function formProgress(state: CreateFormState): number {
  const done = [
    state.cat !== undefined,
    state.name.trim().length > 0,
    true,
    true,
    true,
    state.duration !== undefined,
    state.placeId !== undefined,
  ].filter(Boolean).length;
  return done;
}

export const FORM_PROGRESS_TOTAL = 7;

/**
 * 发布门禁：分类 + 名称 + 目录场景三者齐。比原型多卡 placeId —— 无 sceneId
 * 的活动在场景页不可见（Three Beans 教训），放行等于造不可见数据。
 */
export function canPublishForm(state: CreateFormState): boolean {
  return state.cat !== undefined && state.name.trim().length > 0 && state.placeId !== undefined;
}

export function clampPeople(min: number, max: number): { min: number; max: number } {
  const lo = Math.min(Math.max(Math.round(min), PEOPLE_MIN), PEOPLE_MAX);
  const hi = Math.min(Math.max(Math.round(max), PEOPLE_MIN), PEOPLE_MAX);
  if (lo >= hi) return { min: Math.max(PEOPLE_MIN, hi - 1), max: hi };
  return { min: lo, max: hi };
}

/** 人数标签："4–6" / "20–50+"。 */
export function peopleRangeLabel(min: number, max: number): string {
  return max >= PEOPLE_MAX ? `${min}–${PEOPLE_MAX}+` : `${min}–${max}`;
}

/** 服务端单个 capacity 取区间上沿（与 buildActivityPublishInput 同口径）。 */
export function capacityOfRange(max: number): number {
  return Math.min(Math.max(Math.round(max), PEOPLE_MIN), PEOPLE_MAX);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * 拼 time 串："周日 14:00–16:00" / "周日 全天" / 跨午夜 "周五 22:00–次日02:00"。
 * dayLabel / allDayLabel / nextDayLabel 由调用方按语言传入。
 */
export function composeActivityTime(
  dayLabel: string,
  hour: number,
  minute: number,
  duration: CreateDuration,
  allDayLabel: string,
  nextDayLabel: string,
): string {
  const start = `${pad2(hour)}:${pad2(minute)}`;
  if (duration === "all") return `${dayLabel} ${allDayLabel}`;
  const endMinutes = hour * 60 + minute + duration;
  if (endMinutes >= 24 * 60) {
    const rest = endMinutes - 24 * 60;
    return `${dayLabel} ${start}–${nextDayLabel}${pad2(Math.floor(rest / 60))}:${pad2(rest % 60)}`;
  }
  return `${dayLabel} ${start}–${pad2(Math.floor(endMinutes / 60))}:${pad2(endMinutes % 60)}`;
}

/** 今天 08:00–22:00 的过去整点半点不可选（+15 分钟缓冲），非今天全可选。 */
export function isTimeAvailable(dateISO: string, hour: number, minute: number, now: Date = new Date()): boolean {
  if (dateISO !== todayLocalISO(now)) return true;
  return hour * 60 + minute > now.getHours() * 60 + now.getMinutes() + 15;
}

/** 今天已无可选时间时返回 undefined（调用方禁用今天或提示）。 */
export function nextAvailableTime(
  dateISO: string,
  now: Date = new Date(),
): { hour: number; minute: 0 | 30 } | undefined {
  for (let h = 8; h <= 22; h++) {
    for (const m of [0, 30] as const) {
      if (h === 22 && m === 30) continue;
      if (isTimeAvailable(dateISO, h, m, now)) return { hour: h, minute: m };
    }
  }
  return undefined;
}

/** 创建分类 → 服务端 venueType 回落（选中场景自带 venueType 时优先用那个）。 */
export function venueTypeForCategory(cat: CreateCategoryId): "CAFE" | "RESTAURANT" | "OTHER" {
  if (cat === "cafe") return "CAFE";
  if (cat === "food") return "RESTAURANT";
  return "OTHER";
}

/** 目录 type 自由文本里的 venueType  hints（咖啡→CAFE，餐→RESTAURANT），猜不出返回 undefined。 */
export function venueTypeForSpotType(spotType: string): "CAFE" | "RESTAURANT" | undefined {
  if (spotType.includes("咖啡")) return "CAFE";
  if (spotType.includes("餐")) return "RESTAURANT";
  return undefined;
}

// ---------------------------------------------------------------------------
// 本机草稿。SecureStore 存 JSON（表单小，不超限）。只有"用户点的那一下"才写；
// 发布成功清掉；读到坏数据/过期日期不炸 —— 坏了按无草稿，日期过了回到今天。
// ---------------------------------------------------------------------------

export const DRAFT_VERSION = 1;

export function encodeDraft(state: CreateFormState): string {
  return JSON.stringify({ v: DRAFT_VERSION, state });
}

export function decodeDraft(raw: string | undefined, todayISO: string): CreateFormState | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; state?: unknown };
    if (parsed.v !== DRAFT_VERSION || !parsed.state || typeof parsed.state !== "object") return undefined;
    const s = parsed.state as Partial<Record<keyof CreateFormState, unknown>>;
    const base = defaultCreateForm(todayISO);
    const cat = CREATE_CATEGORIES.some((c) => c.id === s.cat) ? (s.cat as CreateCategoryId) : undefined;
    const people = clampPeople(
      typeof s.peopleMin === "number" ? s.peopleMin : base.peopleMin,
      typeof s.peopleMax === "number" ? s.peopleMax : base.peopleMax,
    );
    const dateISO = typeof s.dateISO === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.dateISO) && s.dateISO >= todayISO
      ? s.dateISO
      : todayISO;
    const hour = typeof s.hour === "number" && s.hour >= 8 && s.hour <= 22 ? Math.floor(s.hour) : 14;
    const minute = s.minute === 30 ? 30 : 0;
    const duration: CreateDuration = s.duration === 60 || s.duration === 120 || s.duration === 240 || s.duration === "all"
      ? s.duration
      : 120;
    return {
      cat,
      name: typeof s.name === "string" ? s.name.slice(0, 24) : "",
      peopleMin: people.min,
      peopleMax: people.max,
      dateISO,
      hour,
      minute,
      duration,
      placeId: typeof s.placeId === "string" && s.placeId !== "" ? s.placeId : undefined,
      placeName: typeof s.placeName === "string" ? s.placeName : "",
      signup: s.signup === "REVIEW" || s.signup === "INVITE_ONLY" ? s.signup : "OPEN",
      fee: s.fee === "AA" || s.fee === "CUSTOM" ? s.fee : "FREE",
      customFee: typeof s.customFee === "string" ? s.customFee : "",
      note: typeof s.note === "string" ? s.note : "",
    };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// 场景目录（GET {base}/v1/reality-scenes，公开免登 —— 与首页 sceneBriefs 同口径）。
// 图片/距离缺了就是缺：无图回落首字母，无坐标不上地图 pin、不算距离。
// ---------------------------------------------------------------------------

export interface SceneSpot {
  id: string;
  name: string;
  type: string;
  category: string;
  area: string;
  imageUrl: string;
  latitude: number;
  longitude: number;
}

export function parseSceneSpots(body: unknown): SceneSpot[] {
  const list = Array.isArray((body as { scenes?: unknown }).scenes)
    ? (body as { scenes: Array<Record<string, unknown>> }).scenes
    : [];
  const out: SceneSpot[] = [];
  for (const s of list) {
    if (!s || typeof s.id !== "string" || typeof s.name !== "string") continue;
    out.push({
      id: s.id,
      name: s.name,
      type: typeof s.type === "string" ? s.type : "",
      category: typeof s.category === "string" ? s.category : "",
      area: typeof s.area === "string" ? s.area : "",
      imageUrl: typeof s.imageUrl === "string" ? s.imageUrl : "",
      latitude: typeof s.latitude === "number" ? s.latitude : NaN,
      longitude: typeof s.longitude === "number" ? s.longitude : NaN,
    });
  }
  return out;
}

export async function loadSceneSpots(
  fetchImpl: (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>,
  baseUrl: string,
): Promise<SceneSpot[]> {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/v1/reality-scenes`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`scene catalog status ${(response as { status?: unknown }).status ?? "?"}`);
  return parseSceneSpots(await response.json());
}

/** 有真实坐标才能上地图 pin。 */
export function spotsWithCoords(spots: ReadonlyArray<SceneSpot>): SceneSpot[] {
  return spots.filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
}

/** pin 字形：type 文本里的 hints，猜不出用 ●（不编）。 */
export function spotGlyph(spot: Pick<SceneSpot, "type">): string {
  if (spot.type.includes("咖啡")) return "☕";
  if (spot.type.includes("餐")) return "🍜";
  if (spot.type.includes("展") || spot.type.includes("艺术")) return "🎨";
  return "●";
}
