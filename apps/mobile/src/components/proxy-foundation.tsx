import { useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type TextStyle,
  type ViewStyle
} from "react-native";
import { color, foundation } from "../theme";
import { ProxyIcon, type ProxyIconName } from "./proxy-icon";

type ButtonTone = "primary" | "secondary" | "ghost" | "danger";

// BUTTON-UNIFY-001（2026-09-26，用户「推进新的按钮组件统一更新」）：补 accessibilityLabel。
// 兄弟组件 ProxyIconButton 一直有这个口子，ProxyButton 没有 —— 于是所有**手写**的
// Pressable 按钮都带着自己的 accessibilityLabel（"用这个落点" / "保存到 X 的 Y"），
// 迁到 ProxyButton 就会把这个标签**静默丢掉**（读屏用户失去按钮语义）。补上它，
// 迁移才是等价替换而不是功能倒退。可选参数，不传的行为和以前完全一致。
export function ProxyButton({
  accessibilityLabel,
  children,
  disabled = false,
  onPress,
  tone = "primary",
  style
}: {
  accessibilityLabel?: string;
  children: ReactNode;
  disabled?: boolean;
  onPress?: () => void;
  tone?: ButtonTone;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const textTone: Record<ButtonTone, StyleProp<TextStyle>> = {
    primary: styles.buttonTextInverse,
    secondary: styles.buttonText,
    ghost: styles.buttonText,
    danger: styles.buttonTextInverse
  };
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[`button_${tone}`],
        disabled && styles.disabled,
        pressed && styles.buttonPressed,
        style
      ]}
    >
      {typeof children === "string" ? <Text selectable style={[styles.buttonText, textTone[tone]]}>{children}</Text> : children}
    </Pressable>
  );
}

export function ProxyIconButton({
  accessibilityLabel,
  children,
  disabled = false,
  onPress,
  selected = false,
  style
}: {
  accessibilityLabel: string;
  children: ReactNode;
  disabled?: boolean;
  onPress?: () => void;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      // BUTTON-SHAPE-ALIGN-001：原型 .icon-btn 有 :active{scale(.94)}，本仓此前没有。
      // 改成函数式 style 才拿得到 pressed（跟 ProxyButton 的 buttonPressed 同一套路）。
      style={({ pressed }) => [styles.iconButton, selected && styles.iconButtonSelected, disabled && styles.disabled, pressed && styles.iconButtonPressed, style]}
    >
      {children}
    </Pressable>
  );
}

// BACK-GLYPH-001（2026-09-26，用户：「把所有页面的返回 < 这个logo统一颜色 大小 形状
// 我看了 很多页面的返回不统一 红的 黑的 大小...」）：全 App **唯一**的返回字形。
//
// 统一之前：94 个 `‹` 散在 38 个文件里，字号 11→28 十一种、颜色九种、容器三种。
// 根因不是"有人偷懒"，是**字形选错了**：`‹` 是单左引号，不是箭头。它的形状/粗细/
// 垂直基线都跟着 fontSize + fontWeight + 平台字体漂移，所以每个页面都只能各自手调
// 字号去把它凑成箭头 —— 必然调出一串不一致。原型也一样：R15_15 / R15_18 两份稿里
// 就有 6 个不同的返回 class（30×30/22px、32×32/圆角11/18px、26×26/圆角9/22px、
// 34×34/圆角12/20px、34×34/圆角12/15px、18px），我们是逐个照抄才抄花的。
//
// 所以这里不复用任何一份旧写法，改成 SVG 描边路径（proxy-icon 的 backArrow，
// 就是原型 `.back-btn svg` 那条 M15 18l-6-6 6-6）：形状与字号解耦，一个尺寸走天下。
//
// 为什么只导出**字形**、不导出整个按钮：容器是页面自己的事（裸字形排在表头里、
// 圆按钮浮在地图上、38pt 圆在消息页），把 38 个文件的 Pressable 一起换掉会改到
// 几十处点击区和内边距 —— 那是拿布局风险换整洁。所以这里只统一字形：
// 形状（chevronLeft 那条路径）、尺寸（foundation.backGlyph）、颜色（下面两个 tone）。
//
// tone 只有两个值，多一个就是新的不一致，不许再加：
//   ink    默认。浅底 / ink 底上的返回
//   onDark 深底、照片、半透明黑底上的返回（白字形）
// 统一之前那 9 种颜色里，magenta / violet / #151515 / #11110f / lotus.ink 都只是
// "某个人当时顺手写的近黑色"，一律收成 ink。
export type BackTone = "ink" | "onDark";

export function ProxyBackGlyph({ label, tone = "ink" }: { label?: string; tone?: BackTone }): React.JSX.Element {
  const glyphColor = tone === "onDark" ? foundation.surface : foundation.ink;
  const glyph = <ProxyIcon color={glyphColor} name="backArrow" size={foundation.backGlyph} />;
  // label 可选：「字形 + 文字」的返回（如「返回我的」）。文字排版也统一在这里 ——
  // 统一之前这些标签的 fontSize 是 12/13/14 三种、颜色跟着字形一起花。
  // 之前有 5 处是把 `‹ ` 拼进字符串当标签传（addFriendBackLabel / backLabel），
  // 现在字形由本组件画，标签只留文字，别再往标签里拼字形。
  if (label === undefined) return glyph;
  return (
    <View style={styles.backGlyphRow}>
      {glyph}
      <Text selectable style={[styles.backGlyphLabel, { color: glyphColor }]}>{label}</Text>
    </View>
  );
}

export function ProxyAvatar({
  accessibilityLabel,
  fallback,
  size = 44,
  source
}: {
  accessibilityLabel: string;
  fallback: string;
  size?: 32 | 44 | 60;
  source?: ImageSourcePropType;
}): React.JSX.Element {
  // TWIN-INSIGHT-AVATAR-001: 首字永远垫在底下 —— 图在加载/404/解码失败时
  // 绝不能把灰圈+字藏掉（之前 Image 顶掉 Text，坏 URI 时 onError 没来得及
  // 或不触发就成了“连灰头像都没有”）。图成功后盖住字；失败撤掉图露出字。
  // uri 变了重置失败态，免得换人后还挂着上一张的失败。
  const uri = typeof source === "object" && source !== null && "uri" in source ? source.uri : undefined;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [uri]);
  const showImage = source !== undefined && !failed;
  return (
    <View accessibilityLabel={accessibilityLabel} style={[styles.avatar, { height: size, width: size }]}>
      <Text selectable style={styles.avatarFallback}>{fallback.slice(0, 1)}</Text>
      {showImage ? (
        <Image source={source} style={styles.avatarImageAbsolute} onError={() => setFailed(true)} />
      ) : null}
    </View>
  );
}

export function ProxyTabs<T extends string>({
  activeId,
  items,
  onChange,
  style
}: {
  activeId: T;
  items: ReadonlyArray<{ id: T; label: string }>;
  onChange: (id: T) => void;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  return (
    <View accessibilityRole="tablist" style={[styles.tabs, style]}>
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(item.id)}
            style={styles.tab}
          >
            <Text selectable style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text>
            {active ? <View style={styles.tabUnderline} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function ProxySwitch({
  accessibilityLabel,
  onChange,
  value
}: {
  accessibilityLabel: string;
  onChange: (value: boolean) => void;
  value: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={[styles.switch, value && styles.switchOn]}
    >
      <View style={[styles.switchKnob, value && styles.switchKnobOn]} />
    </Pressable>
  );
}

// DESIGN-CLEANUP-001: 全 App 唯一的加载指示。之前 25 个文件各自直接调 RN
// ActivityIndicator，颜色尺寸全凭手感 —— 9 处传 magenta 是事实默认色，
// 其余 ink/white/violet/默认灰各写各的。
//
// tone 语义（迁移时必须显式传，不许靠默认蒙混过关）：
//   brand  = color.magenta（原来就传 magenta 的那些，原样）
//   onDark = color.white（原来传 white 的）
//   onLight = color.ink（原来传 ink 的）
//   violet = color.violet（只有 native-app 法务忙态一处，原样保留）
//   muted  = color.muted（原来**不传色**吃系统默认灰的那些 —— 系统灰和 muted
//            差一个色阶，统一比精确值钱，这里白纸黑字写出来）
// size 默认 small：RN 的 ActivityIndicator 默认就是 small，原来 40 处里只有
// 2 处显式 small、0 处 large —— 默认值必须和小的一致，否则全屏一起变大。
// label 只有一处在用（native-app 法务“加载中…”），样式照抄它那份，一字不差。
export type LoadingTone = "brand" | "onDark" | "onLight" | "violet" | "muted";
const loadingToneColor: Record<LoadingTone, string> = {
  brand: color.magenta,
  onDark: color.white,
  onLight: color.ink,
  violet: color.violet,
  muted: color.muted,
};
export function ProxyLoading({
  size = "small",
  tone,
  label,
  style
}: {
  size?: "small" | "large";
  tone: LoadingTone;
  label?: string;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const indicator = <ActivityIndicator color={loadingToneColor[tone]} size={size} style={style} />;
  if (label === undefined) return indicator;
  return (
    <View style={styles.loadingLabelWrap}>
      {indicator}
      <Text selectable style={styles.loadingLabel}>{label}</Text>
    </View>
  );
}

// DESIGN-CLEANUP-001: 全 App 唯一的整块空态。原型是 ProfileTabs 自己的
// EmptyState({title, sub})（用了 8 处），但它把颜色写成了 Tailwind 外来色
//（#0f172a/#94a3b8），提升时换成 ink/muted —— 不许原样复制。
// icon/cta 可选：7 个迁移点里只有 merchant-storefront 用到，别的别传。
export function ProxyEmptyState({
  icon,
  title,
  sub,
  cta
}: {
  icon?: ProxyIconName;
  title: string;
  sub?: string;
  cta?: { label: string; onPress: () => void; disabled?: boolean };
}): React.JSX.Element {
  return (
    <View style={styles.empty}>
      {icon !== undefined ? <ProxyIcon color={foundation.muted} name={icon} size={28} /> : null}
      <Text selectable style={styles.emptyTitle}>{title}</Text>
      {sub !== undefined ? <Text selectable style={styles.emptySub}>{sub}</Text> : null}
      {cta !== undefined ? (
        <View style={styles.emptyCta}>
          <ProxyButton disabled={cta.disabled ?? false} onPress={cta.onPress}>{cta.label}</ProxyButton>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: "center", backgroundColor: foundation.surfaceSecondary, borderColor: foundation.line, borderRadius: foundation.radius.full, borderWidth: 1, justifyContent: "center", overflow: "hidden" },
  avatarFallback: { color: foundation.ink, fontSize: foundation.text.sm, fontWeight: "800" },
  avatarImage: { height: "100%", width: "100%" },
  avatarImageAbsolute: { height: "100%", left: 0, position: "absolute", top: 0, width: "100%" },
  // 字形 + 标签的返回：行内排。backArrow 的 box 是贴着箭头裁的（没有旁白），
  // 所以间距必须由这里给，不能靠字形的空白 —— gap 4 是唯一的间距值。
  backGlyphRow: { alignItems: "center", flexDirection: "row", gap: 4 },
  backGlyphLabel: { fontSize: foundation.text.sm, fontWeight: "800" },
  // BUTTON-SHAPE-ALIGN-001（2026-09-26）：基准形状换成原型 sec-buttons 04 的值。
  // 原型「所有按钮共享同一套圆角、间距、字号、状态反馈」：
  //   .btn { padding:0 20px; height:48px; border-radius:14px; font-size:14px;
  //          font-weight:900; letter-spacing:-.2px; gap:8px }
  //   .btn-ghost / .icon-btn 的边框是 1.5px；.btn:disabled { opacity:.4 }
  // 对齐前是 40 高 / radius 11 / padding 0 14 / 13pt / 800 / 1px / .42 —— 那几个数不是
  // 原型值，是各页面手写按钮互相抄出来的（见 BUTTON-UNIFY-001 那张表）。用户看了原型后
  // 明确「对齐」⇒ 这是换基线，不是机械统一。
  // 48 用 control.lg、20 用 space.five（这两个 token 本来就等于原型值，别写死数字）；
  // 14 圆角 / 14 字号本仓没有对应 token（radius.sm=11、text.sm=13），按原型写死。
  button: { alignItems: "center", borderRadius: 14, borderWidth: 1.5, flexDirection: "row", gap: foundation.space.two, justifyContent: "center", minHeight: foundation.control.lg, paddingHorizontal: foundation.space.five },
  button_primary: { backgroundColor: foundation.ink, borderColor: foundation.ink },
  button_secondary: { backgroundColor: foundation.surface, borderColor: foundation.line },
  button_ghost: { backgroundColor: "transparent", borderColor: "transparent" },
  button_danger: { backgroundColor: foundation.danger, borderColor: foundation.danger },
  buttonText: { color: foundation.ink, fontSize: 14, fontWeight: "900", letterSpacing: -0.2 },
  buttonTextInverse: { color: foundation.surface },
  // BUTTON-UNIFY-002：按压反馈。原型的按钮**全都**是 :active{transform:scale(.97)}
  // —— .btn-follow / .btn-message / .btn-more 三条一模一样。公共按钮此前一个按压
  // 反馈都没有，而各页面手写的那份又各写各的（#3A2F4A 换底色 / opacity .78 /
  // scale .92 / .96 / .985）。这里按原型收成唯一一个值 .97。
  // 用 scale 不用换色：换色要给四个 tone 各配一个按压色，就是四个新出处。
  buttonPressed: { transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.4 },
  // 原型 .icon-btn：44×44 / border-radius:14px / 1.5px 边框 / :active{scale(.94)}。
  // 对齐前是 40×40 **胶囊**（radius.full）—— 胶囊是本仓自己的形状，原型是圆角方。
  // ⚠️ 下游有按旧 40pt 几何算的常量：surfaces/badminton-companion.tsx 的
  // `DETAIL_BADGE_TOP = 6 + foundation.control.md + 10` 会差 4pt。那是 peer 在制文件，
  // 这里不动，只记着。
  iconButton: { alignItems: "center", backgroundColor: foundation.surface, borderColor: foundation.line, borderRadius: 14, borderWidth: 1.5, height: 44, justifyContent: "center", width: 44 },
  // 原型图标钮有按压反馈（scale .94），本仓此前一个都没有 —— 补上，跟 .btn 的 .97 同源。
  iconButtonPressed: { transform: [{ scale: 0.94 }] },
  iconButtonSelected: { backgroundColor: foundation.ink, borderColor: foundation.ink },
  tabs: { borderBottomColor: foundation.line, borderBottomWidth: 1, flexDirection: "row", gap: foundation.space.four },
  tab: { alignItems: "center", flex: 1, minHeight: foundation.control.md, justifyContent: "center", paddingHorizontal: 1, position: "relative" },
  tabText: { color: foundation.muted, fontSize: foundation.text.sm },
  tabTextActive: { color: foundation.ink, fontWeight: "800" },
  tabUnderline: { backgroundColor: foundation.ink, bottom: -1, height: 2, left: 0, position: "absolute", right: 0 },
  switch: { backgroundColor: foundation.surfaceSecondary, borderColor: foundation.line, borderRadius: foundation.radius.full, borderWidth: 1, height: 28, justifyContent: "center", padding: 3, width: 46 },
  switchOn: { backgroundColor: foundation.ink, borderColor: foundation.ink },
  switchKnob: { backgroundColor: foundation.surface, borderColor: foundation.line, borderRadius: foundation.radius.full, borderWidth: 1, height: 20, width: 20 },
  switchKnobOn: { transform: [{ translateX: 18 }] },
  loadingLabelWrap: { alignItems: "center" },
  loadingLabel: { color: color.muted, fontSize: 13, marginTop: 8 },
  empty: { alignItems: "center", paddingHorizontal: 32, paddingVertical: 48 },
  emptyTitle: { color: foundation.ink, fontSize: 15, fontWeight: "700", marginBottom: 4, textAlign: "center" },
  emptySub: { color: foundation.muted, fontSize: 12, textAlign: "center" },
  emptyCta: { marginTop: 12 }
});
