import { useState, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

// Otter Brand design tokens — ported 1:1 from Proxy_Free_Prototype_v1.5.2 :root
export const color = {
  magenta: "#FF1B6B",
  violet: "#7C2AFF",
  lime: "#D4FF3D",
  ink: "#14121F",
  offWhite: "#FAF9FC",
  mint: "#1FC8A9",
  muted: "#746E7C",
  line: "#E8E3EC",
  surface: "#F3EEF8",
  warn: "#FFF2C7",
  appBg: "#EEEAF1",
  white: "#FFFFFF",

  heroShadow: "rgba(124,42,255,0.2)",
  cardShadow: "rgba(32,16,50,0.06)",
  cardBorder: "rgba(20,18,31,0.035)",
  darkCardText: "#D8D1E0",
  brandSmall: "#AAA0B6",
  sideText: "#DDD5E5",

  factConfirmedBg: "#ECF8D0",
  factConfirmedFg: "#405B00",
  factInferredBg: "#F1EAFE",
  factInferredFg: "#5B2CB5",
  factUnknownBg: "#FFF1CC",
  factUnknownFg: "#7A5B00",

  stateWarnBg: "#FFF8DF",
  stateWarnBorder: "#F0DA85",
  stateDangerBg: "#FFF0F3",
  stateDangerBorder: "#FFC4D3",
  stateInfoBg: "#F1F7FF",
  stateInfoBorder: "#CFE2FA",

  attentionBorder: "#FFD2E3",
  attentionBg: "#FFF4F8",
  resumebarBg: "#EEF8D5",
  resumebarBorder: "#D4E996",
  inspireSavedBorder: "#A8C91E",
  inspireSavedBg: "#FBFFE9",
  bottomActiveBg: "#FFF0F6",
  error: "#B5194E"
};

export const gradient = {
  hero: [color.magenta, color.violet] as const,
  cta: [color.magenta, color.violet] as const
};

// Gradient — pure React Native (no native dep), vertical lerp between two stops.
// Reads the prototype's 135°/120° magenta→violet as a clean vertical gradient.
export function Gradient({
  from,
  to,
  bands = 14,
  style,
  children
}: {
  from: string;
  to: string;
  bands?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}): React.JSX.Element {
  const [height, setHeight] = useState(0);
  const bandHeight = height / bands;
  return (
    <View
      style={[styles.gradientRoot, style]}
      onLayout={(event) => {
        const h = event.nativeEvent.layout.height;
        if (h !== height) setHeight(h);
      }}
    >
      {height > 0
        ? Array.from({ length: bands }).map((_, index) => (
            <View
              key={index}
              style={{
                backgroundColor: lerpHex(from, to, index / (bands - 1)),
                height: bandHeight,
                left: 0,
                position: "absolute",
                right: 0,
                top: index * bandHeight
              }}
            />
          ))
        : null}
      {children}
    </View>
  );
}

function lerpHex(from: string, to: string, t: number): string {
  const parse = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const a = parse(from);
  const b = parse(to);
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

export const shadows = {
  hero: {
    elevation: 8,
    shadowColor: color.violet,
    shadowOffset: { width: 0, height: 13 },
    shadowOpacity: 0.2,
    shadowRadius: 28
  },
  card: {
    elevation: 2,
    shadowColor: "#201032",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 18
  },
  phone: {
    elevation: 10,
    shadowColor: "#2A1042",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.14,
    shadowRadius: 55
  }
} as const;

const styles = StyleSheet.create({
  gradientRoot: {
    overflow: "hidden",
    position: "relative"
  }
});
