import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { color } from "../theme";
import { styles } from "./me-styles";
import type { StoreRecommendation } from "../storeonboarding-client";
import { ProxyLoading } from "../components/proxy-foundation";
import {
  REC_FILTERS,
  REC_STATUS_TEXT,
  countRecs,
  filterRecs,
  highlight,
  recAccent,
  recDay,
  recInitial,
  recNextStep,
  recStages,
  recStatus,
  type RecAccent,
  type RecFilter,
  type RecSegment,
  type RecStageState,
  type RecStatus
} from "./store-recommendation-manage-model";

// STORE-REC-007 / STORE-REC-MANAGE-001: 「我推荐的店」列表屏。
//
// 为什么必须存在：运营队列是 operator-only，普通用户看不到。于是推荐人提交完
// 就再无回音，永远不知道自己推荐的那家店被采纳了没有。
//
// 而**能完成入驻的人通常就是他**：采纳只代表运营批准接入，**不等于店铺已存在**。
// 他看不到「该去建店了」，那条「已采纳 · 待接入」的记录就永远等不到人 ——
// 队列看起来办结了，事情却没发生。这一屏就是把这句话送到该看到的人眼前。
//
// 纪律沿用队列那一套：**「读不出来」和「确实没有」必须长不一样**。
// 两者列表都为空，混在一起会让人以为「我没推荐过」。
//
// 取数在 StoreRecommendationManage 那一层（页签徽标也要用同一份数据），
// 这里只负责把 rows 画出来 + 本地搜索/筛选，所以它是纯展示组件。

export interface MyStoreRecommendationsProps {
  rows: readonly StoreRecommendation[] | null;
  busy: boolean;
  error?: string | undefined;
  onRetry: () => void;
  onOpenDetail: (row: StoreRecommendation) => void;
}

// 首字母色块 / 状态药丸 / 进度点。键都是有限枚举，所以这里用 Record<Union, T>
// 而不是 Record<string, T> —— 后者在 noUncheckedIndexedAccess 下每次取都带
// undefined，逼出一堆 ?? 兜底，兜底本身又变成一处「不可能发生」的死代码。
const ACCENT: Record<RecAccent, { bg: string; fg: string }> = {
  lime: { bg: "#EAF7B8", fg: "#4A5C00" },
  rose: { bg: "#F7DDE3", fg: "#7A2434" },
  sky: { bg: "#DCE8F7", fg: "#1E4574" },
  gold: { bg: "#F6E7BE", fg: "#6B5300" }
};

const PILL: Record<RecStatus, { bg: string; fg: string }> = {
  PENDING: { bg: color.warn, fg: "#7A5B00" },
  ACCEPTED: { bg: color.proxyGreenSoft, fg: "#0F7A3D" },
  REJECTED: { bg: color.stateDangerBg, fg: color.error }
};

const DOT: Record<RecStageState, string> = {
  done: color.proxyGreen,
  active: "#E8A23C",
  fail: color.error,
  todo: color.line
};

function Highlighted({ segments, style, hitStyle }: {
  segments: RecSegment[];
  style: object;
  hitStyle: object;
}): React.JSX.Element {
  return (
    <Text numberOfLines={1} selectable style={style}>
      {segments.map((segment, index) => (
        <Text key={index} style={segment.hit ? hitStyle : undefined}>
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}

export function MyStoreRecommendations({
  rows,
  busy,
  error,
  onRetry,
  onOpenDetail
}: MyStoreRecommendationsProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RecFilter>("ALL");

  const searching = query.trim().length > 0;
  const counts = countRecs(rows ?? []);
  const visible = filterRecs(rows ?? [], filter, query);

  return (
    <View>
      <View style={s.searchRow}>
        <TextInput
          accessibilityLabel="搜索我推荐的店"
          placeholder="搜索店名、城市、品类"
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
        />
        {searching ? (
          <Pressable accessibilityLabel="清空搜索" onPress={() => setQuery("")} style={s.searchClear}>
            <Text selectable style={s.searchClearText}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      {searching ? (
        <View style={s.resultBar}>
          <Text selectable style={s.resultText}>
            找到 <Text style={s.resultCount}>{visible.length}</Text> 条包含「{query.trim()}」的记录
          </Text>
          <Pressable onPress={() => { setQuery(""); setFilter("ALL"); }} style={s.resultReset}>
            <Text selectable style={s.resultResetText}>重置</Text>
          </Pressable>
        </View>
      ) : (
        <View style={s.overview}>
          <View style={s.ovItem}>
            <Text selectable style={s.ovValue}>{counts.total}</Text>
            <Text selectable style={s.ovLabel}>已推荐</Text>
          </View>
          <View style={s.ovItem}>
            <Text selectable style={s.ovValue}>{counts.accepted}</Text>
            <Text selectable style={s.ovLabel}>已采纳</Text>
          </View>
          <View style={s.ovItem}>
            <Text selectable style={s.ovValue}>{counts.pending}</Text>
            <Text selectable style={s.ovLabel}>待评估</Text>
          </View>
        </View>
      )}

      <View style={s.chips}>
        {REC_FILTERS.map((option) => {
          const active = filter === option.id;
          const n =
            option.id === "ALL"
              ? counts.total
              : option.id === "PENDING"
                ? counts.pending
                : option.id === "ACCEPTED"
                  ? counts.accepted
                  : counts.rejected;
          return (
            <Pressable
              key={option.id}
              onPress={() => setFilter(option.id)}
              style={[s.chip, active && s.chipOn]}
            >
              <Text selectable style={[s.chipText, active && s.chipTextOn]}>
                {option.label} {n}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {busy && rows === null ? (
        <View style={s.loading}>
          <ProxyLoading tone="muted" />
        </View>
      ) : null}

      {error ? <Text selectable style={s.error}>{error}</Text> : null}

      {/* 「读不出来」和「确实没有」必须长不一样：两者列表都为空。 */}
      {!error && rows !== null && rows.length === 0 ? (
        <View style={styles.infoNote}>
          <Text selectable style={styles.infoNoteText}>你还没有推荐过店铺。</Text>
        </View>
      ) : null}

      {!error && rows !== null && rows.length > 0 && visible.length === 0 ? (
        <View style={styles.infoNote}>
          <Text selectable style={styles.infoNoteText}>
            没有匹配的记录{searching ? "，换个关键词" : ""}
            {searching && filter !== "ALL" ? "，或" : ""}
            {filter !== "ALL" ? "切到「全部」筛选" : ""}。
          </Text>
        </View>
      ) : null}

      {visible.map((row) => {
        const status = recStatus(row);
        const accent = ACCENT[recAccent(row.storeName)];
        const pill = PILL[status];
        const stages = recStages(row);
        return (
          <Pressable
            accessibilityLabel={`查看推荐详情 ${row.storeName}`}
            accessibilityRole="button"
            key={row.recommendationId}
            onPress={() => onOpenDetail(row)}
            style={s.card}
          >
            <View style={s.cardHead}>
              <View style={[s.cover, { backgroundColor: accent.bg }]}>
                <Text selectable style={[s.coverText, { color: accent.fg }]}>
                  {recInitial(row.storeName)}
                </Text>
              </View>
              <View style={s.cardMain}>
                <Highlighted
                  segments={highlight(row.storeName, query)}
                  style={s.cardName}
                  hitStyle={s.hit}
                />
                <Highlighted
                  segments={highlight([row.city, row.category].filter(Boolean).join(" · "), query)}
                  style={s.cardMeta}
                  hitStyle={s.hit}
                />
              </View>
              <Text selectable style={[s.pill, { backgroundColor: pill.bg, color: pill.fg }]}>
                {REC_STATUS_TEXT[status]}
              </Text>
            </View>

            <View style={s.dots}>
              {stages.map((stage) => (
                <View key={stage.id} style={[s.dot, { backgroundColor: DOT[stage.state] }]} />
              ))}
            </View>

            <View style={s.cardFoot}>
              <Text selectable style={s.cardTime}>提交于 {recDay(row.createdAt)}</Text>
              <Text selectable style={[s.cardNext, status === "REJECTED" && s.cardNextMuted]}>
                {recNextStep(row)}
              </Text>
            </View>
          </Pressable>
        );
      })}

      <Pressable
        disabled={busy}
        onPress={onRetry}
        style={[styles.appBehaviorReturn, { marginTop: 12 }, busy && { opacity: 0.5 }]}
      >
        <Text selectable style={styles.appBehaviorReturnText}>{busy ? "读取中…" : "刷新"}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  searchRow: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 4 },
  searchInput: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 13,
    borderWidth: 1.5,
    color: color.ink,
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  searchClear: {
    alignItems: "center",
    backgroundColor: color.surface,
    borderRadius: 999,
    height: 28,
    justifyContent: "center",
    width: 28
  },
  searchClearText: { color: color.muted, fontSize: 12, fontWeight: "900" },
  resultBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10
  },
  resultText: { color: color.muted, flex: 1, fontSize: 11, fontWeight: "700" },
  resultCount: { color: color.ink, fontSize: 11, fontWeight: "900" },
  resultReset: {
    backgroundColor: color.surface,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  resultResetText: { color: color.ink, fontSize: 11, fontWeight: "800" },

  overview: {
    backgroundColor: color.ink,
    borderRadius: 18,
    flexDirection: "row",
    marginTop: 12,
    paddingVertical: 16
  },
  ovItem: { alignItems: "center", flex: 1 },
  ovValue: { color: color.lime, fontSize: 24, fontWeight: "900", lineHeight: 28 },
  ovLabel: { color: color.darkCardText, fontSize: 11, fontWeight: "700", marginTop: 2 },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  chip: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  chipOn: { backgroundColor: color.ink, borderColor: color.ink },
  chipText: { color: color.muted, fontSize: 11, fontWeight: "800" },
  chipTextOn: { color: color.white },

  loading: { alignItems: "center", paddingVertical: 18 },
  error: { color: color.error, fontSize: 12, marginTop: 8 },

  card: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 12,
    padding: 14
  },
  cardHead: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  cover: {
    alignItems: "center",
    borderRadius: 14,
    height: 50,
    justifyContent: "center",
    width: 50
  },
  coverText: { fontSize: 16, fontWeight: "900" },
  cardMain: { flex: 1, minWidth: 0 },
  cardName: { color: color.ink, fontSize: 14, fontWeight: "900", lineHeight: 19 },
  cardMeta: { color: color.muted, fontSize: 11, fontWeight: "600", lineHeight: 15, marginTop: 4 },
  hit: { backgroundColor: "#EAF7B8", color: "#4A5C00", fontWeight: "900" },
  pill: {
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 4
  },
  dots: { flexDirection: "row", gap: 5, marginTop: 12 },
  dot: { borderRadius: 2, flex: 1, height: 3 },
  cardFoot: {
    alignItems: "center",
    borderTopColor: color.line,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 10
  },
  cardTime: { color: color.muted, fontSize: 11, fontWeight: "700" },
  cardNext: { color: "#0F7A3D", flex: 1, fontSize: 11, fontWeight: "900", textAlign: "right" },
  cardNextMuted: { color: color.muted }
});
