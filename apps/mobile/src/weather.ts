// WEATHER-001：地址旁的天气 + 发布时的天气提醒 / 改期建议。
//
// 数据来自服务端 GET /v1/weather（Open-Meteo，坐标在服务端取整到 0.1° 才出站）。
// 读不到就**什么都不画**：没有「默认晴天」，也不拿上次的数当现在的。
// 纯逻辑，没有 React / 网络依赖（fetch 由调用方传入），vitest 直接测。

export type WeatherCondition = "clear" | "cloudy" | "fog" | "drizzle" | "rain" | "heavy_rain" | "storm";

export type WeatherNow = { tempC: number; condition: WeatherCondition };

export type WeatherAdvice = {
  level: "OK" | "CAUTION" | "WARN" | "UNKNOWN";
  condition?: WeatherCondition;
  maxPrecipProb: number;
  suggestions: string[]; // ISO，离原时间由近到远
};

export type WeatherReport = { now: WeatherNow; advice?: WeatherAdvice };

const LABEL: Record<WeatherCondition, string> = {
  clear: "晴", cloudy: "多云", fog: "雾", drizzle: "小雨", rain: "雨", heavy_rain: "暴雨", storm: "雷暴"
};

export function conditionLabel(c: WeatherCondition): string {
  return LABEL[c] ?? "";
}

/** 「北宁 · 晴 28°」。 */
export function weatherLine(city: string, now: WeatherNow): string {
  const label = conditionLabel(now.condition);
  return `${city} · ${label} ${Math.round(now.tempC)}°`;
}

export async function fetchWeather(
  fetchImpl: typeof fetch,
  baseUrl: string,
  query: { lat: number; lng: number; at?: Date; hours?: number }
): Promise<WeatherReport | undefined> {
  try {
    const params = new URLSearchParams({ lat: String(query.lat), lng: String(query.lng) });
    if (query.at) params.set("at", query.at.toISOString());
    if (query.hours) params.set("hours", String(query.hours));
    const res = await fetchImpl(`${baseUrl}/v1/weather?${params.toString()}`);
    if (!res.ok) return undefined;
    const body = (await res.json()) as WeatherReport;
    if (!body?.now || typeof body.now.tempC !== "number") return undefined;
    return body;
  } catch {
    return undefined;
  }
}

/** 「HH:MM」→ 下一次出现的那一刻：已过今天的这个点就是明天的。 */
export function nextOccurrence(slot: string, now: Date): Date {
  const m = slot.match(/^(\d{1,2}):(\d{2})$/);
  const at = new Date(now);
  at.setHours(m ? Number(m[1]) : 19, m ? Number(m[2]) : 0, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

const pad = (n: number): string => String(n).padStart(2, "0");
export const slotOf = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export type AdviceOption = {
  label: string;
  /** 点一下能直接设成这个见面时间；不能（跨天且滚轮只有时刻）就是 undefined，只当文字。 */
  slot?: string;
};

export type AdviceMessage = { tone: "warn" | "caution"; text: string; options: AdviceOption[] };

/** OK / UNKNOWN 返回 undefined：没话可说就不画。 */
export function adviceMessage(advice: WeatherAdvice | undefined, at: Date, now: Date): AdviceMessage | undefined {
  if (!advice || (advice.level !== "WARN" && advice.level !== "CAUTION")) return undefined;
  const cond = advice.condition ? conditionLabel(advice.condition) : "降雨";
  if (advice.level === "CAUTION") {
    return { tone: "caution", text: `${slotOf(at)} 前后可能有${cond}（降水概率 ${advice.maxPrecipProb}%），出门带伞`, options: [] };
  }
  const options: AdviceOption[] = advice.suggestions.map((iso) => {
    const d = new Date(iso);
    const sameDay = d.toDateString() === at.toDateString();
    const tomorrow = d.toDateString() === new Date(now.getTime() + 86400000).toDateString();
    const label = `${sameDay ? "" : tomorrow ? "明天 " : `${d.getMonth() + 1}/${d.getDate()} `}${slotOf(d)}`;
    const settable = nextOccurrence(slotOf(d), now).getTime() === d.getTime();
    return settable ? { label, slot: slotOf(d) } : { label };
  });
  const head = `${slotOf(at)} 前后预报有${cond}`;
  return {
    tone: "warn",
    text: options.length > 0 ? `${head}，建议改到 ${options.map((o) => o.label).join(" 或 ")}` : `${head}，建议另约时间`,
    options
  };
}
