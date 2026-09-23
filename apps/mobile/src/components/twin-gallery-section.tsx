import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import type { PersonaGalleryItem } from "../ai-persona-client";
import type { MediaClient } from "../media-client";
import { color, foundation } from "../theme";
import { ProxyEmptyState } from "./proxy-foundation";
import { ProxyIcon } from "./proxy-icon";

// AI-TWIN-GALLERY-001 — 图库段（用户 2026-09-21 原型：deepseek_html_
// 20260921_663482.html「小美 · AI 分身（受众调度版）」）。
//
// AI-TWIN-GALLERY-005（2026-09-22，用户纠正概念："所谓的分身创建，并不是
// 说 copy 账户，而是 copy 真人账户的个人帖文主页，通过开关方式对特定人
// 群投放……不需要权限，仅仅需要主页之外的副空间，不对公共开放"）：
// 之前把"图库"接到了 AiPersonaClient 的 persona/consent 概念上——一个
// "AI 生成" tab 按 persona_id 查 AI 资产，整段要先 listMine 解析出一个
// 分身才有意义。这是错的模型：这一屏不是某个"AI 分身账户"的资产库，是
// 这个真人账户自己内容的一个私密副空间。图库因此只有一个真实来源——
// 这个人自己的照片（profilePosts 里带图的帖子 + 直接导入的），不再有
// "AI 生成"这个分支，也不再需要解析任何 persona。
//
// 原型里每张图的操作面板（AI 处理/直接发帖/裁剪/保存/重新生成/删除）
// 全部没有真实后端——这一版不做，那会是"点了没反应"或要另外写"开发中"
// toast 的假交互。真实能做的只有：横滑+展开成网格、点开看大图、导入。

export function TwinGallerySection({ rawGalleryItems, mediaClient }: {
  /** 这个人自己发过的带图帖子——跟「我的」个人主页图库同一份数据源
   * （profilePosts + profileMedia），在 me.tsx 里已经算好、URL 也已经
   * 解析成完整地址了，这里直接渲染。 */
  rawGalleryItems: PersonaGalleryItem[];
  /** 图库导入用——跟头像/帖子同一条上传管线。未传（比如离线会话）时
   * 导入格禁用，不是隐藏，让用户知道功能在但暂不可用。 */
  mediaClient: MediaClient | undefined;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<PersonaGalleryItem>();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string>();
  // AI-TWIN-GALLERY-005: 导入的照片如果没被发成帖子，不会出现在
  // profilePosts 里——这份本地乐观列表补住这条缝，导入成功立刻能看见，
  // 不用等它变成一条帖子才算数。
  const [importedItems, setImportedItems] = useState<PersonaGalleryItem[]>([]);

  async function importFromLibrary(): Promise<void> {
    if (!mediaClient || uploading) return;
    setUploadError(undefined);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setUploadError("请允许 Proxy 读取照片才能导入图库。"); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, selectionLimit: 1 });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset?.uri) return;
    setUploading(true);
    try {
      const uploaded = await mediaClient.uploadImage({ uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg", width: asset.width ?? 0, height: asset.height ?? 0 });
      setImportedItems((prev) => [{
        id: uploaded.mediaAssetId,
        thumbnailUrl: asset.uri, // 本地文件先渲染，不用等服务端缩略图
        aiGenerationSource: "USER_UPLOADED",
        createdAt: new Date().toISOString(),
      }, ...prev]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "导入失败，请稍后重试。");
    } finally {
      setUploading(false);
    }
  }

  const items = mergeGalleryItems(importedItems, rawGalleryItems);

  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Text style={styles.title}>图库 <Text style={styles.countBadge}>{items.length} 张</Text></Text>
        <Pressable accessibilityLabel={expanded ? "收起图库" : "展开图库"} onPress={() => setExpanded((prev) => !prev)}>
          <Text style={styles.expandBtn}>{expanded ? "收起" : "展开"}</Text>
        </Pressable>
      </View>

      {items.length === 0 && !mediaClient ? (
        <ProxyEmptyState sub="发过带图的帖子后，照片会出现在这里" title="还没有照片" />
      ) : expanded ? (
        <View style={styles.grid}>
          <UploadTile disabled={!mediaClient} onPress={() => void importFromLibrary()} style={styles.gridThumb} uploading={uploading} />
          {items.map((item) => <GalleryThumb item={item} key={item.id} onPress={() => setPreview(item)} style={styles.gridThumb} />)}
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.track}>
          <UploadTile disabled={!mediaClient} onPress={() => void importFromLibrary()} style={styles.trackThumb} uploading={uploading} />
          {items.map((item) => <GalleryThumb item={item} key={item.id} onPress={() => setPreview(item)} style={styles.trackThumb} />)}
        </ScrollView>
      )}
      {uploadError ? <Text style={styles.errorText}>{uploadError}</Text> : null}

      <Modal animationType="fade" onRequestClose={() => setPreview(undefined)} transparent visible={preview !== undefined}>
        <Pressable onPress={() => setPreview(undefined)} style={styles.previewBackdrop}>
          {preview ? <Image contentFit="contain" source={{ uri: preview.thumbnailUrl }} style={styles.previewImage} /> : null}
        </Pressable>
      </Modal>
    </View>
  );
}

function mergeGalleryItems(primary: PersonaGalleryItem[], fallback: PersonaGalleryItem[]): PersonaGalleryItem[] {
  const seen = new Set(primary.map((item) => item.id));
  const extra = fallback.filter((item) => !seen.has(item.id));
  return [...primary, ...extra];
}

function UploadTile({ disabled, onPress, style, uploading }: { disabled: boolean; onPress: () => void; style: object; uploading: boolean }): React.JSX.Element {
  return (
    <Pressable accessibilityLabel="导入照片到图库" disabled={disabled || uploading} onPress={onPress} style={[style, styles.uploadTile, disabled && styles.uploadTileDisabled]}>
      {uploading ? <ActivityIndicator color={color.muted} /> : (
        <>
          <ProxyIcon color={color.muted} name="plus" size={20} />
          <Text style={styles.uploadTileText}>{disabled ? "暂不可用" : "导入"}</Text>
        </>
      )}
    </Pressable>
  );
}

function GalleryThumb({ item, onPress, style }: { item: PersonaGalleryItem; onPress: () => void; style: object }): React.JSX.Element {
  return (
    <Pressable accessibilityLabel="查看照片" onPress={onPress} style={style}>
      <Image contentFit="cover" source={{ uri: item.thumbnailUrl }} style={StyleSheet.absoluteFill} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: foundation.space.four },
  head: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: foundation.space.three },
  title: { color: foundation.ink, fontSize: 18, fontWeight: "800" },
  countBadge: { color: color.muted, fontSize: 12, fontWeight: "700" },
  expandBtn: { color: color.muted, fontSize: 12, fontWeight: "700" },
  errorText: { color: "#b91c1c", fontSize: 12, paddingVertical: 12 },
  track: { gap: 6 },
  trackThumb: { backgroundColor: color.chipNeutralBg, borderRadius: 8, height: 108, marginRight: 6, overflow: "hidden", width: 108 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 3 },
  gridThumb: { aspectRatio: 1, backgroundColor: color.chipNeutralBg, borderRadius: 4, overflow: "hidden", width: "32.6%" },
  uploadTile: { alignItems: "center", borderColor: color.cardBorder, borderStyle: "dashed", borderWidth: 1.5, gap: 4, justifyContent: "center" },
  uploadTileDisabled: { opacity: 0.5 },
  uploadTileText: { color: color.muted, fontSize: 11, fontWeight: "700" },
  previewBackdrop: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.9)", flex: 1, justifyContent: "center" },
  previewImage: { height: "80%", width: "100%" },
});
