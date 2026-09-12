// R15.34.2: FilterChipRail — 共享的横滑 chip rail 组件。
//
// 复用场景：
//   - feed.tsx 的 "feedfilterrail" (R15.3) — 在 PAGE_SEQUENCE
//     上下文中横滑不会触发外层 tab 切页
//   - requester-home.tsx 的 "recommendModes" (R15.34) — 同上
//   - 任何需要横滑 chip 选择器的场景
//
// 关键问题：当 chip rail 放在 app-shell 的 PAGE_SEQUENCE 容器里
// (app-shell.tsx 注册了 panResponder 抓 |dx|>6 的横滑切页)，
// 内层水平 ScrollView 在 Android/iOS gesture 优先级里会输给
// 外层 panResponder — 用户横滑会切 tab 而不是滚 chip。
//
// 解决：PanResponder 隔离逻辑在共享的 HorizontalSwipeRail 组件里
// (components/horizontal-swipe-rail.tsx)。本组件只是 HorizontalSwipeRail
// 的 chip 包装。
//
// 用法：
//   <FilterChipRail
//     items={[{ id: "PHOTO", label: "拍照" }, ...]}
//     activeId={recommendMode}
//     onChange={(id) => setRecommendMode(id)}
//   />
//
// 颜色 / 高度 / 内边距 可由 style 覆盖；默认跟基线 r153
// feedfilterrail 一致 (44 高 / 13×8 padding / ink 黑底高亮)。

import { Pressable, StyleSheet, Text } from "react-native";
import { Image, type ImageSource } from "expo-image";
import { HorizontalSwipeRail } from "./horizontal-swipe-rail";
import { ProxyIcon, type ProxyIconName } from "./proxy-icon";
import { color, shadows } from "../theme";

export interface FilterChipRailItem {
  id: string;
  label: string;
  icon?: ProxyIconName;
  assetIcon?: ImageSource;
}

export interface FilterChipRailProps {
  items: ReadonlyArray<FilterChipRailItem>;
  activeId: string;
  onChange: (id: string) => void;
  // 间距微调 — 默认 8
  gap?: number;
  // 外层 marginBottom — 默认 0
  marginBottom?: number;
  // 是否展示 scroll indicator — 默认 false
  showScrollIndicator?: boolean;
  // 测试用 accessibility label 前缀
  testPrefix?: string;
}

export function FilterChipRail({
  items,
  activeId,
  onChange,
  gap = 8,
  marginBottom = 0,
  showScrollIndicator = false,
  testPrefix = "filter-chip"
}: FilterChipRailProps): React.JSX.Element {
  return (
    <HorizontalSwipeRail
      contentContainerStyle={[styles.content, { gap }]}
      style={[styles.rail, { marginBottom }]}
      showScrollIndicator={showScrollIndicator}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <Pressable
            key={item.id}
            onPress={() => onChange(item.id)}
            style={[styles.chip, active && styles.chipActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${testPrefix} ${item.label}${active ? "，已选" : ""}`}
          >
            {item.assetIcon ? <Image contentFit="contain" source={item.assetIcon} style={[styles.assetIcon, active && styles.assetIconActive]} /> : item.icon ? <ProxyIcon color={active ? color.white : color.ink} name={item.icon} size={18} /> : null}
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </HorizontalSwipeRail>
  );
}

const styles = StyleSheet.create({
  // R15.34.2: 内层 ScrollView 实际横滑；无背景/边框
  rail: {},
  content: { paddingRight: 18 },
  // R15.34.1: chip 样式 — 跟基线 r153 feedfilterrail 一致
  //   - 白底 + 1px line 边框 + 999 圆角
  //   - minHeight 44 (避免太矮)
  //   - 12pt 文字 + 800 字重
  chip: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 13,
    paddingVertical: 8
  },
  chipActive: {
    backgroundColor: color.ink,
    borderColor: color.ink,
    ...shadows.card
  },
  chipText: {
    color: "#62596A",
    fontSize: 12,
    fontWeight: "800"
  },
  chipTextActive: {
    color: color.white
  },
  assetIcon: { height: 24, tintColor: color.ink, width: 24 },
  assetIconActive: { tintColor: color.white }
});
