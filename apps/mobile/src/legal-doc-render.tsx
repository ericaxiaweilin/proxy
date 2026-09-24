import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { color, shadows } from "./theme";
import { extractToc, parseLegalDoc, type LegalBlock, type LegalBlockHeading, type LegalBlockList, type LegalBlockParagraph, type LegalBlockSpacer } from "./legal-doc-parser";

// R15.x+ (P0 协议字体/排版 audit) — legal doc 渲染组件。
//
// 字体选择 (系统自带 / fallback, 零字体加载, 零 licensing 风险):
//   iOS:    "New York" (Apple 官方系统 serif)
//   Android: "serif" (fallback 到 Noto Serif, Google 官方)
//   Web:    Charter / Georgia / serif
//
// 解析在 legal-doc-parser.ts (纯函数, vitest 单测)。本文件只负责
// 把 block 数组渲染成 RN <View>/<Text>，并提供顶层 TOC 横向滚动。

export type { LegalBlock, LegalBlockHeading, LegalBlockList, LegalBlockParagraph, LegalBlockSpacer };
export { parseLegalDoc, extractToc };

const SERIF = Platform.select({
  ios: "New York",
  android: "serif",
  default: "serif"
});

export type LegalDocRendererProps = {
  content: string;
  /** Optional TOC press callback (anchor id) */
  onJumpToAnchor?: (anchor: string) => void;
};

export function LegalDocRenderer({ content, onJumpToAnchor }: LegalDocRendererProps): React.JSX.Element {
  const blocks = parseLegalDoc(content);
  const toc = extractToc(blocks);
  return (
    <View>
      {toc.length > 1 ? <TocBar toc={toc} onJumpToAnchor={onJumpToAnchor} /> : null}
      {blocks.map((block, index) => renderBlock(block, index))}
    </View>
  );
}

function renderBlock(block: LegalBlock, key: number): React.JSX.Element {
  switch (block.type) {
    case "heading":
      return (
        <View key={key} nativeID={block.anchor} style={styles.headingWrap}>
          <Text selectable style={styles.headingNumber}>{block.number}.</Text>
          <Text selectable style={styles.headingTitle}>{block.title}</Text>
        </View>
      );
    case "list":
      return (
        <View key={key} style={styles.listWrap}>
          {block.items.map((item, idx) => (
            <View key={idx} style={styles.listItem}>
              <Text selectable style={styles.bulletDot}>•</Text>
              <Text selectable style={styles.listText}>{item}</Text>
            </View>
          ))}
        </View>
      );
    case "paragraph":
      return (
        <Text selectable key={key} style={styles.paragraph}>
          {block.text}
        </Text>
      );
    case "spacer":
      return <View key={key} style={styles.spacer} />;
  }
}

function TocBar({ toc, onJumpToAnchor }: { toc: ReadonlyArray<{ number: string; title: string; anchor: string }>; onJumpToAnchor: ((anchor: string) => void) | undefined }): React.JSX.Element {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.tocBar}
      style={styles.tocBarScroll}
    >
      {toc.map((entry) => (
        <Text selectable
          key={entry.anchor}
          accessibilityRole={onJumpToAnchor ? "button" : undefined}
          onPress={onJumpToAnchor ? () => onJumpToAnchor(entry.anchor) : undefined}
          style={styles.tocEntry}
        >
          {entry.number}. {entry.title}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // === Typography (行业 ToS 共识) ===
  // fontSize 15: 比系统 ToS 17pt 小一点 (R3 mobile-first)，但比现状
  // 13 大 2pt。lineHeight 24 = 1.6 (法务推荐范围下沿)。
  paragraph: {
    color: color.ink,
    fontFamily: SERIF,
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 12
  },
  spacer: {
    height: 4
  },
  // === Heading: serif bold + 数字 + 标题 + section anchor ===
  headingWrap: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: 24,
    marginBottom: 10
  },
  headingNumber: {
    color: color.violet,
    fontFamily: SERIF,
    fontSize: 18,
    fontWeight: "800",
    marginRight: 8
  },
  headingTitle: {
    color: color.ink,
    flex: 1,
    fontFamily: SERIF,
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 24
  },
  // === List ===
  listWrap: {
    marginBottom: 12,
    paddingLeft: 8
  },
  listItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 4
  },
  bulletDot: {
    color: color.violet,
    fontFamily: SERIF,
    fontSize: 15,
    lineHeight: 24,
    marginRight: 8
  },
  listText: {
    color: color.ink,
    flex: 1,
    fontFamily: SERIF,
    fontSize: 15,
    lineHeight: 24
  },
  // === TOC: horizontal scroll at top, sticky via ScrollView parent ===
  tocBarScroll: {
    backgroundColor: color.surface,
    borderRadius: 10,
    marginBottom: 20,
    maxHeight: 44,
    ...shadows.nav
  },
  tocBar: {
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  tocEntry: {
    color: color.violet,
    fontFamily: SERIF,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginRight: 14
  }
});
