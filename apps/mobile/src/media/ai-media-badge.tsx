/**
 * ai-media-badge.tsx — 「AI 生成」标注的唯一**挂载件**（LC-06 显示侧）。
 *
 * 判定口径只有一处：`ai-media-label.ts` 的 `aiMediaLabel()`（AI_PERSONA /
 * MODEL_API → 「AI 生成」；USER_UPLOADED / 缺省 → 不标）。本文件只负责画。
 *
 * 为什么做成组件、而不是在各渲染分支里内联：
 *
 * 2026-09-21 的第一次修复只把标注加在 `AdaptiveMediaCollection` 的**单图**
 * 分支里（`renderKindAwareStage` 的图片分支）。于是这些形状全都没标注：
 *
 *   - 多图帖 —— `mediaCollectionMode()` 判成 RAIL，走 `AdaptiveMediaRail`
 *     → 每张卡走 `SocialMediaFrame`，那条路根本没经过 `renderKindAwareStage`
 *   - AI 生成的视频 —— `renderKindAwareStage` 的 VIDEO 分支在算 `aiLabel`
 *     **之前**就 `return` 了
 *   - 个人主页 —— `me.tsx` / `other-profile.tsx` 直接调 `SinglePostImage`，
 *     不经过集合组件
 *
 * 都是同一件事：**AI 做的媒体对用户可见，但没有标注**。所以标注要挂在
 * 「画媒体的叶子组件」上（`SinglePostImage` / `SocialMediaFrame`，视频挂它的
 * 两个容器分支），而不是挂在某一个集合组件的某一个分支里。
 *
 * 用户口径（2026-09-21）：「ai做的 就标注 法规要求要满足」，并且
 * **公共空间（发帖文）是明确需要的**那一处 —— 本组件就是为它覆盖全部形状。
 */
import { StyleSheet, Text, View } from "react-native";
import type { FeedMediaItem } from "@proxy/contracts";
import { aiMediaLabel } from "./ai-media-label";
import { color } from "../theme";
import { SOCIAL_MEDIA_BADGE_INSET } from "./social-media-aesthetics";

export function AIMediaBadge({
  item,
  inline
}: {
  item: Pick<FeedMediaItem, "aiGenerationSource">;
  /**
   * 行内变体（全屏查看器 MediaViewer 的顶栏用）。
   * 顶栏本身是 `position:absolute` 的 flex row，标注在里面不能再 absolute ——
   * 否则会盖住右上角的关闭按钮。行内时由父级 row 负责居中。
   */
  inline?: boolean;
}): React.JSX.Element | null {
  const label = aiMediaLabel(item.aiGenerationSource);
  if (!label) return null;
  return (
    // pointerEvents="none"：标注是覆盖层，不能吃掉「点开原图」的手势 ——
    // 那比不显示标注更糟（用户点不开图）。
    <View pointerEvents="none" style={inline ? styles.badgeInline : styles.badge}>
      <Text selectable style={styles.badgeText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // 跟 videoBadge / railBadge 同一套视觉。挂**右上角**：视频角标在左上、
  // 多图的 "1/N" 角标在右下，三者同框也不打架。
  badge: {
    alignItems: "center",
    backgroundColor: "rgba(14,10,20,0.55)",
    borderRadius: 999,
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingVertical: 3,
    position: "absolute",
    right: SOCIAL_MEDIA_BADGE_INSET,
    top: SOCIAL_MEDIA_BADGE_INSET
  },
  // 行内变体：跟 badge 同一套视觉，只是不定位（由父级 flex row 摆放）。
  badgeInline: {
    alignItems: "center",
    backgroundColor: "rgba(14,10,20,0.55)",
    borderRadius: 999,
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  // 11pt：design-system-r3 的「UI 文案不小于 11pt」下限。别往下调。
  badgeText: { color: color.white, fontSize: 11, fontWeight: "700" }
});
