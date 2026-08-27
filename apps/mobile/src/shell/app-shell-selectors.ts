/**
 * Pure selectors for the AppShell that are testable without the React
 * Native runtime. Kept separate from app-shell.tsx so vitest can import
 * them directly without tripping over JSX / `import typeof` markers in
 * the React Native entrypoint.
 */

export type MeTabView = "guest" | "voucher" | "me";

/**
 * The "Me" tab body selector.
 * - isGuest=true → "need to sign in" view (anonymous browser can't see
 *   personal data, relationships, or orders).
 * - voucherOpen=true → VoucherSurface
 * - default → MeSurface
 *
 * `isGuest` comes first so a guest never accidentally lands on the
 * voucher overlay (vouchers carry personal redemption history).
 */
export function selectMeTabView(input: { isGuest: boolean; voucherOpen: boolean }): MeTabView {
  if (input.isGuest) return "guest";
  if (input.voucherOpen) return "voucher";
  return "me";
}
