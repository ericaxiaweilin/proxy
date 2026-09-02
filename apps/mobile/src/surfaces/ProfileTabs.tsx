// R15.53 — ProfileTabs (IG/Threads 风格 5 tabs)
//   POSTS / REPLIES / SAVED / TAGGED / ABOUT
// 设计动机: 原 me.tsx personalHub 只有 3 tabs (FEED/PHOTOS/RECORDS),
//   IG/Threads 标准是 5 tabs (帖子/回复/收藏/标记/关于). 5 tabs 把
//   "我" 的内容生态表达完整 — 收藏 = 用户私库 (重要入口), tagged = 别人
//   提到我, replies = 别人看得到我的活动 (信任).
// Phase 1.5 策略: REPLIES/SAVED/TAGGED 用本地 mock (空数组 + 空态文案);
//   POSTS/PHOTOS 复用 me.tsx profilePosts / personalPhotos. 这样不依赖
//   server 改动 — Phase 2 接 backend 时 5 个 tabs 都用真数据.

import React, { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import type { FeedMediaItem, FeedPost } from "@proxy/contracts";
import { ThreadsPostMedia } from "../components/threads-post-media";
import type { LocalNetClient } from "../localnet-client";

// ---------- 类型 ----------

export type ProfileTabKey = "POSTS" | "REPLIES" | "SAVED" | "TAGGED" | "ABOUT";

export interface ProfileMediaEntry {
  item: FeedMediaItem;
  index: number;
  postId: string;
}

export interface ProfileTabsProps {
  profileDraft: {
    name: string;
    handle: string;
    bio: string;
    city: string;
  };
  profileAvatarUri?: string | undefined;
  posts: FeedPost[];                          // POSTS tab + 置顶用
  mediaByPost: Record<string, FeedMediaItem[]>; // POSTS media
  photos: ProfileMediaEntry[];                // PHOTOS (IG 3-列网格 in POSTS)
  replyPosts: FeedPost[];                     // REPLIES tab (Phase 1 mock)
  savedPosts: FeedPost[];                     // SAVED tab (Phase 1 mock)
  taggedPosts: FeedPost[];                    // TAGGED tab (Phase 1 mock)
  // 统计 (IG/Threads 风格 "粉丝 关注 帖子")
  stats: {
    posts: number;
    followers: number;
    following: number;
  };
  onOpenMedia: (entry: { postId: string; index: number }) => void;
  onOpenRealitySceneMap?: (() => void) | undefined;
  onComingSoon?: ((label: string) => void) | undefined;
  onOpenScene?: ((sceneId: string) => void) | undefined;
  resolveMediaUrl: (path: string) => string;
  fallbackLogo: unknown;                      // OTTER_LOGO / ProxyIcon
  // 选项 (颜色)
  color: {
    ink: string;
    muted: string;
    line: string;
    appBg: string;
    white: string;
    violet: string;
  };
  onShareProfile?: (() => void) | undefined;
  onEditProfile?: (() => void) | undefined;
  // R15.55: 关注图谱 — 区分自己/他人 profile 行为
  viewerMode?: "SELF" | "OTHER" | undefined;  // 决定 "编辑主页" vs "关注/已关注"
  isFollowing?: boolean | undefined;          // viewerMode=OTHER 时显示状态
  followBusy?: boolean | undefined;           // 处理中状态
  onFollow?: (() => void | Promise<void>) | undefined;
  onUnfollow?: (() => void | Promise<void>) | undefined;
  onSendMessage?: (() => void) | undefined;
}

// ---------- 组件 ----------

export function ProfileTabs(props: ProfileTabsProps): React.JSX.Element {
  const [tab, setTab] = useState<ProfileTabKey>("POSTS");

  // 置顶帖 (Phase 1: 第 1 条算置顶, IG/Threads 是用户手 pin 的; 我们
  // 没后端 pin 字段, 取最新 1 条当置顶演示, 跟下面 posts 列表重复 = 演示)
  const pinnedPost = useMemo(() => props.posts[0], [props.posts]);

  return (
    <View>
      {/* 统计行 — IG 风格 "X 帖子 · Y 粉丝 · Z 关注" */}
      <View style={styles.statsRow}>
        <View style={styles.statCol}>
          <Text style={styles.statValue}>{props.stats.posts}</Text>
          <Text style={styles.statLabel}>帖子</Text>
        </View>
        <View style={styles.statCol}>
          <Text style={styles.statValue}>{props.stats.followers}</Text>
          <Text style={styles.statLabel}>粉丝</Text>
        </View>
        <View style={styles.statCol}>
          <Text style={styles.statValue}>{props.stats.following}</Text>
          <Text style={styles.statLabel}>关注</Text>
        </View>
      </View>

      {/* 行动按钮 — 自己 profile = 编辑/分享 / 他人 profile = 关注/消息 (R15.55) */}
      <View style={styles.actionsRow}>
        {props.viewerMode === "OTHER" ? (
          <>
            <Pressable
              accessibilityLabel={props.isFollowing ? "已关注" : "关注"}
              onPress={() => {
                if (props.followBusy) return;
                if (props.isFollowing) void props.onUnfollow?.();
                else void props.onFollow?.();
              }}
              disabled={props.followBusy}
              style={[styles.actionBtn, props.isFollowing ? styles.actionSecondary : styles.actionPrimary]}
            >
              <Text style={props.isFollowing ? styles.actionSecondaryText : styles.actionPrimaryText}>
                {props.followBusy ? "处理中…" : props.isFollowing ? "✓ 已关注" : "+ 关注"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel="发送消息"
              onPress={props.onSendMessage}
              style={[styles.actionBtn, styles.actionSecondary]}
            >
              <Text style={styles.actionSecondaryText}>💬 消息</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              accessibilityLabel="编辑主页"
              onPress={() => {
                if (props.onEditProfile) props.onEditProfile();
                else props.onComingSoon?.("edit profile");
              }}
              style={[styles.actionBtn, styles.actionPrimary]}
            >
              <Text style={styles.actionPrimaryText}>编辑主页</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="分享主页"
              onPress={() => {
                if (props.onShareProfile) props.onShareProfile();
                else void Share.share({ message: `查看 ${props.profileDraft.name} 的 Proxy 主页` });
              }}
              style={[styles.actionBtn, styles.actionSecondary]}
            >
              <Text style={styles.actionSecondaryText}>分享主页</Text>
            </Pressable>
          </>
        )}
      </View>
      {props.onOpenRealitySceneMap ? (
        <Pressable
          accessibilityLabel="场景足迹"
          onPress={props.onOpenRealitySceneMap}
          style={styles.sceneEntry}
        >
          <Text style={styles.sceneEntryEmoji}>🗺</Text>
          <View style={styles.sceneEntryCopy}>
            <Text style={styles.sceneEntryTitle}>场景足迹</Text>
            <Text style={styles.sceneEntrySub}>历史公开记录与私人计划</Text>
          </View>
          <Text style={styles.sceneEntryChevron}>›</Text>
        </Pressable>
      ) : null}

      {/* Tabs 5 选 1 — IG 风格 underline */}
      <View style={styles.tabsRow}>
        {([
          ["POSTS", "🗂"],
          ["REPLIES", "💬"],
          ["SAVED", "🔖"],
          ["TAGGED", "@"],
          ["ABOUT", "i"]
        ] as Array<[ProfileTabKey, string]>).map(([key, icon]) => (
          <Pressable
            key={key}
            accessibilityLabel={`${key} tab`}
            onPress={() => setTab(key)}
            style={styles.tabBtn}
          >
            <Text style={[styles.tabIcon, tab === key && styles.tabIconActive]}>{icon}</Text>
            {tab === key ? <View style={styles.tabUnderline} /> : null}
          </Pressable>
        ))}
      </View>

      {/* Tab body */}
      {tab === "POSTS" ? (
        <PostsTab
          pinnedPost={pinnedPost}
          posts={props.posts.slice(1)} // 排除置顶
          mediaByPost={props.mediaByPost}
          avatarUri={props.profileAvatarUri}
          name={props.profileDraft.name}
          onOpenMedia={props.onOpenMedia}
          onOpenScene={props.onOpenScene}
          resolveMediaUrl={props.resolveMediaUrl}
          fallbackLogo={props.fallbackLogo}
          color={props.color}
        />
      ) : null}
      {tab === "REPLIES" ? (
        <RepliesTab
          replies={props.replyPosts}
          avatarUri={props.profileAvatarUri}
          name={props.profileDraft.name}
          onComingSoon={props.onComingSoon}
          color={props.color}
        />
      ) : null}
      {tab === "SAVED" ? (
        <SavedTab
          saved={props.savedPosts}
          photos={props.photos}
          onOpenMedia={props.onOpenMedia}
          resolveMediaUrl={props.resolveMediaUrl}
          color={props.color}
        />
      ) : null}
      {tab === "TAGGED" ? (
        <TaggedTab
          tagged={props.taggedPosts}
          photos={props.photos}
          onOpenMedia={props.onOpenMedia}
          resolveMediaUrl={props.resolveMediaUrl}
          color={props.color}
        />
      ) : null}
      {tab === "ABOUT" ? (
        <AboutTab
          profileDraft={props.profileDraft}
          stats={props.stats}
          color={props.color}
        />
      ) : null}
    </View>
  );
}

// ---------- PostsTab (置顶 + 帖子 + 3-列网格 toggle) ----------

function PostsTab(props: {
  pinnedPost: FeedPost | undefined;
  posts: FeedPost[];
  mediaByPost: Record<string, FeedMediaItem[]>;
  avatarUri?: string | undefined;
  name: string;
  onOpenMedia: (entry: { postId: string; index: number }) => void;
  onOpenScene?: ((sceneId: string) => void) | undefined;
  resolveMediaUrl: (path: string) => string;
  fallbackLogo: unknown;
  color: ProfileTabsProps["color"];
}): React.JSX.Element {
  const [view, setView] = useState<"LIST" | "GRID">("LIST");
  const allMediaEntries = useMemo(() => {
    const out: ProfileMediaEntry[] = [];
    for (const post of props.posts) {
      const items = props.mediaByPost[post.postId] ?? [];
      items.forEach((item, index) => {
        out.push({ item, index, postId: post.postId });
      });
    }
    return out;
  }, [props.posts, props.mediaByPost]);

  if (view === "GRID") {
    // IG 风格 3-列网格
    return (
      <View>
        <View style={styles.viewToggleRow}>
          <View style={styles.viewToggle}>
            <Pressable onPress={() => setView("LIST")} style={styles.viewToggleBtn}>
              <Text style={[styles.viewToggleIcon, styles.viewToggleIconInactive]}>≡</Text>
            </Pressable>
            <Pressable onPress={() => setView("GRID")} style={[styles.viewToggleBtn, styles.viewToggleBtnActive]}>
              <Text style={[styles.viewToggleIcon, styles.viewToggleIconActive]}>▦</Text>
            </Pressable>
          </View>
        </View>
        {allMediaEntries.length === 0 ? (
          <EmptyState title="还没有图片" sub="发布带图的帖子后会出现在这里" />
        ) : (
          <View style={styles.photoGrid}>
            {allMediaEntries.map((entry) => (
              <Pressable
                key={`${entry.item.mediaAssetId}-${entry.index}`}
                onPress={() => props.onOpenMedia({ postId: entry.postId, index: entry.index })}
                style={styles.photoTile}
              >
                <Image
                  source={{ uri: props.resolveMediaUrl(entry.item.feedUrl ?? entry.item.thumbnailUrl ?? entry.item.galleryUrl ?? "") }}
                  resizeMode="cover"
                  style={styles.photoImage}
                />
              </Pressable>
            ))}
          </View>
        )}
      </View>
    );
  }

  return (
    <View>
      <View style={styles.viewToggleRow}>
        <View style={styles.viewToggle}>
          <Pressable onPress={() => setView("LIST")} style={[styles.viewToggleBtn, styles.viewToggleBtnActive]}>
            <Text style={[styles.viewToggleIcon, styles.viewToggleIconActive]}>≡</Text>
          </Pressable>
          <Pressable onPress={() => setView("GRID")} style={styles.viewToggleBtn}>
            <Text style={[styles.viewToggleIcon, styles.viewToggleIconInactive]}>▦</Text>
          </Pressable>
        </View>
      </View>

      {/* 置顶帖 (IG/Threads 风格 pin badge) */}
      {props.pinnedPost ? (
        <View style={styles.pinnedCard}>
          <View style={styles.pinnedHeader}>
            <Text style={styles.pinnedBadge}>📌 置顶</Text>
            <Text style={styles.pinnedTime}>· {new Date(props.pinnedPost.createdAt).toLocaleDateString()}</Text>
          </View>
          <PostCard
            post={props.pinnedPost}
            media={props.mediaByPost[props.pinnedPost.postId] ?? []}
            avatarUri={props.avatarUri}
            name={props.name}
            onOpenMedia={props.onOpenMedia}
            onOpenScene={props.onOpenScene}
            resolveMediaUrl={props.resolveMediaUrl}
          />
        </View>
      ) : null}

      {props.posts.length === 0 && !props.pinnedPost ? (
        <EmptyState title="还没有动态" sub="发布的第一条帖子会出现在这里" />
      ) : (
        props.posts.map((post) => (
          <PostCard
            key={post.postId}
            post={post}
            media={props.mediaByPost[post.postId] ?? []}
            avatarUri={props.avatarUri}
            name={props.name}
            onOpenMedia={props.onOpenMedia}
            onOpenScene={props.onOpenScene}
            resolveMediaUrl={props.resolveMediaUrl}
          />
        ))
      )}
    </View>
  );
}

// ---------- PostCard (单条帖子) ----------

function PostCard(props: {
  post: FeedPost;
  media: FeedMediaItem[];
  avatarUri?: string | undefined;
  name: string;
  onOpenMedia: (entry: { postId: string; index: number }) => void;
  onOpenScene?: ((sceneId: string) => void) | undefined;
  resolveMediaUrl: (path: string) => string;
}): React.JSX.Element {
  return (
    <View style={styles.postCard}>
      <View style={styles.postHead}>
        <View style={styles.postAvatar}>
          {props.avatarUri ? (
            <Image source={{ uri: props.avatarUri }} style={styles.postAvatarImage} />
          ) : (
            <Text style={styles.postAvatarText}>{(props.name || "?").charAt(0).toUpperCase()}</Text>
          )}
        </View>
        <View style={styles.postHeadBody}>
          <Text style={styles.postName} numberOfLines={1}>{props.name}</Text>
          <Text style={styles.postTime} numberOfLines={1}>· {new Date(props.post.createdAt).toLocaleDateString()}</Text>
        </View>
        <Pressable accessibilityLabel="更多" style={styles.postMore}>
          <Text style={styles.postMoreText}>⋯</Text>
        </Pressable>
      </View>
      <View style={styles.postBody}>
        <Text style={styles.postText}>{props.post.body}</Text>
        {props.post.contextRefs.length > 0 ? (
          <View style={styles.postContextRow}>
            {props.post.contextRefs.map((entry) => (
              <Pressable
                key={entry.contextId}
                onPress={() => props.onOpenScene?.(entry.contextId)}
                style={styles.postContextChip}
              >
                <Text style={styles.postContextText}>{entry.contextId}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {props.media.length > 0 ? (
          <ThreadsPostMedia
            items={props.media}
            resolveUrl={props.resolveMediaUrl}
            onOpen={(index) => props.onOpenMedia({ postId: props.post.postId, index })}
          />
        ) : null}
        <View style={styles.postActions}>
          <Pressable style={styles.postAction}>
            <Text style={styles.postActionText}>♡ 喜欢</Text>
          </Pressable>
          <Pressable style={styles.postAction}>
            <Text style={styles.postActionText}>💬 回复</Text>
          </Pressable>
          <Pressable style={styles.postAction}>
            <Text style={styles.postActionText}>↗ 分享</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ---------- RepliesTab (回复, Phase 1 mock) ----------

function RepliesTab(props: {
  replies: FeedPost[];
  avatarUri?: string | undefined;
  name: string;
  onComingSoon?: ((label: string) => void) | undefined;
  color: ProfileTabsProps["color"];
}): React.JSX.Element {
  if (props.replies.length === 0) {
    return <EmptyState title="还没有回复" sub="你在其他帖子下面的回复会出现在这里" />;
  }
  return (
    <View>
      {props.replies.map((reply) => (
        <View key={reply.postId} style={styles.replyCard}>
          <View style={styles.replyMeta}>
            <Text style={styles.replyTarget}>回复 @{reply.authorId} 的帖子</Text>
            <Text style={styles.replyTime}>· {new Date(reply.createdAt).toLocaleDateString()}</Text>
          </View>
          <Text style={styles.replyText}>{reply.body}</Text>
        </View>
      ))}
    </View>
  );
}

// ---------- SavedTab (收藏, Phase 1 提示 + Photos 网格复用) ----------

function SavedTab(props: {
  saved: FeedPost[];
  photos: ProfileMediaEntry[];
  onOpenMedia: (entry: { postId: string; index: number }) => void;
  resolveMediaUrl: (path: string) => string;
  color: ProfileTabsProps["color"];
}): React.JSX.Element {
  if (props.saved.length === 0 && props.photos.length === 0) {
    return <EmptyState title="还没有收藏" sub="点击帖子右下角的 🔖 可以加入收藏" />;
  }
  // 3-列网格 — 复用 IG 收藏页布局
  const all = props.photos.length > 0
    ? props.photos
    : props.saved.flatMap((post): ProfileMediaEntry[] => []);
  return (
    <View>
      <View style={styles.savedHint}>
        <Text style={styles.savedHintText}>仅自己可见 · {all.length} 项</Text>
      </View>
      <View style={styles.photoGrid}>
        {all.map((entry) => (
          <Pressable
            key={`${entry.item.mediaAssetId}-${entry.index}`}
            onPress={() => props.onOpenMedia({ postId: entry.postId, index: entry.index })}
            style={styles.photoTile}
          >
            <Image
              source={{ uri: props.resolveMediaUrl(entry.item.feedUrl ?? entry.item.thumbnailUrl ?? entry.item.galleryUrl ?? "") }}
              resizeMode="cover"
              style={styles.photoImage}
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ---------- TaggedTab (别人标记我, Phase 1 mock) ----------

function TaggedTab(props: {
  tagged: FeedPost[];
  photos: ProfileMediaEntry[];
  onOpenMedia: (entry: { postId: string; index: number }) => void;
  resolveMediaUrl: (path: string) => string;
  color: ProfileTabsProps["color"];
}): React.JSX.Element {
  if (props.tagged.length === 0 && props.photos.length === 0) {
    return <EmptyState title="还没有被标记" sub="其他人在帖子里 @ 你时会出现在这里" />;
  }
  const all = props.photos.length > 0
    ? props.photos
    : props.tagged.flatMap((post): ProfileMediaEntry[] => []);
  return (
    <View style={styles.photoGrid}>
      {all.map((entry) => (
        <Pressable
          key={`${entry.item.mediaAssetId}-${entry.index}`}
          onPress={() => props.onOpenMedia({ postId: entry.postId, index: entry.index })}
          style={[styles.photoTile, styles.taggedTile]}
        >
          <Image
            source={{ uri: props.resolveMediaUrl(entry.item.feedUrl ?? entry.item.thumbnailUrl ?? entry.item.galleryUrl ?? "") }}
            resizeMode="cover"
            style={styles.photoImage}
          />
          <View style={styles.taggedOverlay}>
            <Text style={styles.taggedOverlayText}>@{entry.postId.slice(0, 6)}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

// ---------- AboutTab (IG/Threads 风格关于页) ----------

function AboutTab(props: {
  profileDraft: ProfileTabsProps["profileDraft"];
  stats: ProfileTabsProps["stats"];
  color: ProfileTabsProps["color"];
}): React.JSX.Element {
  return (
    <View style={styles.aboutCard}>
      <Text style={styles.aboutBio}>{props.profileDraft.bio}</Text>
      <View style={styles.aboutMetaRow}>
        <Text style={styles.aboutMetaLabel}>📍</Text>
        <Text style={styles.aboutMetaValue}>{props.profileDraft.city}</Text>
      </View>
      <View style={styles.aboutMetaRow}>
        <Text style={styles.aboutMetaLabel}>🆔</Text>
        <Text style={styles.aboutMetaValue}>@{props.profileDraft.handle}</Text>
      </View>
      <View style={styles.aboutDivider} />
      <View style={styles.aboutStatsRow}>
        <AboutStat label="已履约" value="42" hint="98% 准时" />
        <AboutStat label="复购" value="7" hint="稳定" />
        <AboutStat label="认证" value="✓" hint="真实性已校验" />
      </View>
      <View style={styles.aboutDivider} />
      <View style={styles.aboutStatBig}>
        <Text style={styles.aboutStatBigLabel}>粉丝 / 关注 / 帖子</Text>
        <Text style={styles.aboutStatBigValue}>
          {props.stats.followers} · {props.stats.following} · {props.stats.posts}
        </Text>
      </View>
    </View>
  );
}

function AboutStat(props: { label: string; value: string; hint: string }): React.JSX.Element {
  return (
    <View style={styles.aboutStat}>
      <Text style={styles.aboutStatValue}>{props.value}</Text>
      <Text style={styles.aboutStatLabel}>{props.label}</Text>
      <Text style={styles.aboutStatHint}>{props.hint}</Text>
    </View>
  );
}

function EmptyState(props: { title: string; sub: string }): React.JSX.Element {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{props.title}</Text>
      <Text style={styles.emptySub}>{props.sub}</Text>
    </View>
  );
}

// ---------- Styles ----------

const styles = StyleSheet.create({
  // 统计
  statsRow: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 14 },
  statCol: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 18, fontWeight: "800", color: "#0f172a" },
  statLabel: { fontSize: 12, color: "#64748b", marginTop: 2 },
  // 行动
  actionsRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  actionBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  actionPrimary: { backgroundColor: "#0f172a" },
  actionPrimaryText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  actionSecondary: { backgroundColor: "#f1f5f9" },
  actionSecondaryText: { color: "#0f172a", fontSize: 13, fontWeight: "600" },
  // 场景
  sceneEntry: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 12, padding: 12, backgroundColor: "#f8fafc", borderRadius: 10, borderWidth: 1, borderColor: "#e2e8f0" },
  sceneEntryEmoji: { fontSize: 22, marginRight: 10 },
  sceneEntryCopy: { flex: 1 },
  sceneEntryTitle: { fontSize: 14, fontWeight: "700", color: "#0f172a" },
  sceneEntrySub: { fontSize: 11, color: "#64748b", marginTop: 1 },
  sceneEntryChevron: { fontSize: 22, color: "#94a3b8" },
  // Tabs
  tabsRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#e2e8f0", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", backgroundColor: "#fff" },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 12, position: "relative" },
  tabIcon: { fontSize: 18, color: "#94a3b8" },
  tabIconActive: { color: "#0f172a" },
  tabUnderline: { position: "absolute", bottom: 0, left: 12, right: 12, height: 1.5, backgroundColor: "#0f172a" },
  // View toggle (LIST / GRID)
  viewToggleRow: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 16, paddingVertical: 8 },
  viewToggle: { flexDirection: "row", backgroundColor: "#f1f5f9", borderRadius: 6, padding: 2 },
  viewToggleBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 },
  viewToggleBtnActive: { backgroundColor: "#fff" },
  viewToggleIcon: { fontSize: 14 },
  viewToggleIconActive: { color: "#0f172a" },
  viewToggleIconInactive: { color: "#94a3b8" },
  // Pinned
  pinnedCard: { backgroundColor: "#fffbeb", borderLeftWidth: 3, borderLeftColor: "#f59e0b", marginHorizontal: 16, marginBottom: 12, borderRadius: 8, paddingTop: 8 },
  pinnedHeader: { flexDirection: "row", paddingHorizontal: 12, paddingBottom: 4, alignItems: "center" },
  pinnedBadge: { fontSize: 11, color: "#f59e0b", fontWeight: "700" },
  pinnedTime: { fontSize: 11, color: "#94a3b8", marginLeft: 4 },
  // Post card
  postCard: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e2e8f0", backgroundColor: "#fff" },
  postHead: { flexDirection: "row", alignItems: "center" },
  postAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#cbd5e1", alignItems: "center", justifyContent: "center", marginRight: 10, overflow: "hidden" },
  postAvatarImage: { width: 38, height: 38, borderRadius: 19 },
  postAvatarText: { fontSize: 16, color: "#0f172a", fontWeight: "700" },
  postHeadBody: { flex: 1 },
  postName: { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  postTime: { fontSize: 11, color: "#94a3b8" },
  postMore: { padding: 4 },
  postMoreText: { fontSize: 18, color: "#64748b" },
  postBody: { marginTop: 8, marginLeft: 48 },
  postText: { fontSize: 14, color: "#0f172a", lineHeight: 20 },
  postContextRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  postContextChip: { backgroundColor: "#f1f5f9", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  postContextText: { fontSize: 11, color: "#475569" },
  postActions: { flexDirection: "row", gap: 16, marginTop: 10 },
  postAction: { paddingVertical: 4 },
  postActionText: { fontSize: 12, color: "#64748b" },
  // Photo grid
  photoGrid: { flexDirection: "row", flexWrap: "wrap" },
  photoTile: { width: "33.333%", aspectRatio: 1, padding: 1 },
  photoImage: { flex: 1, backgroundColor: "#f1f5f9" },
  // Tagged
  taggedTile: { position: "relative" },
  taggedOverlay: { position: "absolute", bottom: 4, left: 4, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 4, paddingVertical: 2, borderRadius: 3 },
  taggedOverlayText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  // Saved
  savedHint: { paddingHorizontal: 16, paddingVertical: 6 },
  savedHintText: { fontSize: 11, color: "#94a3b8" },
  // Reply
  replyCard: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e2e8f0" },
  replyMeta: { flexDirection: "row", alignItems: "center" },
  replyTarget: { fontSize: 11, color: "#94a3b8" },
  replyTime: { fontSize: 11, color: "#94a3b8" },
  replyText: { fontSize: 13, color: "#0f172a", marginTop: 4, lineHeight: 18 },
  // About
  aboutCard: { marginHorizontal: 16, marginVertical: 12, padding: 16, backgroundColor: "#f8fafc", borderRadius: 10 },
  aboutBio: { fontSize: 13, color: "#0f172a", lineHeight: 19 },
  aboutMetaRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  aboutMetaLabel: { fontSize: 12, marginRight: 6, width: 18 },
  aboutMetaValue: { fontSize: 13, color: "#0f172a" },
  aboutDivider: { height: 1, backgroundColor: "#e2e8f0", marginVertical: 12 },
  aboutStatsRow: { flexDirection: "row", gap: 12 },
  aboutStat: { flex: 1, alignItems: "center" },
  aboutStatValue: { fontSize: 18, fontWeight: "800", color: "#0f172a" },
  aboutStatLabel: { fontSize: 11, color: "#64748b", marginTop: 2 },
  aboutStatHint: { fontSize: 11, color: "#94a3b8" },
  aboutStatBig: { alignItems: "center" },
  aboutStatBigLabel: { fontSize: 11, color: "#64748b" },
  aboutStatBigValue: { fontSize: 18, fontWeight: "800", color: "#0f172a", marginTop: 4 },
  // Empty
  empty: { paddingHorizontal: 32, paddingVertical: 48, alignItems: "center" },
  emptyTitle: { fontSize: 15, color: "#0f172a", fontWeight: "700", marginBottom: 4 },
  emptySub: { fontSize: 12, color: "#94a3b8", textAlign: "center" }
});
