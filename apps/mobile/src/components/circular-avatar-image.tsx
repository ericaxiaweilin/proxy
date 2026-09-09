import { useId } from "react";
import Svg, { Circle, ClipPath, Defs, Image as SvgImage } from "react-native-svg";

export function CircularAvatarImage({ accessibilityLabel, size, uri }: { accessibilityLabel?: string; size: number; uri: string }): React.JSX.Element {
  const clipId = `avatar_circle_${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const radius = size / 2;
  return (
    <Svg {...(accessibilityLabel ? { accessibilityLabel } : {})} height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
      <Defs><ClipPath id={clipId}><Circle cx={radius} cy={radius} r={radius} /></ClipPath></Defs>
      <SvgImage clipPath={`url(#${clipId})`} height={size} href={{ uri }} preserveAspectRatio="xMidYMid slice" width={size} x={0} y={0} />
    </Svg>
  );
}
