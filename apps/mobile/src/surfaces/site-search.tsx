// SITE-SEARCH-001：全站搜索页。首页 / 动态 / 消息 / 我的 / 场景 / 市场的「搜索」按钮
// 最后都落到这一页——同一句话同时问 人 / 活动 / 场景 / 机会 / 我的订单 / 动态。
//
// 这一页只管「问、排、画」，不管「点了去哪」：点某一行只回调 onSelect(hit)，导航由壳
// （shell/app-shell.tsx）决定——人 → 他人主页、活动 → 活动详情、场景 → 场景地图、
// 机会 → 市场、订单 → 我的订单、动态 → 动态页。这样返回时壳可以把搜索页留在原处
// （query / scope 存在壳里），用户看完详情按返回就回到同一份结果。
//
// 诚实空态：某个来源出错 / 访客搜不了 / 词太短，都在结果上方如实说，
// 绝不把「没查」画成「没有」（见 site-search-service.ts 头注）。
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { color } from "../theme";
import { useI18n, type MessageKey } from "../i18n";
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import { ProxyBackGlyph } from "../components/proxy-foundation";
import { kindsToSearch, runSiteSearch, type SiteSearchOutcome, type SiteSearchSources } from "../site-search-service";
import {
  groupSiteSearchHits,
  isNumberQuery,
  SITE_SEARCH_KINDS,
  type SiteSearchBadge,
  type SiteSearchHit,
  type SiteSearchKind,
  type SiteSearchScope,
} from "../site-search";

/** 边输边搜的防抖。首次进入、切范围、点重试都不等。 */
export const SITE_SEARCH_DEBOUNCE_MS = 250;

const KIND_LABEL: Readonly<Record<SiteSearchKind, MessageKey>> = {
  person: "siteSearchScopePerson",
  activity: "siteSearchScopeActivity",
  place: "siteSearchScopePlace",
  opportunity: "siteSearchScopeOpportunity",
  order: "siteSearchScopeOrder",
  post: "siteSearchScopePost",
};

const KIND_ICON: Readonly<Record<SiteSearchKind, ProxyIconName>> = {
  person: "user",
  activity: "sparkle",
  place: "pin",
  opportunity: "diamond",
  order: "ticket",
  post: "postsGrid",
};

const BADGE_LABEL: Readonly<Record<SiteSearchBadge, MessageKey>> = {
  OWNED: "siteSearchBadgeOwned",
  OFFERED: "siteSearchBadgePending",
  REQUESTED: "siteSearchBadgePending",
  CONFIRMED: "siteSearchBadgeConfirmed",
  EXECUTING: "siteSearchBadgeOngoing",
  COMPLETED: "siteSearchBadgeCompleted",
  CANCELLED: "siteSearchBadgeCancelled",
  WAITLISTED: "siteSearchBadgeWaitlisted",
  ATTENDED: "siteSearchBadgeAttended",
  NO_SHOW: "siteSearchBadgeNoShow",
};

export function SiteSearchSurface({
  initialQuery,
  initialScope,
  sources,
  onQueryChange,
  onScopeChange,
  onBack,
  onSelect,
}: {
  initialQuery: string;
  initialScope: SiteSearchScope;
  sources: SiteSearchSources;
  /** 壳记住最新的词 / 范围，从详情页返回时原样恢复。 */
  onQueryChange: (query: string) => void;
  onScopeChange: (scope: SiteSearchScope) => void;
  onBack: () => void;
  onSelect: (hit: SiteSearchHit) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [text, setText] = useState(initialQuery);
  const [scope, setScope] = useState<SiteSearchScope>(initialScope);
  const [outcome, setOutcome] = useState<SiteSearchOutcome>();
  const [retryNonce, setRetryNonce] = useState(0);
  const sequence = useRef(0);
  // 只有「打字」才防抖；其余触发（首次、切范围、重试）立刻搜。
  const delayRef = useRef(0);

  const query = text.trim();

  useEffect(() => {
    const mine = (sequence.current += 1);
    if (query === "") {
      setOutcome(undefined);
      return undefined;
    }
    const delay = delayRef.current;
    delayRef.current = 0;
    const timer = setTimeout(() => {
      runSiteSearch(sources, query, scope)
        .then((result) => { if (sequence.current === mine) setOutcome(result); })
        .catch(() => {
          // runSiteSearch 自己吞了各来源的错；走到这里是编程错误。仍不能留一个永远转圈的页面。
          if (sequence.current === mine) {
            setOutcome({ query, scope, hits: [], failed: [...kindsToSearch(scope, query)], needsLogin: [], tooShort: [] });
          }
        });
    }, delay);
    return () => clearTimeout(timer);
  }, [query, scope, sources, retryNonce]);

  // 只有「和当前输入对得上」的结果才算新鲜；对不上的（正在搜新词）继续显示但变淡。
  const current = outcome !== undefined && outcome.query === query && outcome.scope === scope ? outcome : undefined;
  const loading = query !== "" && current === undefined;
  const groups = useMemo(
    () => (outcome ? groupSiteSearchHits(outcome.hits, outcome.scope, outcome.query) : []),
    [outcome],
  );

  const changeText = (next: string): void => {
    delayRef.current = SITE_SEARCH_DEBOUNCE_MS;
    setText(next);
    onQueryChange(next);
  };
  const changeScope = (next: SiteSearchScope): void => {
    setScope(next);
    onScopeChange(next);
  };
  const kindsText = (kinds: readonly SiteSearchKind[]): string =>
    kinds.map((kind) => t(KIND_LABEL[kind])).join(t("siteSearchListSep"));

  const scopes: readonly SiteSearchScope[] = ["all", ...SITE_SEARCH_KINDS];
  const scopeLabel = (value: SiteSearchScope): string => (value === "all" ? t("siteSearchScopeAll") : t(KIND_LABEL[value]));

  return (
    <View style={styles.root}>
      <View style={styles.topbar}>
        <Pressable accessibilityLabel={t("back")} hitSlop={8} onPress={onBack} style={styles.iconButton}>
          <ProxyBackGlyph />
        </Pressable>
        <View style={styles.searchBox}>
          <ProxyIcon color={color.muted} name="search" size={17} />
          <TextInput
            accessibilityLabel={t("siteSearchPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            onChangeText={changeText}
            onSubmitEditing={() => setRetryNonce((n) => n + 1)}
            placeholder={t("siteSearchPlaceholder")}
            placeholderTextColor={color.muted}
            returnKeyType="search"
            style={styles.searchInput}
            value={text}
          />
          {text !== "" ? (
            <Pressable accessibilityLabel={t("clearSearch")} hitSlop={8} onPress={() => changeText("")}>
              <Text selectable style={styles.clear}>×</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scopeRail} contentContainerStyle={styles.scopeRailContent}>
        {scopes.map((value) => (
          <Pressable
            key={value}
            accessibilityLabel={scopeLabel(value)}
            accessibilityState={{ selected: scope === value }}
            onPress={() => changeScope(value)}
            style={[styles.scopeChip, scope === value && styles.scopeChipOn]}
          >
            <Text selectable style={[styles.scopeText, scope === value && styles.scopeTextOn]}>{scopeLabel(value)}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={styles.results} contentContainerStyle={styles.resultsContent}>
        {query === "" ? (
          <View style={styles.stateBlock}>
            <Text selectable style={styles.stateText}>{t("siteSearchIdle")}</Text>
            <Text selectable style={styles.stateSub}>{t("siteSearchIdleNumber")}</Text>
          </View>
        ) : null}

        {loading ? <Text selectable style={styles.searching}>{t("siteSearchSearching", { q: query })}</Text> : null}

        {current && current.failed.length > 0 ? (
          <View style={[styles.note, styles.noteWarn]}>
            <Text selectable style={styles.noteText}>{t("siteSearchFailed", { kinds: kindsText(current.failed) })}</Text>
            <Pressable accessibilityLabel={t("siteSearchRetry")} onPress={() => setRetryNonce((n) => n + 1)} style={styles.retry}>
              <Text selectable style={styles.retryText}>{t("siteSearchRetry")}</Text>
            </Pressable>
          </View>
        ) : null}
        {current && current.needsLogin.length > 0 ? (
          <View style={styles.note}>
            <Text selectable style={styles.noteText}>{t("siteSearchNeedsLogin", { kinds: kindsText(current.needsLogin) })}</Text>
          </View>
        ) : null}
        {current && current.tooShort.length > 0 ? (
          <View style={styles.note}>
            <Text selectable style={styles.noteText}>{t("siteSearchTooShort")}</Text>
          </View>
        ) : null}

        {current && current.hits.length === 0 && current.failed.length === 0 ? (
          <View style={styles.stateBlock}>
            <Text selectable style={styles.stateText}>{t("notFoundQuery", { q: query })}</Text>
            <Text selectable style={styles.stateSub}>{t("siteSearchEmptySub")}</Text>
          </View>
        ) : null}

        <View style={loading ? styles.stale : undefined}>
          {groups.map((group) => (
            <View key={group.kind} style={styles.group}>
              <View style={styles.groupHead}>
                <ProxyIcon color={color.muted} name={KIND_ICON[group.kind]} size={14} />
                <Text selectable style={styles.groupTitle}>{t(KIND_LABEL[group.kind])}</Text>
                <Text selectable style={styles.groupCount}>{group.total}</Text>
                {group.hasMore ? (
                  <Pressable accessibilityLabel={t("siteSearchSeeAll", { n: group.total })} hitSlop={8} onPress={() => changeScope(group.kind)} style={styles.seeAll}>
                    <Text selectable style={styles.seeAllText}>{t("siteSearchSeeAll", { n: group.total })}</Text>
                  </Pressable>
                ) : null}
              </View>
              {group.hits.map((hit) => (
                <Pressable key={hit.key} accessibilityLabel={hit.title} onPress={() => onSelect(hit)} style={styles.row}>
                  <View style={styles.rowIcon}>
                    <ProxyIcon color={color.ink} name={KIND_ICON[hit.kind]} size={17} />
                  </View>
                  <View style={styles.rowBody}>
                    <Text numberOfLines={1} selectable style={styles.rowTitle}>{hit.title}</Text>
                    {hit.subtitle !== "" ? <Text numberOfLines={hit.kind === "post" ? 2 : 1} selectable style={styles.rowSub}>{hit.subtitle}</Text> : null}
                    {hit.number ? <Text numberOfLines={1} selectable style={[styles.rowSub, isNumberQuery(query) && styles.rowNumberHit]}>{t("siteSearchNumber", { n: hit.number })}</Text> : null}
                  </View>
                  {hit.badge ? (
                    <View style={styles.badge}>
                      <Text selectable style={styles.badgeText}>{t(BADGE_LABEL[hit.badge])}</Text>
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  topbar: { alignItems: "center", flexDirection: "row", gap: 10, paddingBottom: 8, paddingHorizontal: 16, paddingTop: 2 },
  iconButton: { alignItems: "center", backgroundColor: color.surface, borderRadius: 20, height: 40, justifyContent: "center", width: 40 },
  searchBox: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 15, borderWidth: 1, flex: 1, flexDirection: "row", gap: 8, paddingHorizontal: 12 },
  searchInput: { color: color.ink, flex: 1, fontSize: 15, height: 44 },
  clear: { color: color.muted, fontSize: 20, paddingHorizontal: 4 },
  scopeRail: { flexGrow: 0 },
  scopeRailContent: { gap: 8, paddingBottom: 10, paddingHorizontal: 16 },
  scopeChip: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 7 },
  scopeChipOn: { backgroundColor: color.ink, borderColor: color.ink },
  scopeText: { color: color.muted, fontSize: 12.5, fontWeight: "900" },
  scopeTextOn: { color: color.white },
  results: { flex: 1 },
  resultsContent: { paddingBottom: 40, paddingHorizontal: 16 },
  stateBlock: { alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 48 },
  stateText: { color: color.ink, fontSize: 14, fontWeight: "800", textAlign: "center" },
  stateSub: { color: color.muted, fontSize: 12.5, fontWeight: "700", textAlign: "center" },
  searching: { color: color.muted, fontSize: 12.5, fontWeight: "700", paddingVertical: 8 },
  stale: { opacity: 0.45 },
  note: { alignItems: "center", backgroundColor: color.surface, borderRadius: 12, flexDirection: "row", gap: 10, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 10 },
  noteWarn: { backgroundColor: color.stateWarnBg, borderColor: color.stateWarnBorder, borderWidth: 1 },
  noteText: { color: color.ink, flex: 1, fontSize: 12.5, fontWeight: "700", lineHeight: 17 },
  retry: { backgroundColor: color.ink, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  retryText: { color: color.white, fontSize: 12, fontWeight: "900" },
  group: { marginBottom: 14 },
  groupHead: { alignItems: "center", flexDirection: "row", gap: 6, paddingBottom: 6, paddingTop: 4 },
  groupTitle: { color: color.ink, fontSize: 13.5, fontWeight: "900" },
  groupCount: { color: color.muted, fontSize: 12, fontWeight: "800" },
  seeAll: { marginLeft: "auto" },
  seeAllText: { color: color.violet, fontSize: 12, fontWeight: "900" },
  row: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 12, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 11 },
  rowIcon: { alignItems: "center", backgroundColor: color.surface, borderRadius: 12, height: 34, justifyContent: "center", width: 34 },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { color: color.ink, fontSize: 14.5, fontWeight: "900" },
  rowSub: { color: color.muted, fontSize: 12, fontWeight: "700", lineHeight: 16 },
  rowNumberHit: { color: color.ink, fontWeight: "900" },
  badge: { backgroundColor: color.surface, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: color.ink, fontSize: 11, fontWeight: "900" },
});
