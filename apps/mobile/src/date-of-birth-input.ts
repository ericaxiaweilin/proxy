export const DATE_OF_BIRTH_DIGITS = 8;

/** Formats a numeric YYYYMMDD entry without making backspace fight separators. */
export function formatDateOfBirthInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, DATE_OF_BIRTH_DIGITS);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

/**
 * Registration age gate shared by the inline DOB hint and the
 * request-challenge submit path, so both surfaces report the same message.
 * Returns the user-facing error, or undefined when the value is a valid
 * 18+ date of birth. `now` is injectable for tests.
 */
export function getDateOfBirthError(value: string, now: Date = new Date()): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "请输入有效的出生日期 (YYYY-MM-DD)。";
  const dob = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(dob.getTime())) return "出生日期不是合法日期。";
  const ageYears = (now.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (ageYears < 18) return "需年满 18 岁才能注册。";
  return undefined;
}
