// profile-identity.ts — derive a fresh account's display profile from its
// own login identifier (PROFILE-READ-001).
//
// Registration binds email / phone, but nothing ever seeded the home-page
// profile from the account: fresh accounts fell back to a hardcoded demo
// identity (Huyen / huyen.hanoi), so every new user looked like the same
// person. The server is the source of truth once the user edits and saves;
// before that, derive from the identifier the account actually owns.

export type DerivedProfile = {
  name: string;
  handle: string;
  bio: string;
  city: string;
};

export const NEUTRAL_PROFILE: DerivedProfile = {
  name: "用户",
  handle: "@user",
  bio: "",
  city: "河内"
};

function sanitizeHandle(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9._]/g, "").replace(/^\.+/, "").slice(0, 30);
  return cleaned === "" ? "user" : cleaned;
}

/**
 * Derive an initial profile from the login identifier that owns the
 * account. Phone identifiers never become a public name (privacy): they
 * get the neutral label plus a non-identifying numeric handle suffix.
 */
export function deriveProfileFromIdentifier(
  identifier?: string | undefined,
  channel?: "EMAIL" | "SMS" | undefined
): DerivedProfile {
  const raw = (identifier ?? "").trim();
  if (raw === "") return { ...NEUTRAL_PROFILE };
  if (channel === "SMS" || !raw.includes("@")) {
    const digits = raw.replace(/\D/g, "");
    const suffix = digits.length >= 4 ? digits.slice(-4) : "user";
    return { name: "用户", handle: `@user${suffix === "user" ? "" : suffix}`, bio: "", city: "河内" };
  }
  const local = raw.split("@")[0] ?? "";
  const name = local.trim() === "" ? "用户" : local.trim();
  return { name, handle: `@${sanitizeHandle(local)}`, bio: "", city: "河内" };
}
