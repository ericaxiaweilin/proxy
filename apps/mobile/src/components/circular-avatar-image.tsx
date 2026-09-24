import { useId } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import Svg, { Circle, ClipPath, Defs, Image as SvgImage } from "react-native-svg";

// MEDIA-PIPELINE-001: source 接受统一资产层形态（打包数字资源或 {uri}）。
// SVG 圆裁剪保持不变（iOS 圆角合成坑，见 PLACEHOLDER-008）。
//
// AVATAR-SVG-DECODE-001（2026-09-24，用户：「头像先显示默认头像 再刷新显示用户自定义保存的头像」）：
// react-native-svg 的 <Image> 没有缓存，每次挂载都异步重新解码 —— uri 首帧就有（AVATAR-FLASH-001/002、
// AVATAR-REMOTE-CACHE-001 修的是 uri 为空），画面上仍有一帧只剩容器底色的空圆。底下垫一层 expo-image
// （memory-disk，同 PLACEHOLDER-009 会话头像），内存命中同步出图；SVG 解码完盖在上面，两层同图同裁剪。
export function CircularAvatarImage({ accessibilityLabel, size, uri, source }: {
  accessibilityLabel?: string;
  size: number;
  uri?: string | undefined;
  source?: number | { uri: string } | undefined;
}): React.JSX.Element | null {
  const clipId = `avatar_circle_${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const radius = size / 2;
  const href = source ?? (uri !== undefined ? { uri } : undefined);
  if (href === undefined) return null;
  return (
    <View {...(accessibilityLabel ? { accessibilityLabel } : {})} style={{ height: size, width: size }}>
      <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`avatar:${typeof href === "number" ? href : href.uri}`} source={href} style={{ borderRadius: radius, height: size, left: 0, position: "absolute", top: 0, width: size }} transition={0} />
      <Svg height={size} style={{ left: 0, position: "absolute", top: 0 }} viewBox={`0 0 ${size} ${size}`} width={size}>
        <Defs><ClipPath id={clipId}><Circle cx={radius} cy={radius} r={radius} /></ClipPath></Defs>
        <SvgImage clipPath={`url(#${clipId})`} height={size} href={href} preserveAspectRatio="xMidYMid slice" width={size} x={0} y={0} />
      </Svg>
    </View>
  );
}
