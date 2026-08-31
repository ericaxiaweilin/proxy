/**
 * Canonical city key for LocationContext filtering.
 *
 * 之前 (R15.14):
 *   - 客户端发送 `currentLocation.city` 直传（如 "河内"）。
 *   - 后端 Post.CityScope 历史值用 "hn" / "Hanoi" / "hanoi" / "河内" 各种。
 *   - 后端做严格字符串相等比较 → 全部不匹配 → 0 帖。
 *
 * 现在 (R15.22 修复):
 *   - 双端在 send/receive 时都通过 normalizeCityKey() 转成统一小写拼音
 *     canonical key (e.g. "hanoi" / "hcmc" / "danang" / "" 空=不过滤)。
 *   - normalizeCityKey 失败/未知 输入 → "" → 当 legacy 不传 (legacy full
 *     feed 行为)。
 *   - 后端 postCity 也走 normalizeCityKey()，所以历史 "hn" / "Hanoi" / "河内"
 *     都被识别为同一 canonical key。
 *
 * 规则:
 *   - 中文别名 → 拼音小写
 *   - 越南文 / 英文别名 → 小写、剥非字母
 *   - 未知 → ""
 */

const CITY_ALIAS_TO_KEY: Record<string, string> = {
  // 河内
  "河内": "hanoi",
  "hn": "hanoi",
  "hanoi": "hanoi",
  // 胡志明市 (Hồ Chí Minh)
  "胡志明市": "hcmc",
  "hcmc": "hcmc",
  "hồ chí minh": "hcmc",
  "ho chi minh": "hcmc",
  "hcm": "hcmc",
  "saigon": "hcmc",
  // 岘港 (Đà Nẵng)
  "岘港": "danang",
  "danang": "danang",
  "đà nẵng": "danang",
  "da nang": "danang"
};

/**
 * 把任何城市字符串 (中文 / 越南文 / 英文) 归一成 canonical key。
 * 失败/空/未知 → "" (调用方应跳过 city filter，保留 legacy 全量)。
 */
export function normalizeCityKey(input: string | null | undefined): string {
  if (!input) return "";
  const trimmed = input.trim();
  if (!trimmed) return "";
  // 直查
  const direct = CITY_ALIAS_TO_KEY[trimmed];
  if (direct) return direct;
  const lowered = trimmed.toLowerCase();
  const lowerHit = CITY_ALIAS_TO_KEY[lowered];
  if (lowerHit) return lowerHit;
  // 未知 — 不抛错, 返回 "" 让调用方决定是否过滤
  return "";
}

/**
 * Type guard: 是否有效的 canonical key
 */
export function isValidCityKey(key: string): boolean {
  return key === "hanoi" || key === "hcmc" || key === "danang";
}
