// Tasks Surface（稳定 Surface：任务 tab）。
// 视觉基线：Proxy_P0_Prototype_R15_11_0_Social_Baseline_Launch_Candidate.html
// （taskmainnav 需求/活动 + taskaction 深色发布卡 + 进行中 service 行 + 收费需求示例
// activityfeedcard + 已完成行），刻度按 R15.11 Social Baseline 对齐。
// 功能接线：进行中任务 → FulfillmentWorkspace；发布需求 → 回 Home 打开创建链；
// 需求/活动 切换为屏内视图（活动页 = 基线 activityhub：intro + filters + activityfeedcard）。
// 新架构（服务端驱动）：活动读模型来自 ListActivities，感兴趣/参加走命令，计数服务端权威。
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Activity, TasksExperienceParams } from "@proxy/contracts";
import { type ActivityClient } from "../activity-client";
import { color, Gradient, shadows } from "../theme";
import type { WorkspaceTarget } from "./fulfillment-workspace";

interface TaskRow {
  glyph: string;
  grad: boolean;
  label: string;
  desc: string;
  target?: WorkspaceTarget;
}

const IN_PROGRESS: TaskRow[] = [
  {
    glyph: "•",
    grad: true,
    label: "周六新店开业",
    desc: "正在匹配 · 5 个名额已完成 4 个",
    target: { category: "FNB_RETAIL", goal: "周六新店开业：现场接待与流程支持，复用上次开业团队。" }
  },
  {
    glyph: "!",
    grad: false,
    label: "下周客户拜访",
    desc: "地点变化 · 等你确认",
    target: { category: "BUSINESS_PRO", goal: "下周客户拜访：地点发生变化，需要确认新的会面安排。" }
  }
];

const DONE: TaskRow[] = [
  { glyph: "✓", grad: false, label: "上次新店开业", desc: "结果已完成 · 可查看结果" }
];

// 活动目录来自服务端读模型（ListActivities；内容数据不在前端内嵌）。
type ActivityFilter = "RECOMMENDED" | "CAFE" | "RESTAURANT" | "MINE";

const ORIGIN_META: Record<Activity["origin"], { label: string; bg: string; fg: string }> = {
  PLATFORM: { label: "Proxy 特别活动", bg: "#EEE6FF", fg: "#5D32A4" },
  MERCHANT: { label: "商家活动", bg: "#F1FFD1", fg: "#445C00" },
  USER: { label: "用户发起", bg: "#EAF8F4", fg: "#176F60" }
};

const ACTIVITY_FILTERS: ReadonlyArray<{ id: ActivityFilter; label: string }> = [
  { id: "RECOMMENDED", label: "推荐" },
  { id: "CAFE", label: "咖啡" },
  { id: "RESTAURANT", label: "餐厅" },
  { id: "MINE", label: "我的活动" }
];

export function TasksSurface({
  activities,
  entry = { view: "NEED" },
  onEnterWorkspace,
  onPublishNeed
}: {
  activities: ActivityClient;
  entry?: TasksExperienceParams;
  onEnterWorkspace: (target: WorkspaceTarget) => void;
  onPublishNeed: () => void;
}): React.JSX.Element {
  const [view, setView] = useState<"NEED" | "ACTIVITY" | "DETAIL">(
    entry.view === "ACTIVITY" ? "ACTIVITY" : "NEED"
  );
  const [filter, setFilter] = useState<ActivityFilter>(
    entry.view === "ACTIVITY" ? entry.filter ?? "RECOMMENDED" : "RECOMMENDED"
  );
  const [detailId, setDetailId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"LOADING" | "READY" | "ERROR">("LOADING");
  const [items, setItems] = useState<Activity[]>([]);
  const [interestedIn, setInterestedIn] = useState<ReadonlySet<string>>(new Set());
  const [joinedIds, setJoinedIds] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // 挂载时拉取服务端活动读模型（ListActivities）；失败不回落本地内容。
  const loadActivities = useCallback(async (): Promise<void> => {
    setPhase("LOADING");
    try {
      const read = await activities.listActivities();
      setItems(read);
      setPhase("READY");
    } catch {
      setPhase("ERROR");
    }
  }, [activities]);

  useEffect(() => {
    void loadActivities();
  }, [loadActivities]);

  useEffect(() => {
    if (entry.view === "ACTIVITY") {
      setView("ACTIVITY");
      setFilter(entry.filter ?? "RECOMMENDED");
      return;
    }

    setView("NEED");
    setFilter("RECOMMENDED");
  }, [entry]);

  function openDetail(item: Activity): void {
    setDetailId(item.activityId);
    setView("DETAIL");
  }

  /** 用命令返回的服务端权威活动对象覆盖本地读模型。 */
  function upsertActivity(next: Activity): void {
    setItems((current) => current.map((entry) => (entry.activityId === next.activityId ? next : entry)));
  }

  async function toggleInterest(activityId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const { activity, interested } = await activities.toggleInterest(activityId);
      upsertActivity(activity);
      const next = new Set(interestedIn);
      if (interested) next.add(activityId);
      else next.delete(activityId);
      setInterestedIn(next);
    } catch {
      // fail-closed：命令失败保持原状态
    } finally {
      setBusy(false);
    }
  }

  async function joinActivity(activityId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const { activity } = await activities.join(activityId);
      upsertActivity(activity);
      const next = new Set(joinedIds);
      next.add(activityId);
      setJoinedIds(next);
    } catch {
      // fail-closed：命令失败保持原状态
    } finally {
      setBusy(false);
    }
  }

  const detailItem = detailId ? items.find((entry) => entry.activityId === detailId) ?? null : null;

  const visible = items.filter((item) => {
    if (filter === "CAFE") return item.venueType === "CAFE";
    if (filter === "RESTAURANT") return item.venueType === "RESTAURANT";
    if (filter === "MINE") return joinedIds.has(item.activityId) || interestedIn.has(item.activityId);
    return true;
  });

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {/* 基线 .taskmainnav：surface 底、radius 14、内白激活胶囊 */}
      <View style={styles.mainNav}>
        <Pressable onPress={() => setView("NEED")} style={[view === "NEED" ? styles.mainNavOn : styles.mainNavOff, view === "NEED" && styles.mainNavShadow]}>
          <Text style={view === "NEED" ? styles.mainNavOnText : styles.mainNavOffText}>需求</Text>
        </Pressable>
        <Pressable onPress={() => setView("ACTIVITY")} style={[view !== "NEED" ? styles.mainNavOn : styles.mainNavOff, view !== "NEED" && styles.mainNavShadow]}>
          <Text style={view !== "NEED" ? styles.mainNavOnText : styles.mainNavOffText}>活动</Text>
        </Pressable>
      </View>

      {view === "DETAIL" && detailItem ? (
        <ActivityDetail
          item={detailItem}
          interested={interestedIn.has(detailItem.activityId)}
          joined={joinedIds.has(detailItem.activityId)}
          busy={busy}
          onToggleInterested={() => void toggleInterest(detailItem.activityId)}
          onJoin={() => void joinActivity(detailItem.activityId)}
          onBack={() => setView("ACTIVITY")}
        />
      ) : view === "ACTIVITY" ? (
        <>
          {/* 基线 .activityintro：h2 一起做点什么 + 发起活动 */}
          <View style={styles.activityIntro}>
            <View style={styles.activityIntroCopy}>
              <Text style={styles.activityIntroTitle}>一起做点什么</Text>
              <Text style={styles.activityIntroBody}>选一个活动，再去真实的咖啡店或餐厅见面。</Text>
            </View>
            <Pressable style={styles.activityIntroCta}>
              <Text style={styles.activityIntroCtaText}>发起活动</Text>
            </Pressable>
          </View>

          {/* 基线 .activityfilters：推荐 / 咖啡 / 餐厅 / 我的活动 */}
          <View style={styles.activityFilters}>
            {ACTIVITY_FILTERS.map((entry) => {
              const active = filter === entry.id;
              return (
                <Pressable key={entry.id} onPress={() => setFilter(entry.id)} style={[styles.activityFilter, active && styles.activityFilterOn]}>
                  <Text style={[styles.activityFilterText, active && styles.activityFilterTextOn]}>{entry.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{filter === "MINE" ? "我的活动" : "为你推荐"}</Text>
            <Text style={styles.sectionHint}>{visible.length} 个</Text>
          </View>
          {phase === "LOADING" ? (
            <View style={styles.activityEmpty}>
              <ActivityIndicator color={color.magenta} />
              <Text style={styles.activityEmptyText}>正在读取活动读模型（ListActivities）…</Text>
            </View>
          ) : phase === "ERROR" ? (
            <View style={styles.activityEmpty}>
              <Text style={styles.activityEmptyText}>活动读模型暂时不可用（本地 API 未连接？）。</Text>
              <Pressable onPress={() => void loadActivities()} style={styles.activityRetry}>
                <Text style={styles.activityRetryText}>重试</Text>
              </Pressable>
            </View>
          ) : visible.length === 0 ? (
            <View style={styles.activityEmpty}>
              <Text style={styles.activityEmptyText}>
                {filter === "MINE" ? "还没有参加或感兴趣的活动。" : "附近暂时没有符合的活动。"}
              </Text>
            </View>
          ) : (
            visible.map((item) => (
              <ActivityFeedCard key={item.activityId} item={item} onPress={() => openDetail(item)} />
            ))
          )}
        </>
      ) : (
        <>

      {/* 基线 .taskaction：深色渐变发布卡 + lime CTA */}
      <Gradient from="#17131F" to="#332642" style={styles.taskAction}>
        <Text style={styles.taskActionTitle}>需要找人提供明确服务？</Text>
        <Text style={styles.taskActionBody}>
          付费购买时间、能力或结果，都从这里发布。Proxy 会按场景决定直接执行、辅助整理或继续澄清。
        </Text>
        <Pressable onPress={onPublishNeed} style={styles.taskActionCta}>
          <Text style={styles.taskActionCtaText}>发布需求</Text>
        </Pressable>
      </Gradient>

      {/* 进行中 */}
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>进行中</Text>
        <Text style={styles.sectionHint}>{IN_PROGRESS.length} 项</Text>
      </View>
      {IN_PROGRESS.map((row) => (
        <TaskServiceRow key={row.label} row={row} onPress={row.target ? () => onEnterWorkspace(row.target as WorkspaceTarget) : undefined} />
      ))}

      {/* 基线「收费需求示例」：.activityfeedcard + .venuecompact */}
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>收费需求示例</Text>
        <Text style={styles.sectionHint}>属于需求，不属于活动</Text>
      </View>
      <Pressable onPress={onPublishNeed} style={styles.exampleCard}>
        <View style={styles.exampleHead}>
          <View style={styles.exampleTitle}>
            <View style={styles.originBadge}>
              <Text style={styles.originBadgeText}>付费需求</Text>
            </View>
            <Text style={styles.exampleName}>商务晚餐 · 需要中文陪同</Text>
            <Text style={styles.exampleMeta}>周五 18:30–21:00 · 需要 1 位</Text>
          </View>
          <View style={styles.examplePrice}>
            <Text style={styles.examplePriceStrong}>800,000₫</Text>
            <Text style={styles.examplePriceSmall}>任务报酬</Text>
          </View>
        </View>
        <View style={styles.venue}>
          <View style={styles.venueIcon}>
            <Text style={styles.venueIconText}>🍽️</Text>
          </View>
          <View style={styles.venueCopy}>
            <Text style={styles.venueName}>岚庭餐厅 · 西湖</Text>
            <Text style={styles.venueNote}>同样绑定真实商家场景，但走需求订单与履约链</Text>
          </View>
          <View style={styles.venueTag}>
            <Text style={styles.venueTagText}>平台商家</Text>
          </View>
        </View>
      </Pressable>

      {/* 已完成 */}
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>已完成</Text>
        <Text style={styles.sectionHint}>可复用</Text>
      </View>
      {DONE.map((row) => (
        <TaskServiceRow key={row.label} row={row} />
      ))}
        </>
      )}
    </ScrollView>
  );
}

export function ActivityFeedCard({ item, onPress }: { item: Activity; onPress: () => void }): React.JSX.Element {
  const origin = ORIGIN_META[item.origin];
  return (
    <Pressable onPress={onPress} style={styles.exampleCard}>
      <View style={styles.exampleHead}>
        <View style={styles.exampleTitle}>
          <View style={[styles.originBadge, { backgroundColor: origin.bg }]}>
            <Text style={[styles.originBadgeText, { color: origin.fg }]}>{origin.label}</Text>
          </View>
          <Text style={styles.exampleName}>{item.title}</Text>
          <Text style={styles.exampleMeta}>
            {item.time} · {item.people}
          </Text>
        </View>
        <View style={styles.examplePrice}>
          <Text style={styles.examplePriceStrong}>{item.price}</Text>
          <Text style={styles.examplePriceSmall}>活动价格</Text>
        </View>
      </View>
      <View style={styles.venue}>
        <View style={styles.venueIcon}>
          <Text style={styles.venueIconText}>{item.venueIcon}</Text>
        </View>
        <View style={styles.venueCopy}>
          <Text style={styles.venueName}>{item.venueName}</Text>
          <Text style={styles.venueNote}>
            {item.consumption} · 预计 {item.venueSpend}
          </Text>
        </View>
        <View style={styles.venueTag}>
          <Text style={styles.venueTagText}>平台商家</Text>
        </View>
      </View>
      {/* 基线 .activitysignals：感兴趣 / 已参加 / 分享 */}
      <View style={styles.activitySignals}>
        <Text style={styles.activitySignalText}>◉ {item.interested} 人感兴趣</Text>
        <Text style={styles.activitySignalText}>
          ✓ {item.joined}
          {item.capacity ? `/${item.capacity}` : ""} 已参加
        </Text>
        <Text style={styles.activitySignalText}>↗ {item.shares} 次分享</Text>
      </View>
      {item.parentTitle ? (
        <View style={styles.linkLine}>
          <Text style={styles.linkLineText}>关联：{item.parentTitle}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// 基线 activitydetail：详情页只围绕活动本身：人、时间、价格、商家场景、参加状态与必要沟通。
export function ActivityDetail({
  item,
  interested,
  joined,
  busy,
  onToggleInterested,
  onJoin,
  onOpenRealityScene,
  onBack
}: {
  item: Activity;
  interested: boolean;
  joined: boolean;
  busy: boolean;
  onToggleInterested: () => void;
  onJoin: () => void;
  onOpenRealityScene?: ((sceneId: string) => void) | undefined;
  onBack: () => void;
}): React.JSX.Element {
  const origin = ORIGIN_META[item.origin];
  const isCafe = item.venueType === "CAFE";
  return (
    <>
      {/* 基线 .detailhero：深色渐变 + originbadge + 价格 */}
      <Gradient from="#17131F" to="#342446" style={styles.detailHero}>
        <View style={styles.detailTopLine}>
          <View style={[styles.originBadge, { backgroundColor: origin.bg }]}>
            <Text style={[styles.originBadgeText, { color: origin.fg }]}>{origin.label}</Text>
          </View>
          <View style={styles.detailPrice}>
            <Text style={styles.detailPriceStrong}>{item.price}</Text>
            <Text style={styles.detailPriceSmall}>活动价格</Text>
          </View>
        </View>
        <Text style={styles.detailTitle}>{item.title}</Text>
        <Text style={styles.detailDesc}>{item.desc}</Text>
      </Gradient>

      {/* 基线 .sceneanchor：深色场地锚点 */}
      <View style={styles.sceneAnchor}>
        <View style={styles.sceneIcon}>
          <Text style={styles.sceneIconText}>{item.venueIcon}</Text>
        </View>
        <View style={styles.sceneCopy}>
          <Text style={styles.sceneName}>{item.venueName}</Text>
          <Text style={styles.sceneNote}>
            {item.venueTypeLabel} · {item.time}
          </Text>
          <Text style={styles.sceneNote}>
            {item.consumption} · 预计消费 {item.venueSpend}
          </Text>
        </View>
        <Text style={styles.sceneTag}>平台商家</Text>
      </View>

      {/* 基线 .benefitbox：lime 权益盒 */}
      <View style={styles.benefitBox}>
        <Text style={styles.benefitTitle}>本场可用权益</Text>
        <Text style={styles.benefitText}>{item.benefit}</Text>
      </View>

      <View style={styles.activitySignals}>
        <Text style={styles.activitySignalText}>◉ {item.interested} 人感兴趣</Text>
        <Text style={styles.activitySignalText}>
          ✓ {item.joined}
          {item.capacity ? `/${item.capacity}` : ""} 已参加
        </Text>
        <Text style={styles.activitySignalText}>↗ {item.shares} 次分享</Text>
      </View>

      {/* 基线 .activitysocialbar：感兴趣（不是点赞）+ 分享 */}
      <View style={styles.socialBar}>
        <Pressable onPress={onToggleInterested} disabled={busy} style={[styles.socialBtn, interested && styles.socialBtnOn]}>
          <Text style={[styles.socialBtnText, interested && styles.socialBtnTextOn]}>
            {busy ? "…" : interested ? "✓ 已感兴趣" : "☆ 感兴趣"}
          </Text>
        </Pressable>
        <Pressable style={styles.socialBtn}>
          <Text style={styles.socialBtnText}>↗ 分享活动</Text>
        </Pressable>
      </View>

      {item.parentTitle ? (
        <View style={styles.linkLine}>
          <Text style={styles.linkLineText}>关联活动：{item.parentTitle}</Text>
        </View>
      ) : null}

      {/* 基线 .qabox：公开层结构化问答，不是开放评论区 */}
      <View style={styles.qaBox}>
        <View style={styles.qaHead}>
          <Text style={styles.qaHeadTitle}>活动问答 · {item.qaCount}</Text>
          <Text style={styles.qaHeadMore}>查看 / 提问 →</Text>
        </View>
        <View style={styles.qaItem}>
          <Text style={styles.qaQuestion}>饮品怎么付？</Text>
          <Text style={styles.qaAnswer}>
            {item.consumption === "各自消费" ? "各自按门店实际消费结算。" : item.consumption}
          </Text>
          <Text style={styles.qaWho}>发起人已回答</Text>
        </View>
        <View style={styles.qaItem}>
          {isCafe ? (
            <>
              <Text style={styles.qaQuestion}>必须带相机吗？</Text>
              <Text style={styles.qaAnswer}>不用，手机也可以；重点是互相拍照。</Text>
              <Text style={styles.qaWho}>发起人已回答</Text>
            </>
          ) : (
            <>
              <Text style={styles.qaQuestion}>需要提前到吗？</Text>
              <Text style={styles.qaAnswer}>按活动时间到店即可，座位由门店保留。</Text>
              <Text style={styles.qaWho}>商家已回答</Text>
            </>
          )}
        </View>
      </View>

      {/* 基线 .verifiedreview：往期参与者反馈（实际到店） */}
      <View style={styles.reviewBox}>
        <View style={styles.reviewHead}>
          <Text style={styles.reviewTitle}>往期参与者反馈</Text>
          <Text style={styles.reviewBadge}>实际到店</Text>
        </View>
        <Text style={styles.reviewText}>
          {isCafe ? "“座位拍照光线不错，活动人数刚好，不会太尴尬。”" : "“场次组织比较顺，套餐规则提前写清楚了，到店不用再沟通。”"}
        </Text>
      </View>

      {/* 参加状态与 CTA：确认参加后才开放群聊 */}
      {joined ? (
        <>
          <View style={styles.joinState}>
            <Text style={styles.joinStateTitle}>你已参加这场活动</Text>
            <Text style={styles.joinStateText}>活动群聊仅向已确认参与者开放，用于到店前必要沟通。</Text>
          </View>
          <Gradient from={color.magenta} to={color.violet} style={styles.ctaPrimary}>
            <Pressable style={styles.ctaPrimaryInner}>
              <Text style={styles.ctaPrimaryText}>进入活动群聊</Text>
            </Pressable>
          </Gradient>
        </>
      ) : item.origin === "USER" ? (
        <Gradient from={color.magenta} to={color.violet} style={styles.ctaPrimary}>
          <Pressable style={styles.ctaPrimaryInner}>
            <Text style={styles.ctaPrimaryText}>查看参与者匹配</Text>
          </Pressable>
        </Gradient>
      ) : (
        <Gradient from={color.magenta} to={color.violet} style={styles.ctaPrimary}>
          <Pressable onPress={onJoin} disabled={busy} style={styles.ctaPrimaryInner}>
            <Text style={styles.ctaPrimaryText}>{busy ? "处理中…" : "参加活动"}</Text>
          </Pressable>
        </Gradient>
      )}
      {item.origin !== "USER" ? (
        <Pressable style={styles.ctaLight}>
          <Text style={styles.ctaLightText}>找人一起参加</Text>
        </Pressable>
      ) : null}
      {item.realitySceneId && onOpenRealityScene ? (
        <Pressable onPress={() => onOpenRealityScene(item.realitySceneId!)} style={styles.ctaLight}>
          <Text style={styles.ctaLightText}>查看场景地图</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={onBack} style={styles.ctaLight}>
        <Text style={styles.ctaLightText}>返回活动</Text>
      </Pressable>
    </>
  );
}

function TaskServiceRow({ row, onPress }: { row: TaskRow; onPress?: (() => void) | undefined }): React.JSX.Element {
  return (
    <Pressable onPress={onPress} style={styles.serviceRow}>
      {row.grad ? (
        <Gradient from={color.magenta} to={color.violet} style={styles.serviceIcon}>
          <Text style={styles.serviceIconTextGrad}>{row.glyph}</Text>
        </Gradient>
      ) : (
        <View style={styles.serviceIcon}>
          <Text style={styles.serviceIconText}>{row.glyph}</Text>
        </View>
      )}
      <View style={styles.serviceCopy}>
        <Text style={styles.serviceLabel}>{row.label}</Text>
        <Text style={styles.serviceDesc}>{row.desc}</Text>
      </View>
      <Text style={styles.chev}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  content: { paddingBottom: 24, paddingHorizontal: 18, paddingTop: 10 },

  // 基线 .taskmainnav：radius 14 padding 4 margin 7 0 12；on=白底+阴影。
  mainNav: {
    backgroundColor: color.surface,
    borderRadius: 14,
    flexDirection: "row",
    gap: 5,
    marginBottom: 12,
    marginTop: 7,
    padding: 4
  },
  mainNavOn: {
    backgroundColor: color.white,
    borderRadius: 11,
    flex: 1,
    paddingVertical: 9,
    ...shadows.card
  },
  mainNavOnText: { color: color.ink, fontSize: 11, fontWeight: "800", textAlign: "center" },
  mainNavOff: { flex: 1, paddingVertical: 9 },
  mainNavOffText: { color: color.muted, fontSize: 11, fontWeight: "800", textAlign: "center" },
  mainNavShadow: shadows.card,

  // 基线 .activityintro：margin 7 0 10；h2 22 bold + mini primary CTA。
  activityIntro: { alignItems: "flex-start", flexDirection: "row", gap: 10, justifyContent: "space-between", marginVertical: 8 },
  activityIntroCopy: { flex: 1 },
  activityIntroTitle: { color: color.ink, fontSize: 22, fontWeight: "700" },
  activityIntroBody: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  activityIntroCta: { backgroundColor: color.ink, borderRadius: 999, marginTop: 2, paddingHorizontal: 11, paddingVertical: 7 },
  activityIntroCtaText: { color: color.white, fontSize: 11, fontWeight: "700" },

  // 基线 .activityfilters：白底描边胶囊，on=ink 底白字。
  activityFilters: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginBottom: 4 },
  activityFilter: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6
  },
  activityFilterOn: { backgroundColor: color.ink, borderColor: color.ink },
  activityFilterText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  activityFilterTextOn: { color: color.white },

  // 活动读模型的加载/错误/空态。
  activityEmpty: {
    alignItems: "center",
    borderColor: "#D9D0DE",
    borderRadius: 17,
    borderStyle: "dashed",
    borderWidth: 1,
    gap: 8,
    marginTop: 12,
    padding: 22
  },
  activityEmptyText: { color: color.muted, fontSize: 11, lineHeight: 15, textAlign: "center" },
  activityRetry: { backgroundColor: color.ink, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 },
  activityRetryText: { color: color.white, fontSize: 11, fontWeight: "700" },

  // 基线 .activitysignals：border-top #F1EDF3 margin-top 8 padding-top 7 font 7.5。
  activitySignals: {
    borderTopColor: "#F1EDF3",
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 8,
    paddingTop: 7
  },
  activitySignalText: { color: color.muted, fontSize: 11 },
  linkLine: { marginTop: 6 },
  linkLineText: { color: "#81788A", fontSize: 11 },

  // 基线 .detailhero：gradient(#17131F→#342446) radius 20 padding 14 margin 8 0。
  detailHero: { borderRadius: 20, marginVertical: 8, padding: 14 },
  detailTopLine: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  detailPrice: { alignItems: "flex-end" },
  detailPriceStrong: { color: color.white, fontSize: 22, fontWeight: "900" },
  detailPriceSmall: { color: "#CFC6D8", fontSize: 11, marginTop: 1 },
  detailTitle: { color: color.white, fontSize: 18, fontWeight: "700", marginTop: 9 },
  detailDesc: { color: "#D8D1DF", fontSize: 11, lineHeight: 15, marginTop: 3 },

  // 基线 .sceneanchor：#17131F radius 16 padding 10 gap 9 margin 8 0。
  sceneAnchor: {
    alignItems: "center",
    backgroundColor: "#17131F",
    borderRadius: 16,
    flexDirection: "row",
    gap: 9,
    marginVertical: 8,
    padding: 10
  },
  sceneIcon: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 13,
    height: 42,
    justifyContent: "center",
    width: 42
  },
  sceneIconText: { fontSize: 18 },
  sceneCopy: { flex: 1, minWidth: 0 },
  sceneName: { color: color.white, fontSize: 11, fontWeight: "700" },
  sceneNote: { color: "#D4CDDA", fontSize: 11, lineHeight: 15, marginTop: 2 },
  sceneTag: { color: color.lime, fontSize: 11, fontWeight: "900" },

  // 基线 .benefitbox：#FBFFE9 border #DBED94 radius 11 padding 8。
  benefitBox: {
    backgroundColor: "#FBFFE9",
    borderColor: "#DBED94",
    borderRadius: 11,
    borderWidth: 1,
    marginTop: 7,
    padding: 8
  },
  benefitTitle: { color: "#4C5A14", fontSize: 11, fontWeight: "700" },
  benefitText: { color: "#6B7A2E", fontSize: 11, lineHeight: 15, marginTop: 2 },

  // 基线 .activitysocialbar：2 列 gap 7；.socialbtn radius 13 padding 9 font 9/850。
  socialBar: { flexDirection: "row", gap: 7, marginVertical: 9 },
  socialBtn: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 13,
    borderWidth: 1,
    flex: 1,
    padding: 9
  },
  socialBtnOn: { backgroundColor: "#F4FFD5", borderColor: "#C6DF63" },
  socialBtnText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  socialBtnTextOn: { color: color.ink },

  // 基线 .qabox：白底描边 radius 17 padding 11 margin 9 0。
  qaBox: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 17,
    borderWidth: 1,
    marginVertical: 9,
    padding: 11
  },
  qaHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 7 },
  qaHeadTitle: { color: color.ink, fontSize: 11, fontWeight: "700" },
  qaHeadMore: { color: "#6C36C8", fontSize: 11, fontWeight: "800" },
  qaItem: { borderTopColor: "#F1EDF3", borderTopWidth: 1, paddingVertical: 8 },
  qaQuestion: { color: color.ink, fontSize: 11, fontWeight: "700" },
  qaAnswer: { color: "#4A4250", fontSize: 11, lineHeight: 15, marginTop: 3 },
  qaWho: { color: "#8C8294", fontSize: 11, marginTop: 3 },

  // 基线 .verifiedreview：radius 15 padding 10 margin 8 0。
  reviewBox: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 15,
    borderWidth: 1,
    marginVertical: 8,
    padding: 10
  },
  reviewHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  reviewTitle: { color: color.ink, fontSize: 11, fontWeight: "700" },
  reviewBadge: { color: "#176F60", fontSize: 11, backgroundColor: "#EAF8F4", borderRadius: 999, paddingHorizontal: 6, paddingVertical: 4, fontWeight: "900" },
  reviewText: { color: "#4A4250", fontSize: 11, lineHeight: 15, marginTop: 7 },

  // 基线 .joinstate：#F4FFD5 border #D1E778 radius 15 padding 10。
  joinState: {
    backgroundColor: "#F4FFD5",
    borderColor: "#D1E778",
    borderRadius: 15,
    borderWidth: 1,
    marginVertical: 8,
    padding: 10
  },
  joinStateTitle: { color: "#3F4C0F", fontSize: 11, fontWeight: "700" },
  joinStateText: { color: "#5F6B35", fontSize: 11, lineHeight: 15, marginTop: 2 },

  // 基线 .cta：radius 14 padding 12 font 12/850；primary=magenta→violet 渐变。
  ctaPrimary: { borderRadius: 14, marginTop: 8, overflow: "hidden" },
  ctaPrimaryInner: { alignItems: "center", padding: 12 },
  ctaPrimaryText: { color: color.white, fontSize: 12, fontWeight: "800" },
  ctaLight: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 8,
    padding: 12
  },
  ctaLightText: { color: color.ink, fontSize: 12, fontWeight: "800" },

  // 基线 .taskaction：gradient(#17131F→#332642)，radius 20 padding 14；h3 18 / p 9。
  taskAction: { borderRadius: 20, marginVertical: 9, padding: 14 },
  taskActionTitle: { color: color.white, fontSize: 18, fontWeight: "700" },
  taskActionBody: { color: "#D9D2DF", fontSize: 11, lineHeight: 15, marginTop: 4 },
  taskActionCta: {
    alignSelf: "flex-start",
    backgroundColor: color.lime,
    borderRadius: 999,
    marginTop: 11,
    paddingHorizontal: 14,
    paddingVertical: 8
  },
  taskActionCtaText: { color: color.ink, fontSize: 11, fontWeight: "700" },

  sectionHead: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
    marginTop: 10
  },
  sectionTitle: { color: color.ink, fontSize: 12, fontWeight: "700" },
  sectionHint: { color: color.muted, fontSize: 11 },

  // 基线 .card.service：radius 17 padding 12 margin 6 0 gap 8。
  serviceRow: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: "rgba(20,18,31,0.04)",
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    marginBottom: 6,
    padding: 12,
    ...shadows.card
  },
  serviceIcon: {
    alignItems: "center",
    backgroundColor: color.lime,
    borderRadius: 13,
    height: 42,
    justifyContent: "center",
    width: 42
  },
  serviceIconText: { color: color.ink, fontSize: 16 },
  serviceIconTextGrad: { color: color.white, fontSize: 16 },
  serviceCopy: { flex: 1 },
  serviceLabel: { color: color.ink, fontSize: 12, fontWeight: "700" },
  serviceDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  chev: { color: "#A59CAB", fontSize: 22 },

  // 基线 .activityfeedcard：radius 18 padding 12 margin 8。
  exampleCard: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 18,
    borderWidth: 1,
    marginVertical: 8,
    padding: 12,
    ...shadows.card
  },
  exampleHead: { alignItems: "flex-start", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  exampleTitle: { flex: 1, minWidth: 0 },
  originBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#FFF0F6",
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 4
  },
  originBadgeText: { color: "#B91451", fontSize: 11, fontWeight: "900" },
  exampleName: { color: color.ink, fontSize: 11, fontWeight: "700", marginTop: 5 },
  exampleMeta: { color: color.muted, fontSize: 11, marginTop: 2 },
  examplePrice: { alignItems: "flex-end" },
  examplePriceStrong: { color: color.ink, fontSize: 16, fontWeight: "700" },
  examplePriceSmall: { color: color.muted, fontSize: 11, marginTop: 1 },

  // 基线 .venuecompact：bg #F8F5FA radius 11 padding 8 margin-top 8。
  venue: {
    alignItems: "center",
    backgroundColor: "#F8F5FA",
    borderRadius: 11,
    flexDirection: "row",
    gap: 7,
    marginTop: 8,
    padding: 8
  },
  venueIcon: {
    alignItems: "center",
    backgroundColor: "#F3EBF5",
    borderRadius: 10,
    height: 31,
    justifyContent: "center",
    width: 31
  },
  venueIconText: { fontSize: 14 },
  venueCopy: { flex: 1 },
  venueName: { color: color.ink, fontSize: 11, fontWeight: "700" },
  venueNote: { color: color.muted, fontSize: 11, marginTop: 1 },
  venueTag: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 4
  },
  venueTagText: { color: color.ink, fontSize: 11, fontWeight: "900" }
});
