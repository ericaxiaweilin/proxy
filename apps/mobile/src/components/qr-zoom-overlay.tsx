// 放大层：点二维码进来的全屏展示态。全 App 共用一个，不再各页自己搭 Modal。
//
// 版式照参考样式来：**深色标题条 + 大片纯白码区 + 底部灰色提示**。
// 为什么码区是纯白而不是深色底：这一层的唯一目的是**让对方扫得到**。
// 白底 + 尽可能大的码 = 屏幕能给出的最高亮度，也是微信 / 支付宝 / TikTok 出示码那一屏
// 的做法。码区刻意不加边框/阴影 —— 存到相册的那张图就是它，白边本身就是静默区。
//
// 关于「真·屏幕亮度」：进入这一层把系统亮度拉到最高、退出时还原 —— 微信 / 支付宝出示码那一屏
// 的做法。逻辑在 `../lib/screen-brightness`（延迟 require 的原因、还原语义都在那边写清楚了），
// 「我的二维码」页共用同一份实现，不各写一遍。
//
// 同一时刻只有一个放大层是 visible（各页互斥），所以不会两个 hook 互相抢亮度。

import { type RefObject } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ProxyQrCode } from "./proxy-qr-code";
import { ProxyIcon } from "./proxy-icon";
import { color } from "../theme";
import { useScreenBrightness } from "../lib/screen-brightness";

export type QrZoomAction = { label: string; onPress: () => void; primary?: boolean };

export type QrZoomOverlayProps = {
  visible: boolean;
  onClose: () => void;
  /**
   * 二维码**内容**（编码进码里的那份）。现在是一整张 vCard 名片文本 ——
   * 所以它**不是**给用户看的那串，展示请用 `caption`。
   */
  value: string;
  /** 码下方展示 / 复制的那串。人给 `@handle`（App 搜得到的就是这个），店铺给店名。 */
  caption: string;
  title: string;
  /** 底部说明，默认是给扫码方的提示。 */
  hint?: string | undefined;
  actions?: QrZoomAction[] | undefined;
  /** 动作结果（复制成功 / 存图失败…）必须出得来，否则用户看到的就是「按了没反应」。 */
  notice?: string | undefined;
  /** 传入则把码区块挂到这个 ref 上，供截图存相册用。 */
  shotRef?: RefObject<View | null> | undefined;
};

export function QrZoomOverlay({
  visible,
  onClose,
  value,
  caption,
  title,
  hint = "把屏幕朝向对方即可扫描；长按可识别图中二维码。",
  actions,
  notice,
  shotRef,
}: QrZoomOverlayProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  // 码要尽可能大，但不能把标题条/提示/按钮挤出去。
  const chromeHeight = insets.top + insets.bottom + 288;
  const maxByHeight = Math.max(160, height - chromeHeight);
  const maxByWidth = width - 56;
  const qrSize = Math.floor(Math.min(maxByWidth, maxByHeight));

  // 亮着这一层时把屏幕拉到最亮，退出还原（实现与还原语义见 ../lib/screen-brightness）。
  useScreenBrightness(visible);

  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent visible={visible}>
      <View style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <View style={styles.badge}>
            <ProxyIcon color={color.white} name="qrGrid" size={20} />
          </View>
          <Text numberOfLines={2} style={styles.title}>
            {title}
          </Text>
          <Pressable accessibilityLabel="关闭" accessibilityRole="button" onPress={onClose} style={styles.close}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          style={styles.bodyScroll}
        >
          <View ref={shotRef} collapsable={false} style={styles.shot}>
            <ProxyQrCode size={qrSize} value={value} />
          </View>
          <Text selectable style={styles.link}>
            {caption}
          </Text>
        </ScrollView>

        <Text style={styles.hint}>{hint}</Text>

        {actions && actions.length > 0 ? (
          <View style={styles.actions}>
            {actions.map((a) => (
              <Pressable
                accessibilityLabel={a.label}
                accessibilityRole="button"
                key={a.label}
                onPress={a.onPress}
                style={[styles.btn, a.primary ? styles.btnPrimary : styles.btnGhost]}
              >
                <Text style={a.primary ? styles.btnPrimaryText : styles.btnGhostText}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        <View style={{ height: insets.bottom + 16 }} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.white, flex: 1 },
  // 标题条整条出血，和参考样式一致：深色条压住顶部，下面留给码。
  header: {
    alignItems: "center",
    backgroundColor: color.ink,
    flexDirection: "row",
    gap: 12,
    paddingBottom: 14,
    paddingHorizontal: 20,
  },
  badge: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 999,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  title: { color: color.white, flex: 1, fontSize: 20, fontWeight: "800" },
  close: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 999,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  closeText: { color: color.white, fontSize: 15, fontWeight: "700" },
  bodyScroll: { flexGrow: 0, marginTop: 18 },
  body: { alignItems: "center", paddingHorizontal: 28 },
  // 不加边框/阴影：存到相册的就是这一块，白边即静默区。
  shot: { alignItems: "center", backgroundColor: color.white, justifyContent: "center", padding: 18 },
  link: { color: color.muted, fontSize: 12, marginTop: 14, textAlign: "center" },
  hint: { color: color.muted, fontSize: 13, marginTop: 16, paddingHorizontal: 28, textAlign: "center" },
  actions: { flexDirection: "row", gap: 10, marginTop: 14, paddingHorizontal: 28 },
  btn: { alignItems: "center", borderRadius: 999, flex: 1, paddingVertical: 12 },
  btnPrimary: { backgroundColor: color.ink },
  btnGhost: { backgroundColor: color.surface },
  btnPrimaryText: { color: color.white, fontSize: 13, fontWeight: "700" },
  btnGhostText: { color: color.ink, fontSize: 13, fontWeight: "700" },
  notice: { color: color.ink, fontSize: 12, marginTop: 10, paddingHorizontal: 28, textAlign: "center" },
});
