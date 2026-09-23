// AIIdentityShowcaseSurface — 用户的「AI 分身中心」页（我的 → AI分身）。
//
// AI-TWIN-SHOWCASE-STRIP-002（2026-09-22，用户对照原型复盘：「这些都是
// 后端的，并不是做到 app 里的」）：AI-TWIN-SHOWCASE-STRIP-001（2026-09-21）
// 删过一轮 R1 静态展示（hero/KPI/审计日志/3 个假手机截图……），但保留了
// 「我的分身」列表 + 创建分身表单 + 「数据模型」按钮/弹层 + Human Confirm
// Gate 流程图 + FACET 跨屏入口——这几块本身是可操作的真功能，不是编造
// 数据，但都不在原型（用户 2026-09-21 提供，deepseek_html_20260921_
// 663482.html「小美 · AI 分身（受众调度版）」）里：原型这屏只有 图库 /
// 帖文编排 / 好友运营 三段，没有分身管理、没有 schema 说明弹层、没有
// Human Confirm Gate 说明、没有去 FACET 的入口卡片。那些是分身的账号/
// 授权/架构层面的东西，该在别的地方（分身创建/管理入口、开发者文档），
// 不该出现在这个内容管理页上——出现在这里就是把后端概念直接摊在用户
// 面前。这一版删掉，只保留跟原型一一对应的三段。
//
// 分身解析：图库（TwinGallerySection）、帖文编排（TwinPostComposerSection）、
// 好友洞察（TwinInsightSection）三段各自内部解析 personaId（listMine 取
// 第一个），不依赖这一屏再传一份「当前分身」下去——原型本来就是单一分身
// 视角，没有分身切换器。这一屏因此不再需要 AiPersonaClient。

import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { CreatePostPayload, FeedMediaItem, FeedPost } from "@proxy/contracts";
import { color } from "../theme";
import type { PersonaGalleryItem } from "../ai-persona-client";
import type { TransportResponse } from "../auth-client";
import type { MediaClient } from "../media-client";
import type { RelationshipClient } from "../relationship-client";
import { TwinInsightSection } from "../components/twin-insight-section";
import { TwinGallerySection } from "../components/twin-gallery-section";
import { TwinPostComposerSection } from "../components/twin-post-composer-section";

export function AIIdentityShowcaseSurface({ onBack, viewerAccountId, authClient, rawGalleryItems, mediaClient, posts, mediaByPost, relationshipClient, createPost, updatePostAudience, onPostPublished, resolveMediaUrl }: {
  onBack: () => void;
  viewerAccountId: string | undefined;
  authClient: { request(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<TransportResponse> };
  /** AI-TWIN-GALLERY-002: 图库「原始图库」tab 的本地兜底数据——这个人自己
   * 发过的帖子里的照片，跟「我的」个人主页图库同一份读模型（profilePosts
   * + profileMedia）。调用方（me.tsx）已经拿着这份数据，这里直接接住，
   * 服务端 owner 扫（见 TwinGallerySection）失败或漏掉时不至于什么都
   * 看不到。 */
  rawGalleryItems: PersonaGalleryItem[];
  /** AI-TWIN-GALLERY-003: 图库导入按钮用——跟头像/帖子同一条上传管线。 */
  mediaClient: MediaClient | undefined;
  /** AI-TWIN-POST-AUDIENCE-002: 帖文编排列表——同一份 profilePosts/profileMedia。 */
  posts: FeedPost[];
  mediaByPost: Record<string, FeedMediaItem[]>;
  /** AI-TWIN-POST-AUDIENCE-002: 受众选择器的真实好友来源。 */
  relationshipClient: RelationshipClient | undefined;
  /** AI-TWIN-POST-AUDIENCE-002: 真发帖，走 CreatePost 命令（跟其余发帖入口
   * 同一条链路），不是另起一套假的发布逻辑。 */
  createPost: (payload: CreatePostPayload) => Promise<string>;
  /** AI-TWIN-POST-AUDIENCE-003: 已发布帖子的受众开关——走 UpdatePostAudience
   * 命令，不是重新发一条帖子。 */
  updatePostAudience: (postId: string, visibility: "PUBLIC" | "TARGETED", audienceTargetIds: string[]) => Promise<void>;
  /** AI-TWIN-POST-AUDIENCE-002: 发布成功后调用方（me.tsx）据此刷新
   * profilePosts，新帖子立刻出现在帖文编排列表和图库的「原始图库」里。 */
  onPostPublished: () => void;
  /** AI-TWIN-GALLERY-004: 服务端 media URL 是相对路径，图库/帖文里所有
   * <Image> 都要经这个函数拼上服务器地址，跟 ProfileTabs 同一条规则。 */
  resolveMediaUrl: (path: string) => string;
}): React.JSX.Element {
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.pageHead}>
          <Text onPress={onBack} style={styles.back}>‹</Text>
          <Text style={styles.title}>AI分身中心</Text>
        </View>
        <Text style={styles.subtitle}>图库 · 帖文编排 · 好友运营</Text>

        {/* AI-TWIN-GALLERY-001: 图库段（原型：小美 · AI 分身受众调度版）。 */}
        <TwinGallerySection authClient={authClient} mediaClient={mediaClient} ownerId={viewerAccountId} rawGalleryItems={rawGalleryItems} resolveMediaUrl={resolveMediaUrl} />

        {/* AI-TWIN-POST-AUDIENCE-002/003: 帖文编排段（原型同一段，受众调度
            部分）。公开 / 指定好友两档真受众，服务端在 TARGETED 帖子上真正
            执行白名单，已发布帖子的受众条可以直接点开重新切换。 */}
        <TwinPostComposerSection
          createPost={createPost}
          galleryItems={rawGalleryItems}
          mediaByPost={mediaByPost}
          onPublished={onPostPublished}
          posts={posts}
          relationshipClient={relationshipClient}
          resolveMediaUrl={resolveMediaUrl}
          updatePostAudience={updatePostAudience}
          viewerAccountId={viewerAccountId}
        />

        {/* TWIN-INSIGHT-001 / TWIN-INSIGHT-AVATAR-001: 好友洞察段（原型「好友运营」）。
            头像 wire 是相对路径，必须把 resolveMediaUrl 传下去拼 base。 */}
        <TwinInsightSection authClient={authClient} ownerId={viewerAccountId} resolveMediaUrl={resolveMediaUrl} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.appBg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  pageHead: { flexDirection: "row", alignItems: "center", paddingVertical: 14, gap: 12 },
  back: { fontSize: 22, color: color.ink, paddingHorizontal: 6 },
  title: { fontSize: 22, fontWeight: "800", color: color.ink, letterSpacing: -0.4 },
  subtitle: { fontSize: 12, color: color.muted, marginBottom: 20 },
});
