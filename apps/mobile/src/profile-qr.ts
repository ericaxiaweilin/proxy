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

// PROFILE-QR-003 扫码解析：扫码枪/剪贴板拿到的文本落到哪。
//
// 为什么只认 proxy.app：扫任何码都给反应等于帮钓鱼码做跳转；非 Proxy 内容
// 返回 null，调用方必须说人话（"这不是 Proxy 二维码"），不许静默吞掉，
// 更不许拿演示 ID 凑数（杀掉 SCAN sheet 的模拟识别演示）。
export type ScannedQr =
  | { kind: "profile"; handle: string; url: string }
  | { kind: "invite"; handle: string; url: string };

export function parseScannedQr(value: string): ScannedQr | null {
  const v = value.trim();
  if (!v) return null;
  const normalized = toQrPayload(v);
  const profile = /^https:\/\/proxy\.app\/@([A-Za-z0-9._-]+)\/?$/i.exec(normalized);
  if (profile?.[1] && HANDLE_PATTERN.test(profile[1])) {
    const handle = profile[1].replace(/^@+/, "");
    return { kind: "profile", handle, url: `https://proxy.app/@${handle}` };
  }
  const invite = /^https:\/\/proxy\.app\/invite\/([A-Za-z0-9._-]+)\/?$/i.exec(normalized);
  if (invite?.[1] && HANDLE_PATTERN.test(invite[1])) {
    const handle = invite[1].replace(/^@+/, "");
    return { kind: "invite", handle, url: `https://proxy.app/invite/${handle}` };
  }
  return null;
}
