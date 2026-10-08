// EXPLORE-REAL-001（2026-10-08）：动态 › 探索这一页（CAFE-SCENE-001 换掉原
// 「状态」「社区」两个 tab 的那一屏）全部改成真数据。
//
// 这一屏以前整屏是 PLACEHOLDER_SCENES / PLACEHOLDER_SHOPS：假的人（Mia / Luna /
// Sara + 头像 + 「已待 35 分钟」「可陪 2 小时」）、假的店铺与假评分（4.8 / 128 条
// 评价）、网速/吸烟/空调/插座/噪音那排 LEGEND 与七个筛不动的假 chip、假的活动
// （周六咖啡拉花体验课 · 已报名 5/8），外加一行常驻的「示例数据」。**全部删掉**：
// 那个人员榜的依据从来不存在（hereCount 只是「此刻声明在这里的人数」这个聚合，
// 公开目录里没有「是谁」），设施与噪音是没有任何生产者的属性，那七个 chip 没有
// 一个真的筛得到东西。
//
// 现在三段各自一份真数据（端点、client 全部复用现成的，没有新加接口）：
//   1. 此刻 —— 公开目录 /v1/reality-scenes 里 hereCount > 0 的咖啡场景，按在场
//      人数降序。每行只有店名 / 区域 / 「N 人此刻在这里」：没有人名、没有头像。
//   2. 咖啡店 —— 同一份目录里咖啡分类的全部场景（店名 / 区域 / 评分+条数 /
//      此刻人数 / 真的拿到定位时的距离）。评分只在 ratingCount > 0 时成段。
//   3. 活动 —— ActivityClient.listActivities（匿名可读），只留未取消、且能解析出
//      时刻时还没开场的那几条；时间地点照服务端存的原样显示。
//
// 每段都有自己的诚实空态（「还没有……」），加载与失败各是一行纯文字（不引
// spinner）。距离只在真的拿到设备定位时才有；没有定位就是没有，不编。
//
// ⚠️ 行不可点是**有意的**：点进单店详情要走场景目录那一整屏（SceneShopDirectory，
// 自带全屏 Modal、收藏/打卡/导航/报名），而这一 tab 从 feed.tsx 拿不到任何导航
// 回调（`<CoffeeScenesHub />` 没有 props）。挂一整屏目录进来是第二份实现，放一个
// 点了没反应的按钮则是死按钮 —— 两样都不做，行就只是行。
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { color, shadows } from "../theme";
import { ActivityClient } from "../activity-client";
import { getCurrentFix } from "../device-location";
import { expoLocationApi } from "../device-location-native";
import { localApiBaseUrl, nativeSecureSessionStore, sessionAuthClient } from "../native-clients";
import type { SceneOrigin } from "../scene-shop-directory";
import {
  EXPLORE_EMPTY_TEXT,
  EXPLORE_ERROR_TEXT,
  EXPLORE_LOADING_TEXT,
  EXPLORE_SECTION_TITLES,
  activityMetaLine,
  activityPeopleLine,
  coffeeVenues,
  hereNowLine,
  hereNowScenes,
  loadExploreScenes,
  metaLine,
  photoUri,
  ratingLine,
  upcomingActivities,
  venueDistanceText,
  type ExploreActivity,
  type ExploreScene,
} from "../coffee-scenes-model";

type LoadState = "LOADING" | "READY" | "ERROR";

export function CoffeeScenesHub(): React.JSX.Element {
  const [scenes, setScenes] = useState<readonly ExploreScene[]>([]);
  const [catalogState, setCatalogState] = useState<LoadState>("LOADING");
  const [activities, setActivities] = useState<readonly ExploreActivity[]>([]);
  const [activityState, setActivityState] = useState<LoadState>("LOADING");
  const [origin, setOrigin] = useState<SceneOrigin>();

  // 公开场景目录：免登录；失败就明说失败 —— 留一片空列表会让人以为是「附近没有店」。
  useEffect(() => {
    let cancelled = false;
    void loadExploreScenes(fetch, localApiBaseUrl)
      .then((rows) => { if (!cancelled) { setScenes(rows); setCatalogState("READY"); } })
      .catch(() => { if (!cancelled) setCatalogState("ERROR"); });
    return () => { cancelled = true; };
  }, []);

  // 活动：ListActivities 匿名可读（读列表不需要报名权限）。
  useEffect(() => {
    let cancelled = false;
    void new ActivityClient({ authClient: sessionAuthClient, secureSessionStore: nativeSecureSessionStore })
      .listActivities()
      .then((list) => {
        if (cancelled) return;
        setActivities(upcomingActivities(list, new Date()));
        setActivityState("READY");
      })
      .catch(() => { if (!cancelled) setActivityState("ERROR"); });
    return () => { cancelled = true; };
  }, []);

  // 定位只为距离这一段服务：取不到就没有距离（不拿河内市中心当「你的位置」）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fix = await getCurrentFix(expoLocationApi, { requestPermission: true });
      if (!cancelled && fix) setOrigin({ latitude: fix.latitude, longitude: fix.longitude });
    })();
    return () => { cancelled = true; };
  }, []);

  // 「此刻」与「咖啡店」必须是同一批场景（同一个 coffee 匹配器），否则两段对不上。
  const venues = useMemo(() => coffeeVenues(scenes), [scenes]);
  const hereNow = useMemo(() => hereNowScenes(venues), [venues]);

  return (
    <View>
      {/* 场景目录一份请求喂两段（此刻 / 咖啡店），所以它的加载/失败行只出现一次；
          取不到时**不**画那两段的空态 —— 「没拉到」和「真的没有」是两种状态，
          拿一句「还没有咖啡店场景」去冒充取不到，就是在撒谎。 */}
      <ExploreState state={catalogState} />
      {catalogState === "READY" ? (
        <>
          <ExploreSection emptyText={EXPLORE_EMPTY_TEXT.here} isEmpty={hereNow.length === 0} title={EXPLORE_SECTION_TITLES.here}>
            {hereNow.map((scene) => {
              const meta = metaLine([scene.area, hereNowLine(scene.hereCount)]);
              return (
                <View key={scene.id} style={styles.rowCard}>
                  {/* 唯一的「此刻」信号：这颗点 + 「N 人此刻在这里」。没有人名、没有头像
                      —— 公开目录里没有「是谁」，也不该有。 */}
                  <View style={styles.liveDot} />
                  <View style={styles.rowBody}>
                    <Text selectable style={styles.rowTitle}>{scene.name}</Text>
                    {meta === "" ? null : <Text selectable style={styles.rowMeta}>{meta}</Text>}
                  </View>
                </View>
              );
            })}
          </ExploreSection>

          <ExploreSection emptyText={EXPLORE_EMPTY_TEXT.coffee} isEmpty={venues.length === 0} title={EXPLORE_SECTION_TITLES.coffee}>
            {venues.map((scene) => {
              const photo = photoUri(scene.imageUrl, localApiBaseUrl);
              const meta = metaLine([scene.area, ratingLine(scene), hereNowLine(scene.hereCount), venueDistanceText(scene, origin)]);
              return (
                <View key={scene.id} style={styles.rowCard}>
                  {photo ? (
                    <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={`explore:${scene.id}`} source={{ uri: photo }} style={styles.rowThumb} transition={0} />
                  ) : null}
                  <View style={styles.rowBody}>
                    <Text selectable style={styles.rowTitle}>{scene.name}</Text>
                    {meta === "" ? null : <Text selectable style={styles.rowMeta}>{meta}</Text>}
                  </View>
                </View>
              );
            })}
          </ExploreSection>
        </>
      ) : null}

      <ExploreState state={activityState} />
      {activityState === "READY" ? (
        <ExploreSection emptyText={EXPLORE_EMPTY_TEXT.activities} isEmpty={activities.length === 0} title={EXPLORE_SECTION_TITLES.activities}>
          {activities.map((activity) => {
            const meta = activityMetaLine(activity);
            return (
              <View key={activity.activityId} style={styles.rowCard}>
                <View style={styles.rowBody}>
                  <Text selectable style={styles.rowTitle}>{activity.title}</Text>
                  {meta === "" ? null : <Text selectable style={styles.rowMeta}>{meta}</Text>}
                  <Text selectable style={styles.rowMeta}>{activityPeopleLine(activity)}</Text>
                </View>
              </View>
            );
          })}
        </ExploreSection>
      ) : null}
    </View>
  );
}

/**
 * 一段的状态行：加载与失败各是一行纯文字（不引 spinner —— 这一屏没有「转圈才算在
 * 加载」的需求，而一个装饰性的转圈是死 UI）。READY 没有状态行，空态归那一段自己。
 */
function ExploreState({ state }: { state: LoadState }): React.JSX.Element | null {
  if (state === "LOADING") return <Text selectable style={styles.stateText}>{EXPLORE_LOADING_TEXT}</Text>;
  if (state === "ERROR") return <Text selectable style={styles.stateText}>{EXPLORE_ERROR_TEXT}</Text>;
  return null;
}

/** 一段 = 标题 + 数据行，或者一行空态（「真的没有」才走这一行）。 */
function ExploreSection({
  title,
  isEmpty,
  emptyText,
  children,
}: {
  title: string;
  /** 这一段真的没有内容（调用方保证：取不到的那一段根本不进来）。 */
  isEmpty: boolean;
  emptyText: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text selectable style={styles.sectionTitle}>{title}</Text>
      {isEmpty ? <Text selectable style={styles.stateText}>{emptyText}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 22 },
  sectionTitle: { color: color.ink, fontSize: 15, fontWeight: "800", marginBottom: 10 },
  stateText: { color: color.muted, fontSize: 12, marginBottom: 4 },

  // 场景缩略图跟场景目录那一屏同尺寸（104 方），不新造第三档头像尺寸。
  rowThumb: { backgroundColor: color.surface, borderRadius: 14, height: 104, width: 104 },
  liveDot: { backgroundColor: color.mint, borderRadius: 4, height: 8, width: 8 },

  rowCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 12, marginBottom: 9, padding: 12, ...shadows.card },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { color: color.ink, fontSize: 14, fontWeight: "700" },
  rowMeta: { color: color.muted, fontSize: 11, marginTop: 3 }
});