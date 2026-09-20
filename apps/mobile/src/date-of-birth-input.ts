export const DATE_OF_BIRTH_DIGITS = 8;

/** Formats a numeric YYYYMMDD entry without making backspace fight separators. */
export function formatDateOfBirthInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, DATE_OF_BIRTH_DIGITS);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

/**
 * 把 YYYY-MM-DD 拆成各段数值，不做任何引擎相关的日期解析。
 *
 * 为什么不用 `new Date(value)`：越界的 ISO 串在不同 JS 引擎上结果不一样 ——
 * 实测 Node/V8 把 `1999-99-99` 判成 Invalid Date，而真机 Hermes 会把它滚月
 * 成合法日期（`1999-02-31` → `1999-03-03`）。同一个输入一个引擎拦、一个引擎
 * 放，正是 AUTH-DOB-BOUNDS-001 的根因。所以边界必须自己判，不能交给 `Date`。
 */
export function parseDateOfBirthParts(
  value: string
): { year: number; month: number; day: number } | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [yearText, monthText, dayText] = value.split("-");
  return { year: Number(yearText), month: Number(monthText), day: Number(dayText) };
}

/**
 * Registration age gate shared by the inline DOB hint and the
 * request-challenge submit path, so both surfaces report the same message.
 * Returns the user-facing error, or undefined when the value is a valid
 * 18+ date of birth. `now` is injectable for tests.
 */
export function getDateOfBirthError(value: string, now: Date = new Date()): string | undefined {
  const parts = parseDateOfBirthParts(value);
  if (!parts) return "请输入有效的出生日期 (YYYY-MM-DD)。";
  const { year, month, day } = parts;
  // AUTH-DOB-BOUNDS-001：基本边界自己判。月份 1-12、日期 1-31，越界直接拒 ——
  // 这里刻意不依赖 Date 的越界行为，理由见 parseDateOfBirthParts 的注释。
  if (month < 1 || month > 12) return "月份需要在 1-12 之间。";
  if (day < 1 || day > 31) return "日期需要在 1-31 之间。";
  // 再回读一遍确认这一天真实存在：挡掉「日不越 31、但那个月没有这一天」的
  // 输入（02-31 / 04-31 / 02-30），它们会被 Date 悄悄滚到下个月 1 号或 3 号。
  const dob = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(dob.getTime()) ||
    dob.getUTCFullYear() !== year ||
    dob.getUTCMonth() !== month - 1 ||
    dob.getUTCDate() !== day
  ) {
    return "出生日期不是合法日期。";
  }
  const ageYears = (now.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (ageYears < 18) return "需年满 18 岁才能注册。";
  return undefined;
}
