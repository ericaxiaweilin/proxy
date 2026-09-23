// twin-avatar-source.ts — 好友洞察头像 wire → 可渲染 source (TWIN-INSIGHT-AVATAR-001)。
//
// 独立成纯 TS（不 import react-native）：单测跑在纯 node，直接拉
// twin-insight-card.tsx 会把 react-native 的 flow 语法喂给 rollup 炸掉。
// 语义与 messages.resolveAvatarSource 同源 —— 认不出的绝不拼坏 URI。

/** wire 上的 avatarUrl 可能是服务端相对路径（/v1/media/thumb/<id>）或空串。
 * 必须经 resolveMediaUrl 拼上 base；空/认不出的回落首字（undefined）。 */
export function twinAvatarSource(
  avatarUrl: string | undefined,
  resolveMediaUrl?: ((path: string) => string) | undefined,
): { uri: string } | undefined {
  const trimmed = (avatarUrl ?? "").trim();
  if (trimmed === "") return undefined;
  if (/^https?:\/\//.test(trimmed)) return { uri: trimmed };
  if (trimmed.startsWith("/") && typeof resolveMediaUrl === "function") {
    const uri = resolveMediaUrl(trimmed);
    return uri === "" ? undefined : { uri };
  }
  return undefined;
}
