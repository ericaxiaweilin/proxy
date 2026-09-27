// tasks.tsx — ActivityFeedCard + ActivityDetail exports
// shared by the Market and Tasks surfaces. TasksSurface
// itself (the workspace entry points) was removed in
// R18.x: the workspace entry pattern is now driven by
// the live supply / fulfillment surfaces, not by the
// 2 hardcoded "进行中 / 已完成" rows this file used to
// carry. Origin / AI persona colour / activity detail
// remain canonical here so the Market activity cards
// keep the R17.x visual baseline.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import type { Activity } from "@proxy/contracts";
import { type ActivityClient } from "../activity-client";
import { color, Gradient, shadows } from "../theme";
import { activityAIPersonaName } from "./activity-detail-model";

// origin 徽标 — 指“发布人身份”（平台 / 商家 / 用户 / TEST）。
// AI 状态在 aiStatus / aiActorKind / aiPersona* 表达，origin
// 枚举不混入 AI。
const ORIGIN_META: Record<string, { label: string; bg: string; fg: string }> = {
  PLATFORM: { label: "平台", bg: "#EFE6FF", fg: "#5A37B8" },
  BUSINESS: { label: "商家", bg: "#FFE9DD", fg: "#A6551F" },
  USER: { label: "用户", bg: "#E5F1FF", fg: "#215AA8" },
  TEST: { label: "测试", bg: "#E7E7EA", fg: "#56565C" }
};


// R17.x: persona 颜色色版. ai_001-ai_005 各自不同色背景, 同
// SVG 文件主题色. surface 渲染需要快速到于 assets/ SVG, 这里
// 用 View 画一个 32x32 圆形 + 同色背景, 后续 SVG Image 准备好
// 后再换成 require().
function personaColorStyle(personaId: string): { backgroundColor: string } {
  switch (personaId) {
    case "ai_001": return { backgroundColor: "#7C5CFF" }; // 周末企划: 紫
    case "ai_002": return { backgroundColor: "#FF7A8A" }; // 拍照季: 粉
    case "ai_003": return { backgroundColor: "#3FCBA8" }; // 拍照搭子: 绿
    case "ai_004": return { backgroundColor: "#FF9D44" }; // 餐厅尝鲜: 橙
    case "ai_005": return { backgroundColor: "#FFB347" }; // 饭局推荐: 金
    default: return { backgroundColor: "#7C5CFF" };
  }
}

export function ActivityFeedCard({ item, onPress }: { item: Activity; onPress: () => void }): React.JSX.Element {
  const origin = ORIGIN_META[item.origin] ?? ORIGIN_META.TEST!;
  return (
    <Pressable onPress={onPress} style={styles.exampleCard}>
      <View style={styles.exampleHead}>
        <View style={styles.exampleTitle}>
          <View style={[styles.originBadge, { backgroundColor: origin.bg }]}>
            <Text selectable style={[styles.originBadgeText, { color: origin.fg }]}>{origin.label}</Text>
          </View>
          {item.aiStatus !== "NONE" ? (
            // R17.x: 平台 AI 角色 photo 资产。三件 (id / name / photo)
            // 总是同时下发. mobile 优先用 personaPhotoColor (从
            // persona id 推出: ai_001=紫/ai_002=粉/...) 在 32x32
            // 圆环背景上渲染 "AI 虚拟" badge + 表情. 不能
            // “看起来像真人”: 不使用真人指提, 全部由 SVG 或
            // code-defined asset 拼出. SVG 文件位于
            // apps/mobile/assets/ai-personas/ (R17.x INDEX.md)
            // — 未来 expo-image SVG 支持上线后渲染。
            <View style={styles.exampleAIPersonaRow}>
              <View style={[styles.exampleAIPersonaCircle, personaColorStyle(item.aiPersonaId ?? "")]}>
                <Text selectable style={styles.exampleAIPersonaCircleText}>{item.aiPersonaAvatar ?? "🤖"}</Text>
              </View>
              <View>
                <Text selectable style={styles.exampleAIPersona}>
                  {activityAIPersonaName(item)} · {item.aiStatus === "AI_GENERATED" ? "AI 生成，平台审核发布" : "AI 辅助"}
                </Text>
                <Text selectable style={styles.exampleAIPersonaBadge}>AI 虚拟形象</Text>
              </View>
            </View>
          ) : null}
          <Text selectable style={styles.exampleName}>{item.title}</Text>
          <Text selectable style={styles.exampleMeta}>
            {item.time} · {item.people}
          </Text>
        </View>
        <View style={styles.examplePrice}>
          <Text selectable style={styles.examplePriceStrong}>{item.price}</Text>
          <Text selectable style={styles.examplePriceSmall}>{item.priceLabel}</Text>
        </View>
      </View>
      <View style={styles.venue}>
        <View style={styles.venueIcon}>
          <Text selectable style={styles.venueIconText}>{item.venueIcon}</Text>
        </View>
        <View style={styles.venueCopy}>
          <Text selectable style={styles.venueName}>{item.venueName}</Text>
          <Text selectable style={styles.venueNote}>
            {item.consumption} · 预计 {item.venueSpend}
          </Text>
        </View>
        <View style={styles.venueTag}>
          <Text selectable style={styles.venueTagText}>平台商家</Text>
        </View>
      </View>
      {/* 基线 .activitysignals：感兴趣 / 已参加 / 分享 */}
      <View style={styles.activitySignals}>
        <Text selectable style={styles.activitySignalText}>◉ {item.interested} 人感兴趣</Text>
        <Text selectable style={styles.activitySignalText}>
          ✓ {item.joined}
          {item.capacity ? `/${item.capacity}` : ""} 已参加
        </Text>
        <Text selectable style={styles.activitySignalText}>↗ {item.shares} 次分享</Text>
      </View>
      {item.parentTitle ? (
        <View style={styles.linkLine}>
          <Text selectable style={styles.linkLineText}>关联：{item.parentTitle}</Text>
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
  onBack,
  notice
}: {
  item: Activity;
  interested: boolean;
  joined: boolean;
  busy: boolean;
  onToggleInterested: () => void;
  onJoin: () => void;
  onOpenRealityScene?: ((sceneId: string) => void) | undefined;
  onBack: () => void;
  // 感兴趣/报名失败的诚实文案（调用方用 describeJoinError 组装）。
  notice?: string | undefined;
}): React.JSX.Element {
  const origin = ORIGIN_META[item.origin] ?? ORIGIN_META.TEST!;
  const isCafe = item.venueType === "CAFE";
  return (
    <>
      {/* 基线 .detailhero：深色渐变 + originbadge + 价格 */}
      {/*
        ACTIVITY-DETAIL-HERO-001：这里必须传**颜色值**（color.ink），不能传 token
        **名字**（"color.ink"）。Gradient 内部是 `backgroundColor: from` +
        `lerpHex(from, to, t)`（theme.tsx:158/180），lerpHex 按 hex 切片 parseInt ——
        传名字进去会得到 rgb(NaN,NaN,NaN)，整块渐变静默变成透明。
        而这一块里所有文字都是给深色底设计的（detailTitle/detailPriceStrong 是
        color.white，desc 是 #D8D1DF），底一透明就变成浅色页面上写白字：标题整个看不见。
        症状是「文字消失」，病根在渐变参数上 —— 别去改文字颜色。
      */}
      <Gradient from={color.ink} to="#342446" style={styles.detailHero}>
        <View style={styles.detailTopLine}>
          <View style={[styles.originBadge, { backgroundColor: origin.bg }]}>
            <Text selectable style={[styles.originBadgeText, { color: origin.fg }]}>{origin.label}</Text>
          </View>
          <View style={styles.detailPrice}>
            <Text selectable style={styles.detailPriceStrong}>{item.price}</Text>
            <Text selectable style={styles.detailPriceSmall}>{item.priceLabel}</Text>
          </View>
        </View>
        {item.aiStatus !== "NONE" ? (
          <View style={styles.detailAIPersonaRow}>
            <View style={[styles.detailAIPersonaAvatarCircle, personaColorStyle(item.aiPersonaId ?? "")]}>
              <Text selectable style={styles.detailAIPersonaAvatarEmoji}>{item.aiPersonaAvatar ?? "🤖"}</Text>
            </View>
            <View style={styles.detailAIPersonaTextCol}>
              <Text selectable style={styles.detailAIPersonaName}>{activityAIPersonaName(item)}</Text>
              <Text selectable style={styles.detailAIPersonaDisclaimer}>{item.aiStatus === "AI_GENERATED" ? "AI 生成冷启动内容 · 由 Proxy 审核并作为发布方 · AI 不能报名或收款" : "AI 辅助整理 · 发布方承担责任"}</Text>
            </View>
          </View>
        ) : null}
        <Text selectable style={styles.detailTitle}>{item.title}</Text>
        <Text selectable style={styles.detailDesc}>{item.desc}</Text>
      </Gradient>

      {/* 基线 .sceneanchor：深色场地锚点 */}
      <View style={styles.sceneAnchor}>
        <View style={styles.sceneIcon}>
          <Text selectable style={styles.sceneIconText}>{item.venueIcon}</Text>
        </View>
        <View style={styles.sceneCopy}>
          <Text selectable style={styles.sceneName}>{item.venueName}</Text>
          <Text selectable style={styles.sceneNote}>
            {item.venueTypeLabel} · {item.time}
          </Text>
          <Text selectable style={styles.sceneNote}>
            {item.consumption} · 预计消费 {item.venueSpend}
          </Text>
        </View>
        <Text selectable style={styles.sceneTag}>平台商家</Text>
      </View>

      {/* 基线 .benefitbox：lime 权益盒 */}
      <View style={styles.benefitBox}>
        <Text selectable style={styles.benefitTitle}>本场可用权益</Text>
        <Text selectable style={styles.benefitText}>{item.benefit}</Text>
      </View>

      <View style={styles.activitySignals}>
        <Text selectable style={styles.activitySignalText}>◉ {item.interested} 人感兴趣</Text>
        <Text selectable style={styles.activitySignalText}>
          ✓ {item.joined}
          {item.capacity ? `/${item.capacity}` : ""} 已参加
        </Text>
        <Text selectable style={styles.activitySignalText}>↗ {item.shares} 次分享</Text>
      </View>

      {/* 基线 .activitysocialbar：感兴趣（不是点赞）+ 分享 */}
      <View style={styles.socialBar}>
        <Pressable onPress={onToggleInterested} disabled={busy} style={[styles.socialBtn, interested && styles.socialBtnOn]}>
          <Text selectable style={[styles.socialBtnText, interested && styles.socialBtnTextOn]}>
            {busy ? "…" : interested ? "✓ 已感兴趣" : "☆ 感兴趣"}
          </Text>
        </Pressable>
        <Pressable onPress={() => void Share.share({ message: `${item.title} · ${item.time} · ${item.venueName} — Proxy` })} style={styles.socialBtn} accessibilityLabel="分享活动">
          <Text selectable style={styles.socialBtnText}>↗ 分享活动</Text>
        </Pressable>
      </View>
      {notice ? <Text selectable style={styles.errorText}>{notice}</Text> : null}

      {item.parentTitle ? (
        <View style={styles.linkLine}>
          <Text selectable style={styles.linkLineText}>关联活动：{item.parentTitle}</Text>
        </View>
      ) : null}

      {/* 基线 .qabox：公开层结构化问答，不是开放评论区 */}
      <View style={styles.qaBox}>
        <View style={styles.qaHead}>
          <Text selectable style={styles.qaHeadTitle}>活动问答 · {item.qaCount}</Text>
          <Text selectable style={styles.qaHeadMore}>查看 / 提问 →</Text>
        </View>
        <View style={styles.qaItem}>
          <Text selectable style={styles.qaQuestion}>饮品怎么付？</Text>
          <Text selectable style={styles.qaAnswer}>
            {item.consumption === "各自消费" ? "各自按门店实际消费结算。" : item.consumption}
          </Text>
          <Text selectable style={styles.qaWho}>发起人已回答</Text>
        </View>
        <View style={styles.qaItem}>
          {isCafe ? (
            <>
              <Text selectable style={styles.qaQuestion}>必须带相机吗？</Text>
              <Text selectable style={styles.qaAnswer}>不用，手机也可以；重点是互相拍照。</Text>
              <Text selectable style={styles.qaWho}>发起人已回答</Text>
            </>
          ) : (
            <>
              <Text selectable style={styles.qaQuestion}>需要提前到吗？</Text>
              <Text selectable style={styles.qaAnswer}>按活动时间到店即可，座位由门店保留。</Text>
              <Text selectable style={styles.qaWho}>商家已回答</Text>
            </>
          )}
        </View>
      </View>

      {/* 基线 .verifiedreview：往期参与者反馈（实际到店） */}
      <View style={styles.reviewBox}>
        <View style={styles.reviewHead}>
          <Text selectable style={styles.reviewTitle}>往期参与者反馈</Text>
          <Text selectable style={styles.reviewBadge}>实际到店</Text>
        </View>
        <Text selectable style={styles.reviewText}>
          {isCafe ? "“座位拍照光线不错，活动人数刚好，不会太尴尬。”" : "“场次组织比较顺，套餐规则提前写清楚了，到店不用再沟通。”"}
        </Text>
      </View>

      {/* 参加状态与 CTA：确认参加后才开放群聊 */}
      {joined ? (
        <View style={styles.joinState}>
          <Text selectable style={styles.joinStateTitle}>你已参加这场活动</Text>
          <Text selectable style={styles.joinStateText}>活动群聊仅向已确认参与者开放，用于到店前必要沟通。群聊入口尚未接入，不显示假按钮。</Text>
        </View>
      ) : item.origin === "USER" || (item.aiStatus !== "NONE" && item.aiActorKind === "USER_TWIN") ? null : (
        <Gradient from={color.magenta} to={color.violet} style={styles.ctaPrimary}>
          <Pressable onPress={onJoin} disabled={busy} style={styles.ctaPrimaryInner}>
            <Text selectable style={styles.ctaPrimaryText}>{busy ? "处理中…" : "参加活动"}</Text>
          </Pressable>
        </Gradient>
      )}
      {item.origin !== "USER" ? (
        <Pressable onPress={() => void Share.share({ message: `${item.title} · ${item.time} · ${item.venueName} — Proxy` })} style={styles.ctaLight} accessibilityLabel="找人一起参加">
          <Text selectable style={styles.ctaLightText}>找人一起参加</Text>
        </Pressable>
      ) : null}
      {item.aiStatus === "AI_GENERATED" || item.aiStatus === "AI_ASSISTED" ? (
        <Text selectable style={styles.aiPersonaDisclaimerFooter}>
          {item.aiStatus === "AI_GENERATED" && item.aiActorKind === "PLATFORM_AI"
            ? `本活动由平台 AI 小美生成 · 由 Proxy 审核并作为发布方。AI 不能报名、不能收款。如不适请在详情页点“向平台反馈”。`
            : item.aiStatus === "AI_GENERATED" && item.aiActorKind === "USER_TWIN"
              ? `本活动由“${activityAIPersonaName(item)}”数字分身起草 · 真人为本人发布。如不适请在详情页点“向平台反馈”。`
              : `本活动由 AI 助理协助起草 · “${activityAIPersonaName(item)}”不是活动主办方，发布方本人承担责任。`}
        </Text>
      ) : null}
      {item.realitySceneId && onOpenRealityScene ? (
        <Pressable onPress={() => onOpenRealityScene(item.realitySceneId!)} style={styles.ctaLight}>
          <Text selectable style={styles.ctaLightText}>查看场景地图</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={onBack} style={styles.ctaLight}>
        <Text selectable style={styles.ctaLightText}>返回活动</Text>
      </Pressable>
    </>
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
  errorText: { color: "#B00020", fontSize: 11, lineHeight: 15 },

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

  // 基线 .detailhero：gradient(color.ink→#342446) radius 20 padding 14 margin 8 0。
  detailHero: { borderRadius: 20, marginVertical: 8, padding: 14 },
  detailTopLine: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  detailPrice: { alignItems: "flex-end" },
  detailPriceStrong: { color: color.white, fontSize: 22, fontWeight: "900" },
  detailPriceSmall: { color: "#CFC6D8", fontSize: 11, marginTop: 1 },
  detailTitle: { color: color.white, fontSize: 18, fontWeight: "700", marginTop: 9 },
  detailDesc: { color: "#D8D1DF", fontSize: 11, lineHeight: 15, marginTop: 3 },
  // R15.x+: AI 数字人详情页 — 在 desc 上方加 persona 头像 + 名字 + 声明
  detailAIPersonaRow: { flexDirection: "row", alignItems: "center", marginTop: 12, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 10, padding: 8 },
  detailAIPersonaAvatar: { fontSize: 22, marginRight: 9 },
  // R17.x: persona 圆形 token (SVG assets 上线后转 require 同样的
  // 渲染路径。保持 44x44 圆形 + emoji + persona 色背景)
  detailAIPersonaAvatarCircle: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", marginRight: 9 },
  detailAIPersonaAvatarEmoji: { fontSize: 22 },
  detailAIPersonaTextCol: { flex: 1 },
  detailAIPersonaName: { color: color.white, fontSize: 13, fontWeight: "800" },
  detailAIPersonaDisclaimer: { color: "#D8D1DF", fontSize: 11, marginTop: 1 },
  aiPersonaDisclaimerFooter: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 8, paddingHorizontal: 4 },

  // 基线 .sceneanchor：color.ink radius 16 padding 10 gap 9 margin 8 0。
  sceneAnchor: {
    alignItems: "center",
    backgroundColor: color.ink,
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

  // 基线 .benefitbox：color.inspireSavedBg border #DBED94 radius 11 padding 8。
  benefitBox: {
    backgroundColor: color.inspireSavedBg,
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
  reviewBadge: { color: color.activityOriginUserFg, fontSize: 11, backgroundColor: color.activityOriginUserBg, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 4, fontWeight: "900" },
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

  // 基线 .taskaction：gradient(color.ink→#332642)，radius 20 padding 14；h3 18 / p 9。
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
    backgroundColor: color.bottomActiveBg,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 4
  },
  originBadgeText: { color: "#B91451", fontSize: 11, fontWeight: "900" },
  exampleName: { color: color.ink, fontSize: 11, fontWeight: "700", marginTop: 5 },
  exampleMeta: { color: color.muted, fontSize: 11, marginTop: 2 },
  // R15.x+: AI 数字人发起的活动 — 列表卡上在 title 上方加一行 "X 发起" 标识
  exampleAIPersona: { color: color.aiActivityBadgeFg, fontSize: 11, fontWeight: "700", marginTop: 5 },
  // R17.x: AI persona 圆形 token. photo 资产是 SVG
  // (apps/mobile/assets/ai-personas/), 这里 surface 仅画
  // 圆形色 + emoji 表情 — 未来 expo-image SVG 支持 上线后
  // 可以无缝衔接 (以 SVG 换 圆形 token).
  exampleAIPersonaRow: { flexDirection: "row", alignItems: "center", marginTop: 5 },
  exampleAIPersonaCircle: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", marginRight: 6 },
  exampleAIPersonaCircleText: { fontSize: 18 },
  exampleAIPersonaBadge: { color: "#7C5CFF", fontSize: 11, fontWeight: "600", marginTop: 1, letterSpacing: 0.4 },
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
