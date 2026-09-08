import { type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

// Proxy App Design System R3 tokens. R3 is the single visual baseline for the app.
export const color = {
  magenta: "#FF2474",
  violet: "#8533F5",
  lime: "#D6FB24",
  ink: "#17131F",
  deep: "#17131D",
  offWhite: "#F7F4F9",
  mint: "#1FC8A9",
  muted: "#7E7586",
  line: "#E6DFEB",
  surface: "#F4F0F6",
  warn: "#FFF2C7",
  appBg: "#EEEAF1",
  white: "#FFFFFF",

  heroShadow: "transparent",
  cardShadow: "transparent",
  cardBorder: "#E6DFEB",
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
  error: "#B5194E",

  // 原型基线补充 token（Proxy_P0_Prototype_R15_11_0_Social_Baseline_Launch_Candidate）
  answerSelectedBg: "#F8F3FF",
  domainActiveBg: "#FAF8FB",
  warnBannerBg: "#FFF6E8",
  warnBannerBorder: "#F0DDBB",
  warnBannerText: "#786650",
  chipNeutralBg: "#F6F2F8",
  chipNeutralText: "#625969",
  darkTextMuted: "#D8D1E0",
  violetSoftBg: "#F2ECF7",
  sponsoredBg: "#FFF0F6",
  sponsoredFg: "#C4175B",
  organicBg: "#EDF9F6",
  organicFg: "#137C6C",

  // R15.11 Social Baseline 新增 token
  proxyInk: "#17131F",
  proxyPurple: "#7C3AED",
  proxyPurpleSoft: "#F3EEFC",
  proxyGreen: "#18A957",
  proxyGreenSoft: "#EAF9F0",
  proxyLine: "#E9E3EC",
  proxyMuted: "#7D7383",
  homeIntentBg: "#FCFAFD",
  homeIntentBorder: "#DDD6E3",
  homeIntentInputBg: "#FCFBFD",
  marketModeBg: "#F5F1F8",
  // R16.x+ Activity 域 origin 调色板. tasks.tsx 的 ORIGIN_META
  // 走这些 token, 不再硬编码 hex. 改色就改 theme, 不用进 1500
  // 行的 tasks.tsx 找. 名字按 *origin enum 值* 命 (PLATFORM/
  // MERCHANT/USER) 而非角色名, 跟后端 schema 一致. AI 不再是
  // origin 主体 — AI 状态由 aiStatus / aiActorKind 表达, 另一个
  // 调色板 (aiActivityBadgeBg/Fg) 负责 AI 标注 badge.
  activityOriginPlatformBg: "#EEE6FF",
  activityOriginPlatformFg: "#5D32A4",
  activityOriginMerchantBg: "#F1FFD1",
  activityOriginMerchantFg: "#445C00",
  activityOriginUserBg: "#EAF8F4",
  activityOriginUserFg: "#176F60",
  // AI 标注徽标调色板 (与 origin 调色板并列; 在 UI 里独立渲染).
  aiActivityBadgeBg: "#EEF0FF",
  aiActivityBadgeFg: "#3949AB"
};

// Proxy UI Foundation v1. These aliases mirror the portable CSS token pack
// while resolving to the active R3 identity. Product surfaces must consume
// these semantic roles instead of copying BoardUI's visual language.
export const foundation = {
  background: color.offWhite,
  surface: color.white,
  surfaceSecondary: color.surface,
  ink: color.ink,
  muted: color.muted,
  faint: "#A39E96",
  line: color.line,
  accent: "#F2B63F",
  accentSoft: "#FFF2CC",
  success: "#187653",
  danger: "#BD3434",
  radius: { xs: 8, sm: 11, md: 16, lg: 22, xl: 28, full: 999 },
  space: { one: 4, two: 8, three: 12, four: 16, five: 20, six: 24, eight: 32 },
  text: { xs: 11, sm: 13, md: 15, lg: 18, xl: 24 },
  control: { sm: 32, md: 40, lg: 48 }
} as const;

export const gradient = {
  hero: [color.magenta, color.violet] as const,
  cta: [color.magenta, color.violet] as const
};

// Gradient — pure React Native (no native dep), vertical lerp between two stops.
// A fixed fill layer with overlapping percentage bands avoids the first-frame
// onLayout/state update that used to make Home briefly flash while measuring.
export function Gradient({
  from,
  to,
  bands = 48,
  style,
  children
}: {
  from: string;
  to: string;
  bands?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <View
      // The gradient is a visual layer. Let nested Pressables (and sibling
      // buttons using an absolute-fill gradient) receive Android touches.
      pointerEvents="box-none"
      style={[styles.gradientRoot, { backgroundColor: from }, style]}
    >
      <View pointerEvents="none" style={styles.gradientBands}>
        {Array.from({ length: bands }).map((_, index) => (
          <View
            key={index}
            style={{
              backgroundColor: lerpHex(from, to, index / (bands - 1)),
              height: `${100 / bands + 1.5}%`,
              left: 0,
              position: "absolute",
              right: 0,
              top: `${index * (100 / bands) - 0.75}%`
            }}
          />
        ))}
      </View>
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
    elevation: 0,
    shadowColor: "transparent",
    shadowOffset: { width: 0, height: 13 },
    shadowOpacity: 0,
    shadowRadius: 0
  },
  card: {
    elevation: 0,
    shadowColor: "transparent",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0,
    shadowRadius: 0
  },
  nav: {
    elevation: 0,
    shadowColor: "transparent",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0,
    shadowRadius: 0
  },
  phone: {
    elevation: 0,
    shadowColor: "transparent",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0,
    shadowRadius: 0
  }
} as const;

const styles = StyleSheet.create({
  gradientRoot: {
    overflow: "hidden",
    position: "relative"
  },
  gradientBands: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  }
});
