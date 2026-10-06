// scene-cover-card.tsx — home 热门场景卡的**唯一**实现（SCENE-CARD-REUSE-001）。
//
// 2026-10-06 用户（两张截图对比 home 场景卡 vs 发布向导里我自己手搓的场景行）：
// 「直接服用home那个就好 别自己傻傻的单独搞」。
//
// 此前 demand-wizard 的「选场景」步自己手搓了一份场景行（sceneRow + 方形头像），
// 和 home 的 hotCard 是两套形状两套样式 —— 用户明确否掉这种做法：场景卡只有
// home 这一份，别的页面要用就复用这个组件，不许再单搞第二份。
//
// 样式（原 hotCard / hotCover / hotCoverImage / …）从 requester-home 原样搬入，
// 一个数都没改：home 是这份卡的样子基准。
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { color } from "../theme";

export type SceneCoverCardProps = {
  accessibilityLabel?: string;
  /** 卡片标题，压在封面上的白字。 */
  name: string;
  /** 封面图 URL；相对路径由调用方解析好，空则垫 fallbackText 方块。 */
  imageUrl?: string | undefined;
  /** 无图垫底文字（home 用 type 前 2 字，如「咖啡」）。 */
  fallbackText: string;
  /** 封面下的说明行（home：category · area）。 */
  meta: string;
  /** 右上角距离角标（SCENE-DISTANCE-BADGE-001：所有场景必须标距离）；无则不画。 */
  distance?: string | undefined;
  /** 左上角角标文字（home：TOP N）；无则不画。 */
  badgeText?: string | undefined;
  /** 角标配色：first=洋红 / second=警示底 / 其余白底。 */
  badgeTone?: "first" | "second" | "plain";
  /** 底行左侧文案（home：N 人去过）；无则不画底行。 */
  footText?: string | undefined;
  /** 底行右侧评分（有才画 ★ x.x）。 */
  rating?: number | undefined;
  recyclingKey?: string;
  onPress: () => void;
};

export function SceneCoverCard({
  accessibilityLabel,
  name,
  imageUrl,
  fallbackText,
  meta,
  distance,
  badgeText,
  badgeTone,
  footText,
  rating,
  recyclingKey,
  onPress
}: SceneCoverCardProps): React.JSX.Element {
  return (
    <Pressable accessibilityLabel={accessibilityLabel ?? name} onPress={onPress} style={styles.card}>
      <View style={styles.cover}>
        {imageUrl ? (
          <Image cachePolicy="memory-disk" contentFit="cover" recyclingKey={recyclingKey ?? `scene-cover:${name}`} source={{ uri: imageUrl }} style={styles.coverImage} transition={0} />
        ) : (
          <View style={[styles.coverImage, styles.coverFallback]}><Text selectable style={styles.coverFallbackText}>{fallbackText}</Text></View>
        )}
        <View style={styles.coverShade} />
        {badgeText ? (
          <View style={[styles.badge, badgeTone === "first" && styles.badgeFirst, badgeTone === "second" && styles.badgeSecond]}>
            <Text selectable style={[styles.badgeText, (badgeTone === "first" || badgeTone === "second") && styles.badgeTextOn]}>{badgeText}</Text>
          </View>
        ) : null}
        {distance ? <View style={styles.distanceBadge}><Text selectable style={styles.distanceText}>{distance}</Text></View> : null}
        <Text selectable style={styles.coverTitle} numberOfLines={2}>{name}</Text>
      </View>
      <View style={styles.body}>
        <Text selectable style={styles.meta} numberOfLines={1}>{meta}</Text>
        {footText || rating !== undefined ? (
          <View style={styles.foot}>
            {footText ? <Text selectable style={styles.count}>{footText}</Text> : null}
            {rating !== undefined ? (
              <View style={styles.ratingRow}>
                <Text selectable style={styles.ratingStar}>★</Text>
                <Text selectable style={styles.ratingText}>{rating.toFixed(1)}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

// 样式自 requester-home.tsx 的 hot* 系列原样搬入（2026-10-06），数值没动。
const styles = StyleSheet.create({
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, overflow: "hidden", width: 156 },
  cover: { height: 104, justifyContent: "flex-end", position: "relative" },
  coverImage: { height: "100%", position: "absolute", width: "100%" },
  coverFallback: { alignItems: "center", backgroundColor: color.surface, justifyContent: "center" },
  coverFallbackText: { color: color.muted, fontSize: 22, fontWeight: "900" },
  coverShade: { backgroundColor: "rgba(23, 19, 31, 0.42)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  badge: { alignItems: "center", backgroundColor: color.white, borderRadius: 6, left: 8, paddingHorizontal: 7, paddingVertical: 3, position: "absolute", top: 8 },
  badgeFirst: { backgroundColor: color.magenta },
  badgeSecond: { backgroundColor: color.factUnknownBg },
  badgeText: { color: color.ink, fontSize: 11, fontWeight: "900", letterSpacing: 0.2 },
  badgeTextOn: { color: color.white },
  distanceBadge: { alignItems: "center", backgroundColor: "rgba(23,19,31,0.55)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, position: "absolute", right: 8, top: 8 },
  distanceText: { color: color.white, fontSize: 11, fontWeight: "900", letterSpacing: 0.2 },
  coverTitle: { bottom: 10, color: color.white, fontSize: 14.5, fontWeight: "900", left: 12, position: "absolute", right: 12, textShadowColor: "rgba(0, 0, 0, 0.5)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  body: { gap: 6, padding: 12, paddingTop: 10 },
  meta: { color: color.muted, fontSize: 11, fontWeight: "700" },
  foot: { alignItems: "center", borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingTop: 8 },
  count: { color: color.muted, fontSize: 11, fontWeight: "800" },
  ratingRow: { alignItems: "center", flexDirection: "row", gap: 3 },
  ratingStar: { color: "#F5B400", fontSize: 11 },
  ratingText: { color: "#8C6A00", fontSize: 11, fontWeight: "900" }
});
