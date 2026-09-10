import { useId } from "react";
import Svg, { Circle, ClipPath, Defs, Image as SvgImage } from "react-native-svg";

// MEDIA-PIPELINE-001: source 接受统一资产层形态（打包数字资源或 {uri}）。
// SVG 圆裁剪保持不变（iOS 圆角合成坑，见 PLACEHOLDER-008）。
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
    <Svg {...(accessibilityLabel ? { accessibilityLabel } : {})} height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
      <Defs><ClipPath id={clipId}><Circle cx={radius} cy={radius} r={radius} /></ClipPath></Defs>
      <SvgImage clipPath={`url(#${clipId})`} height={size} href={href} preserveAspectRatio="xMidYMid slice" width={size} x={0} y={0} />
    </Svg>
  );
}
