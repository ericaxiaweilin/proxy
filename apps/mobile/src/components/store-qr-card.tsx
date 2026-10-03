import { useRef, useState } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { captureRef } from "react-native-view-shot";

import { color } from "../theme";
import { ProxyIcon } from "../components/proxy-icon";
import { ProxyQrCode } from "../components/proxy-qr-code";
import { buildContactCard } from "../profile-qr";
import { describeError, saveImageToAlbum } from "../image-export";

// STORE-CONSOLIDATE-001（2026-10-02，用户「管理别人看到你的店 有重复的ab版本」选收编）：
// 店铺二维码卡原来嵌在 MerchantStorefrontSurface 里（多店列表语境，ref 按店分键、
// notice 按店分、`zoomedStore` 存 id+name）。搬到"我的店铺"店详情里时，上下文变成
// **单店** —— ref 不用分键、notice 不用带店 id、zoom 不用存名字（标题还在）。
// 所以这里是重写成单店组件，不是把原来那份整段复制过来。原来那份在旧 surface 里
// 原样保留，直到旧 surface 下线（一次只动一边，树不能停在中间态）。
export function StoreQrCard({ storeId, storeName }: { storeId: string; storeName: string }): React.JSX.Element {
  const qrRef = useRef<View | null>(null);
  const zoomShotRef = useRef<View | null>(null);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [zoomed, setZoomed] = useState(false);

  async function copyName(): Promise<void> {
    try {
      await Clipboard.setStringAsync(storeName);
      setNotice(`已复制「${storeName}」—— 让对方在 Proxy 里搜它就能找到这家店。`);
    } catch {
      setNotice("复制失败，请长按店名手动复制。");
    }
  }

  async function saveShot(shot: { current: View | null }): Promise<void> {
    try {
      const uri = await captureRef(shot, { format: "png", quality: 1 });
      const result = await saveImageToAlbum(uri);
      setNotice(
        result.ok
          ? "二维码已保存到相册。"
          : result.code === "permission"
            ? "需要相册权限才能保存二维码。"
            : `保存失败：${result.reason}`
      );
    } catch (err) {
      setNotice(`保存失败：${describeError(err)}`);
    }
  }

  return (
    <View>
      <View style={styles.qrCard}>
        <View ref={qrRef} collapsable={false} style={styles.qrShot}>
          <Pressable accessibilityLabel="放大店铺二维码" accessibilityRole="button" onPress={() => setZoomed(true)}>
            <ProxyQrCode size={104} value={buildContactCard({ name: storeName, storeId }) ?? storeName} />
          </Pressable>
        </View>
        <View style={styles.copy}>
          <Text selectable style={styles.title}>店铺二维码</Text>
          <Text selectable style={styles.meta}>扫这张码会把「{storeName}」存成联系人（标准 vCard 名片），任何手机的相机都能扫。可用于店内桌牌、海报和 Creator 分享。</Text>
          <View style={styles.actions}>
            <Pressable onPress={() => void copyName()} style={styles.previewButton} accessibilityLabel="复制店名">
              <Text selectable style={styles.previewButtonText}>复制店名</Text>
            </Pressable>
            <Pressable onPress={() => void saveShot(qrRef)} style={styles.shareButton} accessibilityLabel="保存店铺二维码到相册">
              <Text selectable style={styles.shareButtonText}>保存到相册</Text>
            </Pressable>
            <Pressable
              onPress={() => void Share.share({ message: `${storeName} · 在 Proxy 里搜这家店就能找到。` })}
              style={styles.shareButton}
              accessibilityLabel="分享店铺"
            >
              <Text selectable style={styles.shareButtonText}>分享店铺</Text>
            </Pressable>
          </View>
          {notice ? <Text selectable style={styles.notice}>{notice}</Text> : null}
        </View>
      </View>
      {zoomed ? (
        <View style={styles.zoomBackdrop}>
          <View ref={zoomShotRef} collapsable={false} style={styles.zoomShot}>
            <ProxyQrCode size={220} value={buildContactCard({ name: storeName, storeId }) ?? storeName} />
            <Text selectable style={styles.zoomName}>{storeName}</Text>
          </View>
          <View style={styles.zoomActions}>
            <Pressable onPress={() => void saveShot(zoomShotRef)} style={styles.shareButton} accessibilityLabel="保存放大的二维码">
              <Text selectable style={styles.shareButtonText}>保存到相册</Text>
            </Pressable>
            <Pressable onPress={() => setZoomed(false)} style={styles.previewButton} accessibilityLabel="关闭放大">
              <Text selectable style={styles.previewButtonText}>关闭</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  qrCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 12, marginTop: 8, padding: 12 },
  qrShot: { backgroundColor: color.white, borderRadius: 12, padding: 6 },
  copy: { flex: 1, gap: 6, minWidth: 0 },
  title: { color: color.ink, fontSize: 13, fontWeight: "800" },
  meta: { color: color.muted, fontSize: 11, lineHeight: 16 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  previewButton: { borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 7 },
  previewButtonText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  shareButton: { backgroundColor: color.ink, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  shareButtonText: { color: color.white, fontSize: 11, fontWeight: "800" },
  notice: { color: color.muted, fontSize: 11, lineHeight: 15 },
  zoomBackdrop: { alignItems: "center", backgroundColor: "rgba(0,0,0,.55)", borderRadius: 16, gap: 12, marginTop: 8, padding: 18 },
  zoomShot: { alignItems: "center", backgroundColor: color.white, borderRadius: 16, gap: 8, padding: 16 },
  zoomName: { color: color.ink, fontSize: 13, fontWeight: "800" },
  zoomActions: { flexDirection: "row", gap: 8 },
});

export function StoreQrCardPlaceholder(): React.JSX.Element {
  return (
    <View style={styles.qrCard}>
      <View style={styles.qrShot}>
        <ProxyIcon color={color.muted} name="qrGrid" size={40} />
      </View>
      <View style={styles.copy}>
        <Text selectable style={styles.title}>店铺二维码</Text>
        <Text selectable style={styles.meta}>门店建好后在这里生成可扫的二维码。</Text>
      </View>
    </View>
  );
}
