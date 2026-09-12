export const MAX_LOGIN_EMAIL_LENGTH = 50;

export function normalizeLoginEmail(value: string): string | undefined {
  let email = value.trim().toLowerCase();
  if (email && !email.includes("@")) email = `${email}@gmail.com`;
  if (email.length === 0 || email.length > MAX_LOGIN_EMAIL_LENGTH) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
  return email;
}
