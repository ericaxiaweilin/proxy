// PROFILE-QR-002 个人二维码常规能力：payload 构造与归一化（纯函数，可单测）。
//
// 为什么是 https:// 全量：相机 / 浏览器 / 分享面板只认可 linkify 的完整 URL，
// 裸 `proxy.app/@x` 在很多 App 里点不动、扫出来不跳转。展示时仍可显示短式，
// 但编码进二维码、复制、分享的一律是全量。

const HANDLE_PATTERN = /^[A-Za-z0-9._-]+$/;

/** 个人主页二维码 payload；handle 非法/为空返回 null（调用方 fail-closed，不画坏码）。 */
export function profileQrPayload(handle: string): string | null {
  const cleaned = handle.trim().replace(/^@+/, "");
  if (!cleaned || !HANDLE_PATTERN.test(cleaned)) return null;
  return `https://proxy.app/@${cleaned}`;
}

/** 好友邀请二维码 payload；handle 非法/为空返回 null（调用方 fail-closed）。 */
export function inviteQrPayload(handle: string): string | null {
  const cleaned = handle.trim().replace(/^@+/, "");
  if (!cleaned || !HANDLE_PATTERN.test(cleaned)) return null;
  return `https://proxy.app/invite/${cleaned}`;
}
/** 旧的裸 `proxy.app/...` 归一成 https 全量；未知形状原样透传，绝不瞎改。 */
export function toQrPayload(value: string): string {
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("proxy.app/")) return `https://${v}`;
  return v;
}
