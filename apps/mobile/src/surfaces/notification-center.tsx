import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { ProxyIcon } from "../components/proxy-icon";
import { useI18n } from "../i18n";
import { relativeTimeKey, sortNewestFirst } from "../notification-bell";
import { deepLinkRouteFor } from "../notif-deeplink-route";
import type { InboxItem, NotificationClient } from "../notification-client";
import { color, foundation, shadows } from "../theme";

// NOTIF-BELL-001（2026-10-01，用户：「新增了铃铛提醒」）
//
// 原型 docs/design/references/Proxy_Home_Notifications_20261001_7b9953.html 的
// 首页顶栏多了一颗铃铛，点开是这一页「通知」。
//
// ⚠️ 这一页**不是**原型那张列表的复刻。原型里那四条是设计稿的示意数据
//    （Nguyễn Thị Hương 接受了你的盲盒邀请 / 盲盒已开启 / KYC 已通过 / 动态收到 12 个赞），
//    后端一条都没有。照抄它们就是把「用户真的收到过这些通知」画到界面上。
//    这里只渲染 `ListInbox` 回来的**真**数据；一条都没有就显示空态。
//
// ⚠️ 原型那排 tab（全部 / 互动 / 匹配 / 系统）也**没有**实现。服务端
//    `notification.inbox_items.type` 的真实取值是 OfferCreated / TaskPublished /
//    SlotOfferCreated / OfferAccepted / OrderCreated（现网 845 行就是这么分布的），
//    跟那四个 tab 名不是一套东西 —— 硬把 5 个 type 塞进 4 个 tab 就是编分类。
//    所以这里只有一列「全部」，按时间倒序。
//
// ⚠️ 点一条**不跳转**，只标已读（MarkInboxRead）。
//
//    ⚠️ 这条注释在 2026-10-02 被改过 —— 原来写的理由是「服务端 ResolveDeepLink
//    还是个桩（simplified: allow），拿它驱动跳转会把别人订单的链接也放行」。
//    那个理由**已经不成立**：ResolveDeepLink 现在要过形状白名单 + 归属校验
//    （internal/notification/service.go 的 HasInboxDeepLink，查询失败 fail-closed，
//    钉在 NOTIF-DEEPLINK-001）。
//
//    但**行为不变，因为真正的堵点从来不在服务端**：客户端没有任何路由表能接住这些
//    链接。`notification.inbox_items.deep_link` 的真实取值是 `/offers/<id>` /
//    `/orders/<id>` / `/tasks/<id>` / `/vouchers/<id>` / `/invitations/<id>`
//    （就是服务端 isResolvableDeepLink 放行的那五个前缀），而 apps/mobile/src 下
//    没有一处能把这些前缀映射到目的地 —— 唯一的映射表 me-owned-routes.ts 是
//    「我的」页那几个中文 label → tab，不是 URL 路由。
//
//    所以接跳转的前提是**先有路由表**（那要决定「订单详情页在哪、offer 详情页在哪」，
//    是产品决定不是接线），不是等服务端校验。校验已经好了。
//
// ⚠️ 2026-10-01 追加（用户：「没做完整 提醒只弹出半页就可以 不用完整 参考bigo」，
//    随后更正：「没改好 你这改的是下半页提醒 我要的是竖向右半页提醒」）：
//    这一页从**全屏**改成**竖向右半页侧栏**（right side panel）—— 贴右边、占窗口
//    **宽度**的一半、**上下通高**、左侧圆角、点遮罩关闭。
//
//    ⚠️ 我第一次做成了**底部半屏**（bottom sheet：贴底 + 宽度铺满 + 高度一半），
//    被用户直接否掉。教训是「半页」的**方向**：「半页」说的是**宽度方向**（左右
//    对半分），不是高度方向；「竖向」是说面板上下通高。改方向时这两件事要一起翻，
//    只把面板挪到右边是不够的。
//
//    这次是**结构**变化，不是换皮，四处要一起看：
//      1. 不再是全屏 offWhite 页 → 白色面板 + 半透明遮罩。宽度取窗口宽度的一个
//         比例（常量 `PANEL_WIDTH_RATIO`，半页 = 0.5）；**高度铺满**（flex 容器的
//         交叉轴默认 stretch，不给显式高度）。
//      2. 遮罩从「列 + 贴底」翻成「行 + 贴右」：`flexDirection: row` +
//         `justifyContent: flex-end`。**别**写成 `alignItems: flex-end` ——
//         row 方向下交叉轴是竖直的，那会把面板压到底部去（正是上一版的错法）。
//      3. 圆角只在**左边**（面板贴右）：左上 + 左下 24，右边不圆。
//      4. 表头那个**返回字形换成关闭的 ×**，并且标题改**左对齐** —— 面板只有半屏
//         宽，居中标题加左右占位太浪费。`ProxyBackGlyph` 的注释写明它是全 App 唯一
//         的**返回**字形，拿来当关闭用会污染那个统一。
//
//    列表的 ScrollView 有 flex，否则窄面板里内容会把它撑破。
//    动画仍用 `animationType="fade"`（跟仓里两个 sheet 一致）：RN 的 slide 会把
//    整块 Modal 一起平移、遮罩跟着"擦"出来，很难看。要做真·滑入得自己写
//    Animated 面板，本轮不做。
//
//    下面两条**没做**的理由不变（不是漏了）：不照抄原型示意数据、不做那排四分类 tab。

// 面板占窗口**宽度**的比例（「右半页」= 0.5）。改宽度只改这一个数。
// 注意是**宽度**不是高度 —— 上一版做错就错在这个方向。
const PANEL_WIDTH_RATIO = 0.5;

export function NotificationCenterSurface({
  client,
  onClose,
  onNavigate,
  presentation = "modal",
  visible
}: {
  client: NotificationClient;
  onClose: () => void;
  /** 深链有对应页面时跳过去（AppShell 拿到的是「我的」页的子页路由）。 */
  onNavigate?: (route: string) => void;
  presentation?: "modal" | "overlay";
  visible: boolean;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const { width: windowWidth } = useWindowDimensions();
  const [items, setItems] = useState<InboxItem[] | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // 每次打开都重拉：角标是外面那个铃铛算的，用户进来时看到的必须和角标同一份数据。
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setFailed(false);
    client
      .listInbox()
      .then((next) => {
        if (alive) setItems(sortNewestFirst(next));
      })
      .catch(() => {
        if (alive) setFailed(true);
      })
      .finally(() => {
        if (alive) setRefreshing(false);
      });
    return () => {
      alive = false;
    };
  }, [client, reloadToken, visible]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setReloadToken((n) => n + 1);
  }, []);

  // 点一条 = 把这一条标已读。**失败就让它保持未读** —— 不本地抹掉圆点假装成功
  // （下一次打开又会冒出来，用户会以为界面在骗他）。
  const markRead = useCallback(
    (item: InboxItem) => {
      if (item.read) return;
      client
        .markRead(item.id)
        .then(() => setItems((prev) => prev?.map((it) => (it.id === item.id ? { ...it, read: true } : it))))
        .catch(() => undefined);
    },
    [client]
  );

  // NOTIF-DEEPLINK-ROUTE-001：能跳的才跳。
  //
  // 两步闸门，缺一不可：
  //   1. **有没有这一页**（本地）：deepLinkRouteFor 只在 App 里真有屏幕时给路由。
  //      没有界面就不跳 —— 编一个目的地比不跳更糟。
  //   2. **这条链接是不是投递给我的**（服务端）：resolveDeepLink 现在过形状白名单
  //      + 归属校验（NOTIF-DEEPLINK-001），失败 fail-closed。没有这一步，
  //      改个 id 就能跳到别人的东西去。
  //
  // 标已读和跳转是两件事：读没读是本地状态，跳不跳取决于上面两道门。
  // 所以标已读先做、无条件做；跳转失败了也只是停在这一页。
  const openItem = useCallback(
    (item: InboxItem) => {
      markRead(item);
      const route = item.deepLink ? deepLinkRouteFor(item.deepLink) : undefined;
      if (!route || !item.deepLink || !onNavigate) return;
      client
        .resolveDeepLink(item.deepLink)
        .then((resolved) => {
          if (resolved) onNavigate(route);
        })
        .catch(() => undefined);
    },
    [client, markRead, onNavigate]
  );

  if (!visible) return null;

  const body =
    items === undefined ? (
      <View style={styles.center}>
        {failed ? <Text selectable style={styles.failedText}>{t("notifCenterLoadFailed")}</Text> : <ActivityIndicator />}
      </View>
    ) : items.length === 0 ? (
      <View style={styles.center}>
        <Text selectable style={styles.emptyTitle}>{t("notifCenterEmptyTitle")}</Text>
        <Text selectable style={styles.emptyBody}>{t("notifCenterEmptyBody")}</Text>
      </View>
    ) : (
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl onRefresh={refresh} refreshing={refreshing} />}
        style={styles.scroll}
      >
        {items.map((item) => {
          const rel = relativeTimeKey(item.createdAt);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: !item.read }}
              key={item.id}
              onPress={() => openItem(item)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <View style={styles.rowHead}>
                {item.read ? <View style={styles.dotSpacer} /> : <View style={styles.unreadDot} />}
                <Text selectable style={styles.rowTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text selectable style={styles.rowTime}>{t(rel.key, rel.vars)}</Text>
              </View>
              {item.body ? (
                <Text selectable style={styles.rowBody}>
                  {item.body}
                </Text>
              ) : null}
              {item.read ? null : (
                <Text selectable style={styles.unreadTag}>
                  {t("notifCenterUnreadMark")}
                </Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    );

  // 竖向右半页侧栏：贴右边、占宽度一半、上下通高（高度靠 flex 交叉轴 stretch）。
  // 外层 Pressable 是遮罩（点它关闭），内层是 no-op —— 挡住"点面板本身也关掉"的冒泡。
  // 这里**不用** LanguageSheet 那个 onStartShouldSetResponder：它会抢走 touch start，
  // 面板里的 ScrollView 就滚不动了。LocationPickerSheet 也是带 ScrollView 的面板，
  // 用的就是下面这个嵌套 Pressable 写法，所以它在"有滚动"的前提下是验证过的。
  const panel = (
    // accessible={false} 是必须的：RN 里带 accessibilityLabel 的 Pressable 会变成一个
    // **a11y 叶子**，把子节点全部吞掉 —— 实测（idb ui describe-all）整棵树只剩遮罩那一个
    // "取消"，标题、× 和每一条通知都不在树里，VoiceOver 读不到任何内容。关掉叶子之后
    // 子节点才会各自暴露。关闭的可达路径由表头那个 × 提供，不依赖遮罩。
    <Pressable accessibilityLabel={t("cancel")} accessible={false} onPress={onClose} style={styles.backdrop}>
      <Pressable accessible={false} onPress={() => undefined} style={[styles.panel, { width: Math.round(windowWidth * PANEL_WIDTH_RATIO) }]}>
        <View style={styles.header}>
          <Text selectable style={styles.headerTitle}>
            {t("notifCenterTitle")}
          </Text>
          <Pressable accessibilityLabel={t("close")} accessibilityRole="button" onPress={onClose} style={styles.headerClose}>
            <ProxyIcon color={color.ink} name="close" size={foundation.backGlyph} />
          </Pressable>
        </View>
        {body}
      </Pressable>
    </Pressable>
  );

  if (presentation === "overlay") return panel;
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      {panel}
    </Modal>
  );
}

const styles = StyleSheet.create({
  // 遮罩：铺满 + 面板贴**右**。注意方向 —— row 容器里主轴上用 justifyContent 才是
  // 「靠右」，写成 alignItems 会把面板压到底部（row 的交叉轴是竖直的）。
  backdrop: {
    backgroundColor: "rgba(0,0,0,0.32)",
    bottom: 0,
    flexDirection: "row",
    justifyContent: "flex-end",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  // 面板：不给显式高度 —— row 容器的交叉轴默认 stretch，自然上下通高。
  // 圆角只在左边（贴右），右侧贴屏幕边缘不圆。
  panel: {
    backgroundColor: color.white,
    borderBottomLeftRadius: 24,
    borderTopLeftRadius: 24,
    paddingBottom: 20
  },
  header: {
    alignItems: "center",
    borderBottomColor: color.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  // 面板只有半屏宽，标题左对齐、× 靠右；不做居中标题（加左右占位太浪费）。
  headerTitle: { color: color.ink, flex: 1, fontSize: 17, fontWeight: "900" },
  headerClose: { alignItems: "center", height: 24, justifyContent: "center", width: 24 },
  // 面板里 ScrollView 必须自己 flex，否则内容会把它撑破。
  scroll: { flex: 1 },
  center: { alignItems: "center", flex: 1, justifyContent: "center", padding: 20 },
  emptyTitle: { color: color.ink, fontSize: 16, fontWeight: "900" },
  emptyBody: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: 6, textAlign: "center" },
  failedText: { color: foundation.danger, fontSize: 13, textAlign: "center" },
  list: { padding: 16 },
  row: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
    padding: 14,
    ...shadows.card
  },
  rowPressed: { opacity: 0.72 },
  rowHead: { alignItems: "center", flexDirection: "row", gap: 8 },
  unreadDot: { backgroundColor: foundation.danger, borderRadius: 999, height: 7, width: 7 },
  // 已读的行左边留同样宽度，标题不会因为圆点消失而左右跳。
  dotSpacer: { height: 7, width: 7 },
  rowTitle: { color: color.ink, flex: 1, fontSize: 15, fontWeight: "700" },
  rowTime: { color: color.muted, fontSize: 11 },
  rowBody: { color: color.muted, fontSize: 12, lineHeight: 18, marginTop: 6 },
  // 「未读」是**要读的文字**（不是封面角标那类装饰），所以走 11pt 底线，不进
  // design-system-r3 的 R2 装饰白名单 —— 白名单只收符号/徽标，收它等于把底线
  // 自己调低（跟 HOME-I18N-001 那条「不许为了过测试去扩 SHARED_WORDS」同一个道理）。
  unreadTag: { color: foundation.danger, fontSize: 11, fontWeight: "900", marginTop: 8 }
});
