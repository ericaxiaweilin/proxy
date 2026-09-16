// 放大层：点二维码进来的全屏展示态。全 App 共用一个，不再各页自己搭 Modal。
//
// 版式照参考样式来：**深色标题条 + 大片纯白码区 + 底部灰色提示**。
// 为什么码区是纯白而不是深色底：这一层的唯一目的是**让对方扫得到**。
// 白底 + 尽可能大的码 = 屏幕能给出的最高亮度，也是微信 / 支付宝 / TikTok 出示码那一屏
// 的做法。码区刻意不加边框/阴影 —— 存到相册的那张图就是它，白边本身就是静默区。
//
// 关于「真·屏幕亮度」：进入这一层把系统亮度拉到最高、退出时还原 —— 微信 / 支付宝出示码那一屏
// 的做法（`expo-brightness`；iOS 不需要任何 Info.plist 权限）。
//
// **坑：绝不能在模块顶层 `import`。** `expo-brightness/build/ExpoBrightness.js` 在**模块作用域**
// 就执行 `requireNativeModule('ExpoBrightness')`，而 `requireNativeModule` 在原生模块缺失时是
// **抛异常**、不是返回 null（见 `expo-modules-core/src/requireNativeModule.ts`）。本组件挂在
// me.tsx / merchant-storefront / friend-crm 的正常 import 图里 —— 顶层 import 会让**还没装这个
// pod 的包一启动就崩**。所以走 `loadBrightness()` 延迟 require + try/catch：原生模块不在就当没这
// 功能，白底满屏照样生效。`expo-modules-core` 的 `requireOptionalNativeModule` 看着更合适，但
// 那个包在 apps/mobile 下**没有声明**（pnpm 严格布局下从 apps/mobile 解析不到），不能直接引。
//
// 生效前提：`pod install` + **重建 dev client**（Metro reload 不够 —— 原生模块不在 JS 里）。
// 还原：进入时先 `getBrightnessAsync()` 存原值再拉满，退出 / 卸载时写回；读不到原值就什么都不写
// （宁可还原不了，也不要瞎写一个值）。同一时刻只有一个放大层 visible（各页互斥），不会互相抢。

import { type RefObject, useEffect } from "react";
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

export type QrZoomAction = { label: string; onPress: () => void; primary?: boolean };

export type QrZoomOverlayProps = {
  visible: boolean;
  onClose: () => void;
  /** 二维码内容。组件内部会再归一一次，传短式也安全。同时也是码下方展示/复制的那串。 */
  value: string;
  title: string;
  /** 底部说明，默认是给扫码方的提示。 */
  hint?: string | undefined;
  actions?: QrZoomAction[] | undefined;
  /** 动作结果（复制成功 / 存图失败…）必须出得来，否则用户看到的就是「按了没反应」。 */
  notice?: string | undefined;
  /** 传入则把码区块挂到这个 ref 上，供截图存相册用。 */
  shotRef?: RefObject<View | null> | undefined;
};

type BrightnessApi = {
  getBrightnessAsync: () => Promise<number>;
  setBrightnessAsync: (brightnessValue: number) => Promise<void>;
};

/**
 * 延迟加载 expo-brightness。返回 undefined = 这个包里没有对应原生模块（还没重建 dev client），
 * 调用方静默降级。**别把它换成顶层 import** —— 原因见文件头注释（会一启动就崩）。
 */
function loadBrightness(): BrightnessApi | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("expo-brightness") as Partial<BrightnessApi>;
    if (typeof mod.getBrightnessAsync !== "function" || typeof mod.setBrightnessAsync !== "function") {
      return undefined;
    }
    return mod as BrightnessApi;
  } catch {
    return undefined;
  }
}

export function QrZoomOverlay({
  visible,
  onClose,
  value,
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

  // 真·屏幕亮度：亮着这一层时拉满，退出还原。为什么是延迟 require 而不是顶层 import，见文件头。
  useEffect(() => {
    if (!visible) return undefined;
    const brightness = loadBrightness();
    if (!brightness) return undefined;

    // 一条链：读原值 → 拉满 → 把原值带出来。任何一步失败都退化成 undefined（= 不还原）。
    const restoreTo = brightness
      .getBrightnessAsync()
      .then(async (before) => {
        await brightness.setBrightnessAsync(1);
        return before;
      })
      .catch(() => undefined);

    return () => {
      // 挂到同一条链上：快速开关时也要等原值读到再还原，否则亮度会卡在 1 下不来。
      void restoreTo.then((before) => {
        if (before === undefined) return;
        void brightness.setBrightnessAsync(before).catch(() => {});
      });
    };
  }, [visible]);

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
            {value}
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
