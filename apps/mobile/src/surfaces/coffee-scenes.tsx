// CAFE-SCENE-001: 替换动态里原来的「状态」(24h 阅后即焚) + 「社区」(兴趣圈子)
// 两个 tab —— 低摩擦、定位清晰的「咖啡场景」发现页：谁现在在哪家店、店铺榜、
// 活动预告，比泛化的临时广播/兴趣圈子更贴近约人见面这个场景。
//
// 场景/店铺/活动全是占位数据（组件顶部常驻"示例数据"提示）——后端目前没有
// 「谁在店里」「店铺库」「活动报名」这些数据模型，先把交互骨架搭起来，
// 真数据接上之后把提示行摘掉、把下面几个 PLACEHOLDER_* 换成 client 拉取。
// 颜色/字号沿用 theme.tsx 的 R3 token，不搬参考稿自己那套深色咖啡配色。
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ProxyIcon } from "../components/proxy-icon";
import { color, shadows } from "../theme";

type Scene = {
  id: string;
  name: string;
  initial: string;
  shop: string;
  distanceKm: number;
  activity: string;
  waitedMin: number;
  availableHours: number;
  pref: string;
  lang: string;
  tags: string;
};

const PLACEHOLDER_SCENES: readonly Scene[] = [
  { id: "1", name: "Mia", initial: "M", shop: "Proxy Coffee", distanceKm: 1.2, activity: "办公中 · 靠窗安静区", waitedMin: 35, availableHours: 2, pref: "不限", lang: "中文 OK", tags: "咖啡 · 办公" },
  { id: "2", name: "Luna", initial: "L", shop: "Bắc Ninh Cafe", distanceKm: 2.1, activity: "聊天中 · 沙发区", waitedMin: 60, availableHours: 3, pref: "男生", lang: "English", tags: "City Walk · 聊天" },
  { id: "3", name: "Sara", initial: "S", shop: "L'amour Café", distanceKm: 0.8, activity: "打牌中 · 靠窗大桌", waitedMin: 20, availableHours: 1.5, pref: "不限", lang: "中文 OK", tags: "UNO · 打牌" }
];

type Shop = {
  id: string;
  emoji: string;
  name: string;
  distanceKm: number;
  desc: string;
  rating: number;
  reviews: number;
  hot?: boolean;
  isNew?: boolean;
  wifi: string;
  smoke: string;
  ac: string;
  plug: string;
  quiet: "安静" | "适中" | "热闹";
};

const PLACEHOLDER_SHOPS: readonly Shop[] = [
  { id: "s1", emoji: "☕", name: "Bắc Ninh Cafe", distanceKm: 1.2, desc: "深夜咖啡 · 适合办公", rating: 4.8, reviews: 128, hot: true, wifi: "A", smoke: "无烟", ac: "24°", plug: "充足", quiet: "安静" },
  { id: "s2", emoji: "🌿", name: "The Coffee House", distanceKm: 2.1, desc: "适合约会 · 拍照好看", rating: 4.7, reviews: 96, hot: true, wifi: "B+", smoke: "室外", ac: "22°", plug: "部分", quiet: "适中" },
  { id: "s3", emoji: "🥐", name: "L'amour Café", distanceKm: 0.8, desc: "安静 · 可颂必点", rating: 4.6, reviews: 74, wifi: "A", smoke: "无烟", ac: "26°", plug: "充足", quiet: "安静" },
  { id: "s4", emoji: "💻", name: "Workflow Coffee", distanceKm: 1.8, desc: "办公首选", rating: 4.7, reviews: 112, hot: true, wifi: "A+", smoke: "无烟", ac: "23°", plug: "充足", quiet: "安静" },
  { id: "s5", emoji: "🌸", name: "Bloom Coffee", distanceKm: 3.2, desc: "新店开业", rating: 4.5, reviews: 18, isNew: true, wifi: "A", smoke: "无烟", ac: "24°", plug: "充足", quiet: "适中" },
  { id: "s6", emoji: "🍃", name: "Green Garden", distanceKm: 0.5, desc: "庭院安静", rating: 4.6, reviews: 62, wifi: "B", smoke: "无烟", ac: "25°", plug: "部分", quiet: "安静" },
  { id: "s7", emoji: "⚡", name: "Express Coffee", distanceKm: 1.5, desc: "快捷外带", rating: 4.4, reviews: 88, hot: true, wifi: "A", smoke: "无烟", ac: "22°", plug: "部分", quiet: "热闹" },
  { id: "s8", emoji: "📖", name: "Quiet Page", distanceKm: 2.4, desc: "阅读空间", rating: 4.9, reviews: 142, wifi: "A", smoke: "无烟", ac: "24°", plug: "充足", quiet: "安静" }
];

const LEGEND: readonly { icon: string; label: string; detail: string }[] = [
  { icon: "🌐", label: "网速", detail: "A+ / A / B / C" },
  { icon: "🚭", label: "吸烟", detail: "无烟 / 室外 / 室内" },
  { icon: "❄️", label: "空调", detail: "22° / 24° / 26°" },
  { icon: "🔌", label: "插座", detail: "充足 / 部分 / 无" },
  { icon: "🔇", label: "噪音", detail: "安静 / 适中 / 热闹" },
  { icon: "🪑", label: "座位", detail: "沙发 / 硬椅 / 混合" }
];

const SHOP_FILTERS: readonly { id: ShopFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "hot", label: "🔥 热门" },
  { id: "near", label: "📍 附近" },
  { id: "new", label: "✨ 新店" },
  { id: "top", label: "⭐ 高评分" },
  { id: "work", label: "💻 适合办公" },
  { id: "quiet", label: "🔇 安静" }
];

type ShopFilter = "all" | "hot" | "near" | "new" | "top" | "work" | "quiet";

function matchesFilter(shop: Shop, filter: ShopFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "hot": return Boolean(shop.hot);
    case "new": return Boolean(shop.isNew);
    case "near": return shop.distanceKm <= 1.2;
    case "top": return shop.rating >= 4.6;
    case "work": return shop.desc.includes("办公");
    case "quiet": return shop.quiet === "安静";
  }
}

export function CoffeeScenesHub(): React.JSX.Element {
  const [view, setView] = useState<"HOME" | "ALL_SHOPS">("HOME");
  const [legendOpen, setLegendOpen] = useState(false);
  const [activeScene, setActiveScene] = useState<Scene>();
  const [joinedScenes, setJoinedScenes] = useState<ReadonlySet<string>>(new Set());
  const [eventJoined, setEventJoined] = useState(false);
  const [eventSpots, setEventSpots] = useState(5);
  const [shopFilter, setShopFilter] = useState<ShopFilter>("all");

  function joinScene(id: string): void {
    setJoinedScenes((prev) => new Set(prev).add(id));
  }

  function joinEvent(): void {
    if (eventJoined) return;
    setEventJoined(true);
    setEventSpots((n) => Math.min(8, n + 1));
  }

  if (view === "ALL_SHOPS") {
    const filtered = PLACEHOLDER_SHOPS.filter((s) => matchesFilter(s, shopFilter));
    return (
      <View>
        <Pressable onPress={() => setView("HOME")}><Text selectable style={styles.back}>‹ 返回探索</Text></Pressable>
        <Text selectable style={styles.placeholderBanner}>示例数据 · 店铺库还没接后端，界面先搭起来。</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
          {SHOP_FILTERS.map((f) => (
            <Pressable key={f.id} onPress={() => setShopFilter(f.id)} style={[styles.filterTab, shopFilter === f.id && styles.filterTabOn]}>
              <Text selectable style={[styles.filterTabText, shopFilter === f.id && styles.filterTabTextOn]}>{f.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Text selectable style={styles.resultCount}>共 {filtered.length} 家</Text>
        {filtered.map((s) => <ShopCard key={s.id} shop={s} />)}
      </View>
    );
  }

  return (
    <View>
      <Text selectable style={styles.placeholderBanner}>示例数据 · 场景 / 店铺 / 活动后端还没接，界面先搭起来。</Text>

      <View style={styles.sectionHead}>
        <Text selectable style={styles.sectionTitle}>☕ 实时咖啡场景</Text>
        <Text selectable style={styles.sectionSub}>Live Now</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sceneScroll}>
        {PLACEHOLDER_SCENES.map((s) => (
          <Pressable key={s.id} onPress={() => setActiveScene(s)} style={styles.sceneCard}>
            <View style={styles.liveTag}><View style={styles.liveDot} /><Text selectable style={styles.liveText}>现在在店里</Text></View>
            <View style={styles.scenePerson}>
              <View style={styles.sceneAvatar}><Text selectable style={styles.sceneAvatarText}>{s.initial}</Text></View>
              <View>
                <Text selectable style={styles.scenePersonName}>{s.name}</Text>
                <Text selectable style={styles.scenePersonWaited}>已待 {s.waitedMin} 分钟</Text>
              </View>
            </View>
            <Text selectable style={styles.scenePlace}>📍 {s.shop} · {s.distanceKm}km</Text>
            <Text selectable style={styles.sceneActivity}>{s.activity}</Text>
            <View style={styles.sceneMetaGrid}>
              <View style={styles.sceneMeta}><Text selectable style={styles.sceneMetaValue}>{s.availableHours}h</Text><Text selectable style={styles.sceneMetaKey}>可陪</Text></View>
              <View style={styles.sceneMeta}><Text selectable style={styles.sceneMetaValue}>有空</Text><Text selectable style={styles.sceneMetaKey}>状态</Text></View>
              <View style={styles.sceneMeta}><Text selectable style={styles.sceneMetaValue}>{s.pref}</Text><Text selectable style={styles.sceneMetaKey}>偏好</Text></View>
            </View>
            <View style={styles.sceneJoinRow}>
              <Text selectable style={styles.sceneTag}>{s.lang}</Text>
              <Pressable
                disabled={joinedScenes.has(s.id)}
                onPress={(event) => { event.stopPropagation(); joinScene(s.id); }}
                style={[styles.sceneJoinBtn, joinedScenes.has(s.id) && styles.sceneJoinBtnOn]}
              >
                <Text selectable style={styles.sceneJoinBtnText}>{joinedScenes.has(s.id) ? "已加入" : "加入"}</Text>
              </Pressable>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.eventCard}>
        <Text selectable style={styles.eventBadge}>✦ 活动预告</Text>
        <Text selectable style={styles.eventTitle}>周六咖啡拉花体验课</Text>
        <View style={styles.eventHost}>
          <View style={styles.eventHostAvatar}><Text selectable style={styles.eventHostAvatarText}>P</Text></View>
          <Text selectable style={styles.eventHostText}>Proxy Coffee Roastery 主办</Text>
        </View>
        <View style={styles.eventDetailGrid}>
          <View style={styles.eventDetail}><Text selectable style={styles.eventDetailValue}>21</Text><Text selectable style={styles.eventDetailKey}>周六</Text></View>
          <View style={styles.eventDetail}><Text selectable style={styles.eventDetailValue}>15:00</Text><Text selectable style={styles.eventDetailKey}>开始</Text></View>
          <View style={styles.eventDetail}><Text selectable style={styles.eventDetailValue}>8 人</Text><Text selectable style={styles.eventDetailKey}>名额</Text></View>
        </View>
        <Text selectable style={styles.eventDesc}>专业咖啡师带您体验拉花基础，从打奶泡到心形、叶形图案，亲手做一杯拿铁。含一杯饮品和甜点。</Text>
        <View style={styles.eventBottomRow}>
          <Text selectable style={styles.eventSpots}>已报名 <Text selectable style={styles.eventSpotsStrong}>{eventSpots}</Text> / 8 人</Text>
          <Pressable onPress={joinEvent} style={[styles.eventJoinBtn, eventJoined && styles.eventJoinBtnOn]}>
            <Text selectable style={styles.eventJoinBtnText}>{eventJoined ? "已加入 ✓" : "加入"}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.sectionHead}>
        <Text selectable style={styles.sectionTitle}>🔥 本周热门</Text>
        <Pressable onPress={() => setView("ALL_SHOPS")} style={styles.moreBtn}>
          <Text selectable style={styles.moreBtnText}>更多</Text>
          <ProxyIcon color={color.muted} name="arrowUpRight" size={11} />
        </Pressable>
      </View>
      {PLACEHOLDER_SHOPS.slice(0, 3).map((s) => <ShopCard key={s.id} shop={s} />)}

      <Pressable onPress={() => setLegendOpen((v) => !v)} style={styles.legendToggle}>
        <View style={styles.legendToggleLeft}>
          <Text selectable style={styles.legendToggleIcon}>🏷️</Text>
          <Text selectable style={styles.legendToggleText}>标记说明</Text>
        </View>
        <Text selectable style={[styles.legendArrow, legendOpen && styles.legendArrowOpen]}>▾</Text>
      </Pressable>
      {legendOpen ? (
        <View style={styles.legendGrid}>
          {LEGEND.map((l) => (
            <View key={l.label} style={styles.legendItem}>
              <Text selectable style={styles.legendItemIcon}>{l.icon}</Text>
              <View style={styles.legendItemTextWrap}>
                <Text selectable style={styles.legendItemLabel}>{l.label}</Text>
                <Text selectable style={styles.legendItemDetail}>{l.detail}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <Modal animationType="slide" transparent visible={Boolean(activeScene)} onRequestClose={() => setActiveScene(undefined)}>
        <Pressable onPress={() => setActiveScene(undefined)} style={styles.modalOverlay}>
          <Pressable onPress={(event) => event.stopPropagation()} style={styles.modalSheet}>
            {activeScene ? (
              <>
                <View style={styles.modalDrag} />
                <View style={styles.modalTop}>
                  <View style={styles.modalAvatar}><Text selectable style={styles.modalAvatarText}>{activeScene.initial}</Text></View>
                  <View>
                    <Text selectable style={styles.modalName}>{activeScene.name}</Text>
                    <Text selectable style={styles.modalStatus}>已待 {activeScene.waitedMin} 分钟 · {activeScene.shop}</Text>
                  </View>
                </View>
                <View style={styles.modalBlock}>
                  <Text selectable style={styles.modalBlockTitle}>场景信息</Text>
                  <ModalRow label="📍 位置" value={activeScene.shop} />
                  <ModalRow label="☕ 活动" value={activeScene.activity} />
                  <ModalRow label="⏱ 可陪时间" value={`${activeScene.availableHours} 小时`} />
                  <ModalRow label="👥 偏好" value={activeScene.pref} />
                </View>
                <View style={styles.modalBlock}>
                  <Text selectable style={styles.modalBlockTitle}>关于她</Text>
                  <ModalRow label="语言" value={activeScene.lang} />
                  <ModalRow label="兴趣" value={activeScene.tags} />
                </View>
                <View style={styles.modalActionRow}>
                  <Pressable onPress={() => setActiveScene(undefined)} style={styles.modalCancel}>
                    <Text selectable style={styles.modalCancelText}>取消</Text>
                  </Pressable>
                  <Pressable onPress={() => { joinScene(activeScene.id); setActiveScene(undefined); }} style={styles.modalConfirm}>
                    <Text selectable style={styles.modalConfirmText}>{joinedScenes.has(activeScene.id) ? "已加入" : "确认加入"}</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function ModalRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.modalRow}>
      <Text selectable style={styles.modalRowLabel}>{label}</Text>
      <Text selectable style={styles.modalRowValue}>{value}</Text>
    </View>
  );
}

function ShopCard({ shop }: { shop: Shop }): React.JSX.Element {
  return (
    <View style={styles.shopCard}>
      <View style={styles.shopRow1}>
        <View style={styles.shopThumb}>
          <Text selectable style={styles.shopThumbEmoji}>{shop.emoji}</Text>
          {shop.hot ? <View style={styles.shopBadgeHot}><Text selectable style={styles.shopBadgeText}>HOT</Text></View> : null}
          {shop.isNew ? <View style={styles.shopBadgeNew}><Text selectable style={styles.shopBadgeText}>NEW</Text></View> : null}
        </View>
        <View style={styles.shopInfo}>
          <Text selectable style={styles.shopName}>{shop.name}</Text>
          <Text selectable style={styles.shopSub}>{shop.distanceKm}km · {shop.desc}</Text>
        </View>
        <View style={styles.shopScore}>
          <Text selectable style={styles.shopScoreValue}>{shop.rating}</Text>
          <Text selectable style={styles.shopScoreSub}>{shop.reviews} 评价</Text>
        </View>
      </View>
      <View style={styles.shopMarks}>
        <Text selectable style={styles.shopMark}>🌐 {shop.wifi}</Text>
        <Text selectable style={styles.shopMark}>{shop.smoke === "无烟" ? "🚭" : "🚬"} {shop.smoke}</Text>
        <Text selectable style={styles.shopMark}>❄️ {shop.ac}</Text>
        <Text selectable style={styles.shopMark}>🔌 {shop.plug}</Text>
        <Text selectable style={styles.shopMark}>🔇 {shop.quiet}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholderBanner: { color: color.muted, fontSize: 11, fontWeight: "700", marginBottom: 10, marginTop: 2 },
  back: { color: color.magenta, fontSize: 12, fontWeight: "800", marginBottom: 8, marginTop: 4 },

  sectionHead: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginBottom: 10, marginTop: 4 },
  sectionTitle: { color: color.ink, fontSize: 15, fontWeight: "800" },
  sectionSub: { color: color.muted, fontSize: 11, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" },
  moreBtn: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 3, paddingHorizontal: 10, paddingVertical: 5 },
  moreBtnText: { color: color.ink, fontSize: 11, fontWeight: "700" },

  sceneScroll: { marginBottom: 20 },
  sceneCard: { backgroundColor: color.ink, borderRadius: 20, marginRight: 10, overflow: "hidden", padding: 14, width: 208 },
  liveTag: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "rgba(31,200,169,0.18)", borderRadius: 10, flexDirection: "row", gap: 5, marginBottom: 11, paddingHorizontal: 8, paddingVertical: 4 },
  liveDot: { backgroundColor: color.mint, borderRadius: 3, height: 6, width: 6 },
  liveText: { color: "#8FE8D4", fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
  scenePerson: { alignItems: "center", flexDirection: "row", gap: 9, marginBottom: 11 },
  sceneAvatar: { alignItems: "center", backgroundColor: color.violet, borderRadius: 999, height: 36, justifyContent: "center", width: 36 },
  sceneAvatarText: { color: color.white, fontSize: 14, fontWeight: "800" },
  scenePersonName: { color: color.white, fontSize: 14, fontWeight: "800" },
  scenePersonWaited: { color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 1 },
  scenePlace: { color: "rgba(255,255,255,0.75)", fontSize: 11, marginBottom: 3 },
  sceneActivity: { color: "rgba(255,255,255,0.5)", fontSize: 11, marginBottom: 11 },
  sceneMetaGrid: { flexDirection: "row", gap: 6, marginBottom: 13 },
  sceneMeta: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 11, flex: 1, paddingVertical: 6 },
  sceneMetaValue: { color: color.lime, fontSize: 12, fontWeight: "800" },
  sceneMetaKey: { color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 2 },
  sceneJoinRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  sceneTag: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 8, color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "600", paddingHorizontal: 7, paddingVertical: 3 },
  sceneJoinBtn: { backgroundColor: color.magenta, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 7 },
  sceneJoinBtnOn: { backgroundColor: "rgba(255,255,255,0.15)" },
  sceneJoinBtnText: { color: color.white, fontSize: 12, fontWeight: "700" },

  eventCard: { backgroundColor: color.violet, borderRadius: 20, marginBottom: 20, padding: 18 },
  eventBadge: { alignSelf: "flex-start", backgroundColor: color.magenta, borderRadius: 10, color: color.white, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, marginBottom: 12, paddingHorizontal: 9, paddingVertical: 4, textTransform: "uppercase" },
  eventTitle: { color: color.white, fontSize: 18, fontWeight: "800", marginBottom: 5 },
  eventHost: { alignItems: "center", flexDirection: "row", gap: 6, marginBottom: 13 },
  eventHostAvatar: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 999, height: 18, justifyContent: "center", width: 18 },
  eventHostAvatarText: { color: color.white, fontSize: 11, fontWeight: "800" },
  eventHostText: { color: "rgba(255,255,255,0.65)", fontSize: 11.5 },
  eventDetailGrid: { flexDirection: "row", gap: 9, marginBottom: 13 },
  eventDetail: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 13, flex: 1, paddingVertical: 9 },
  eventDetailValue: { color: color.white, fontSize: 13, fontWeight: "800" },
  eventDetailKey: { color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 3 },
  eventDesc: { color: "rgba(255,255,255,0.75)", fontSize: 11.5, lineHeight: 16, marginBottom: 16 },
  eventBottomRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  eventSpots: { color: "rgba(255,255,255,0.6)", fontSize: 11 },
  eventSpotsStrong: { color: color.white, fontWeight: "800" },
  eventJoinBtn: { backgroundColor: color.magenta, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 9 },
  eventJoinBtnOn: { backgroundColor: "rgba(255,255,255,0.25)" },
  eventJoinBtnText: { color: color.white, fontSize: 13, fontWeight: "700" },

  filterRow: { marginBottom: 12 },
  filterTab: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, marginRight: 7, paddingHorizontal: 13, paddingVertical: 7 },
  filterTabOn: { backgroundColor: color.ink, borderColor: color.ink },
  filterTabText: { color: color.ink, fontSize: 12, fontWeight: "600" },
  filterTabTextOn: { color: color.white },
  resultCount: { color: color.muted, fontSize: 11, marginBottom: 9 },

  shopCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, marginBottom: 9, padding: 12, ...shadows.card },
  shopRow1: { alignItems: "center", flexDirection: "row", gap: 12, marginBottom: 10 },
  shopThumb: { alignItems: "center", backgroundColor: color.surface, borderRadius: 14, height: 46, justifyContent: "center", position: "relative", width: 46 },
  shopThumbEmoji: { fontSize: 20 },
  shopBadgeHot: { backgroundColor: color.magenta, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, position: "absolute", right: -6, top: -6 },
  shopBadgeNew: { backgroundColor: color.mint, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, position: "absolute", right: -6, top: -6 },
  shopBadgeText: { color: color.white, fontSize: 11, fontWeight: "800" },
  shopInfo: { flex: 1, minWidth: 0 },
  shopName: { color: color.ink, fontSize: 14, fontWeight: "700" },
  shopSub: { color: color.muted, fontSize: 11, marginTop: 3 },
  shopScore: { alignItems: "flex-end" },
  shopScoreValue: { color: color.magenta, fontSize: 15, fontWeight: "800" },
  shopScoreSub: { color: color.muted, fontSize: 11, marginTop: 2 },
  shopMarks: { borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 9 },
  shopMark: { backgroundColor: color.surface, borderRadius: 8, color: color.ink, fontSize: 11, fontWeight: "600", paddingHorizontal: 8, paddingVertical: 3 },

  legendToggle: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 14, marginBottom: 6, paddingHorizontal: 14, paddingVertical: 11 },
  legendToggleLeft: { alignItems: "center", flexDirection: "row", gap: 8 },
  legendToggleIcon: { fontSize: 14 },
  legendToggleText: { color: color.ink, fontSize: 12.5, fontWeight: "600" },
  legendArrow: { color: color.muted, fontSize: 11 },
  legendArrowOpen: { transform: [{ rotate: "180deg" }] },
  legendGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  legendItem: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 8, padding: 9, width: "48%" },
  legendItemIcon: { fontSize: 14 },
  legendItemTextWrap: { flex: 1, minWidth: 0 },
  legendItemLabel: { color: color.ink, fontSize: 11.5, fontWeight: "700" },
  legendItemDetail: { color: color.muted, fontSize: 11, lineHeight: 13, marginTop: 1 },

  modalOverlay: { backgroundColor: "rgba(23,19,31,0.55)", flex: 1, justifyContent: "flex-end" },
  modalSheet: { backgroundColor: color.white, borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: "76%", padding: 20, paddingBottom: 28 },
  modalDrag: { alignSelf: "center", backgroundColor: color.line, borderRadius: 2, height: 4, marginBottom: 16, width: 40 },
  modalTop: { alignItems: "center", flexDirection: "row", gap: 12, marginBottom: 15 },
  modalAvatar: { alignItems: "center", backgroundColor: color.violet, borderRadius: 999, height: 50, justifyContent: "center", width: 50 },
  modalAvatarText: { color: color.white, fontSize: 18, fontWeight: "800" },
  modalName: { color: color.ink, fontSize: 17, fontWeight: "800" },
  modalStatus: { color: color.muted, fontSize: 11.5, marginTop: 3 },
  modalBlock: { backgroundColor: color.surface, borderRadius: 15, marginBottom: 11, padding: 13 },
  modalBlockTitle: { color: color.magenta, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, marginBottom: 9, textTransform: "uppercase" },
  modalRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 7 },
  modalRowLabel: { color: color.ink, fontSize: 12.5 },
  modalRowValue: { color: color.ink, fontSize: 12.5, fontWeight: "700" },
  modalActionRow: { flexDirection: "row", gap: 9, marginTop: 6 },
  modalCancel: { alignItems: "center", backgroundColor: color.surface, borderRadius: 16, flex: 0.4, paddingVertical: 14 },
  modalCancelText: { color: color.ink, fontSize: 14, fontWeight: "700" },
  modalConfirm: { alignItems: "center", backgroundColor: color.ink, borderRadius: 16, flex: 1, paddingVertical: 14 },
  modalConfirmText: { color: color.white, fontSize: 14, fontWeight: "700" }
});
