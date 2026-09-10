export const DATE_OF_BIRTH_DIGITS = 8;

/** Formats a numeric YYYYMMDD entry without making backspace fight separators. */
export function formatDateOfBirthInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, DATE_OF_BIRTH_DIGITS);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}
