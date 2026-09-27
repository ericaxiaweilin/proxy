// SCENE-LOCATION-PICKER-001（2026-09-27，用户：「所有的场景卡片 点击弹出的
// list 都要共用城市list 搜索框 这是必须的 你看运动卡片list就做好了 其它的
// 没做」）。
//
// 「运动 · 羽毛球」入口（badminton-companion.tsx）已经有一个做对的选城市页：
// 分组（当前定位/最近访问/热门/城市组）+ 搜索框实时过滤 + 多选 chip + 底部
// 「完成」确认。首页其余 6 张场景卡（咖啡/城市漫步/拍照/骑行/看展/看店，
// 全部走同一个共用组件 SceneShopDirectory）之前只有一行横滑的区域筛选
// chip，没有这套"点开一整页、能搜"的体验——用户要的是所有场景卡的弹出列表
// 共用同一套。
//
// 这里把 badminton-companion.tsx 里那套 UI 抽成通用组件，供 SceneShopDirectory
// （以及以后任何新场景卡）复用。不改 badminton-companion.tsx 本身——那份已经
// 经过用户认可、也有一整份钉在源码字符串上的测试，抽取等于重写它的测试，
// 风险跟收益不成比例；这里只保证"以后所有新接入的场景卡用同一份组件"。
//
// 这个组件只负责渲染内容，不自己套 Modal——iOS 一次只呈现一个 Modal，
// 调用方（SceneShopDirectory 等）本来就已经是一个 Modal，靠 state 切换
// 内容才是正确用法（同 badminton-companion.tsx 的 `screen` 状态机）。
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { color } from "../theme";
import { ProxyIcon } from "./proxy-icon";
import { ProxyIconButton, ProxyBackGlyph } from "./proxy-foundation";

export type LocationListSection = {
  title: string;
  hint?: string;
  items: readonly string[];
};

export function LocationListPicker({
  title,
  searchPlaceholder,
  sections,
  selected,
  markerItem,
  onToggle,
  onClear,
  onConfirm,
  onBack,
  footerLabel,
  bottomInset = 0,
}: {
  title: string;
  searchPlaceholder: string;
  sections: readonly LocationListSection[];
  selected: readonly string[];
  /** 当前定位命中的那一项——画一个定位点图标，跟 badminton 的「当前定位」同语义。 */
  markerItem?: string | undefined;
  onToggle: (item: string) => void;
  onClear: () => void;
  onConfirm: () => void;
  onBack: () => void;
  /** 底部左侧的选中态摘要文案，比如「已选 2 个区域」。留空就不画摘要文字。 */
  footerLabel: string;
  /** 安全区底距（useSafeAreaInsets().bottom），调用方传，本组件不假设自己在全屏页里。 */
  bottomInset?: number;
}): React.JSX.Element {
  const [keyword, setKeyword] = useState("");
  const allItems = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const section of sections) {
      for (const item of section.items) {
        if (!seen.has(item)) { seen.add(item); out.push(item); }
      }
    }
    return out;
  }, [sections]);
  const matches = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return [];
    return allItems.filter((item) => item.toLowerCase().includes(q));
  }, [allItems, keyword]);

  const chip = (item: string): React.JSX.Element => {
    const on = selected.includes(item);
    const located = item === markerItem;
    return (
      <Pressable
        accessibilityLabel={`${item}${on ? " 已选" : ""}`}
        key={item}
        onPress={() => onToggle(item)}
        style={[styles.chip, located && styles.chipLocated, on && styles.chipOn]}
      >
        {located ? <ProxyIcon color={on ? color.white : color.magenta} name="pin" size={11} /> : null}
        <Text selectable style={[styles.chipText, on && styles.chipTextOn]}>
          {item}
          {on ? " ✓" : ""}
        </Text>
      </Pressable>
    );
  };

  const section = (entry: LocationListSection): React.JSX.Element => (
    <View key={entry.title} style={styles.section}>
      <View style={styles.sectionHead}>
        <Text selectable style={styles.sectionTitle}>{entry.title}</Text>
        {entry.hint ? <Text selectable style={styles.sectionHint}>{entry.hint}</Text> : null}
      </View>
      <View style={styles.chips}>{entry.items.map((item) => chip(item))}</View>
    </View>
  );

  return (
    <>
      <View style={styles.topbar}>
        <ProxyIconButton accessibilityLabel="返回" onPress={onBack}>
          <ProxyBackGlyph />
        </ProxyIconButton>
        <Text selectable style={styles.topbarTitle}>{title}</Text>
        <Pressable accessibilityLabel="清空已选" onPress={onClear} style={styles.topbarAction}>
          <Text selectable style={styles.topbarActionText}>清空</Text>
        </Pressable>
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchBox}>
          <ProxyIcon color={color.muted} name="search" size={16} />
          <TextInput
            accessibilityLabel={searchPlaceholder}
            onChangeText={setKeyword}
            placeholder={searchPlaceholder}
            placeholderTextColor={color.muted}
            style={styles.searchInput}
            value={keyword}
          />
          {keyword.length > 0 ? (
            <Pressable accessibilityLabel="清空搜索" hitSlop={8} onPress={() => setKeyword("")} style={styles.searchClear}>
              <ProxyIcon color={color.muted} name="close" size={10} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollBody} keyboardShouldPersistTaps="handled">
        {keyword.trim().length > 0 ? (
          matches.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <ProxyIcon color={color.muted} name="search" size={26} />
              </View>
              <Text selectable style={styles.emptyTitle}>没有找到「{keyword.trim()}」</Text>
              <Text selectable style={styles.emptyDesc}>试试输入其他名称</Text>
            </View>
          ) : (
            section({ title: "搜索结果", hint: `${matches.length} 个匹配`, items: matches })
          )
        ) : (
          sections.map((entry) => section(entry))
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottomInset + 14 }]}>
        <Text selectable style={styles.footerInfo}>{footerLabel}</Text>
        <Pressable accessibilityLabel="完成选择" onPress={onConfirm} style={styles.btnPrimary}>
          <Text selectable style={styles.btnPrimaryText}>完成</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  topbar: { alignItems: "center", flexDirection: "row", gap: 12, paddingBottom: 10, paddingHorizontal: 18, paddingTop: 6 },
  topbarTitle: { color: color.ink, flex: 1, fontSize: 17, fontWeight: "900", letterSpacing: -0.3 },
  topbarAction: { paddingVertical: 6 },
  topbarActionText: { color: color.muted, fontSize: 13, fontWeight: "800" },
  searchWrap: { paddingBottom: 8, paddingHorizontal: 18 },
  searchBox: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1.5, flexDirection: "row", gap: 10, height: 44, paddingHorizontal: 14 },
  searchInput: { color: color.ink, flex: 1, fontSize: 13.5, fontWeight: "600", minWidth: 0, padding: 0 },
  searchClear: { alignItems: "center", backgroundColor: color.surface, borderRadius: 999, height: 18, justifyContent: "center", width: 18 },
  scrollBody: { paddingBottom: 90 },
  section: { paddingBottom: 18, paddingHorizontal: 18 },
  sectionHead: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between", paddingBottom: 10, paddingHorizontal: 4 },
  sectionTitle: { color: color.muted, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  sectionHint: { color: color.muted, fontSize: 11, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1.5, flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  chipLocated: { backgroundColor: color.attentionBg, borderColor: color.attentionBorder },
  chipOn: { backgroundColor: color.ink, borderColor: color.ink },
  chipText: { color: color.ink, fontSize: 13, fontWeight: "800", letterSpacing: -0.15 },
  chipTextOn: { color: color.white },
  empty: { alignItems: "center", paddingBottom: 40, paddingTop: 44 },
  emptyIcon: { alignItems: "center", backgroundColor: color.surface, borderRadius: 22, height: 72, justifyContent: "center", marginBottom: 16, width: 72 },
  emptyTitle: { color: color.ink, fontSize: 15, fontWeight: "900", marginBottom: 8 },
  emptyDesc: { color: color.muted, fontSize: 12.5, fontWeight: "600", lineHeight: 19, marginBottom: 18, maxWidth: 240, textAlign: "center" },
  footer: { alignItems: "center", backgroundColor: color.offWhite, borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", gap: 10, paddingHorizontal: 18, paddingTop: 14 },
  footerInfo: { color: color.muted, flex: 1, fontSize: 11.5, fontWeight: "700", lineHeight: 17 },
  btnPrimary: { alignItems: "center", backgroundColor: color.ink, borderRadius: 15, height: 50, justifyContent: "center", paddingHorizontal: 24 },
  btnPrimaryText: { color: color.white, fontSize: 14.5, fontWeight: "900", letterSpacing: -0.2 },
});
