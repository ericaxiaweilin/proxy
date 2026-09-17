// R15.53 — ProfileTabs (IG/Threads 风格 5 tabs)
//   POSTS / REPLIES / SAVED / TAGGED / ABOUT
// 设计动机: 原 me.tsx personalHub 只有 3 tabs (FEED/PHOTOS/RECORDS),
//   IG/Threads 标准是 5 tabs (帖子/回复/收藏/标记/关于). 5 tabs 把
//   "我" 的内容生态表达完整 — 收藏 = 用户私库 (重要入口), tagged = 别人
//   提到我, replies = 别人看得到我的活动 (信任).
// 数据: 5 个 tabs 都接真数据 —— POSTS/PHOTOS 复用 me.tsx profilePosts /
//   personalPhotos; REPLIES 走 ListUserReplies，再用 ListPostsByIds 回查
//   被回复的父帖（REPLY-TARGET-001）; SAVED 走 ListUserBookmarks
//   (再按 ID 直取); TAGGED 走 ListPostsMentioning（MENTION-001）。
//   TAGGED 原先是在客户端拿一页动态做 @handle 子串筛的 —— 更早的提及会静默
//   消失，而且 "@thanh2" 会被算成提到了 "@thanh"。现在由服务端扫全量已发布
//   帖子，可见性与动态流一致。
// 可见性: SAVED 只对本人可见（PROFILE-TABS-001）—— 别人的收藏夹是他的私库，
//   不是公开主页的一栏。

import React, { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import type { FeedMediaItem, FeedPost } from "@proxy/contracts";
import { ThreadsPostMedia } from "../components/threads-post-media";
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import { CircularAvatarImage } from "../components/circular-avatar-image";
import type { LocalNetClient } from "../localnet-client";
import {
  replyTargetLabel,
  replyTimestampLabel,
  type ReplyEntry,
  type ReplyTarget
} from "../reply-target";
import {
  selectPinnedPostAndRest,
  selectPostMedia,
  visibleProfileTabs,
  type ProfileMediaEntry,
  type ProfileTabKey
} from "./profile-tabs-model";
import { ProxyEmptyState } from "../components/proxy-foundation";
export type { ProfileMediaEntry, ProfileTabKey } from "./profile-tabs-model";

// ---------- 类型 ----------

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
  // R15.73: 置顶帖 ID 列表 (server 返, ListPinnedPosts). pinnedIds[0] 渲染置顶, 其余标 "已置顶" 标记.
  pinnedIds?: ReadonlyArray<string> | undefined;
  // REPLIES/SAVED/TAGGED 都已经是真数据（me.tsx 走 ListUserReplies /
  // ListUserBookmarks；other-profile.tsx 走 ListUserReplies）。SAVED 只在
  // viewerMode === "SELF" 时渲染 —— 收藏是私库，不上他人主页
  // （PROFILE-TABS-001）。
  // REPLY-TARGET-001: 回复不再是伪装成 FeedPost 的假帖子 —— 它有自己的形状
  // （replyId / parentPostId），因为同一条帖子可以被回复多次，用父帖 id 当
  // React key 会撞。被回复的父帖由调用方用 ListPostsByIds 回查后放进
  // replyTargets；查不到就是缺项，渲染退化成中性文案。
  replies: ReplyEntry[];
  replyTargets: Record<string, ReplyTarget>;
  savedPosts: FeedPost[];
  taggedPosts: FeedPost[];
  // PROFILE-TAB-LOAD-FAILED-001: 这三个列表加载失败时，调用方以前把它们 set 成 []。
  // 而空数组在这里渲染成「你还没有这类内容」的空态文案 —— 用户会以为自己的
  // 收藏、回复、被提及记录**没了**。失败和「真的没有」必须渲染成两句话。
  // 缺省 false（其它调用方不传）＝ 不显示失败态。
  savedFailed?: boolean;
  repliesFailed?: boolean;
  taggedFailed?: boolean;
  // REPLY-TARGET-001: 判定「这条帖子是不是访问者自己的」用，跟 feed 同一套
  // 身份规则（resolveAuthorDisplayName）。缺省 = 游客，一律不当成自己。
  viewerAccountId?: string | undefined;
  // 统计 (IG/Threads 风格 "粉丝 关注 帖子")。没拉到就是 undefined，
  // 渲染 "—" 不回填 0。
  stats: {
    posts: number | undefined;
    followers: number | undefined;
    following: number | undefined;
  };
  onOpenMedia: (entry: { postId: string; index: number }) => void;
  onOpenRealitySceneMap?: (() => void) | undefined;
  onOpenScene?: ((sceneId: string) => void) | undefined;
  // 帖子互动：有 handler 才渲染对应按钮，没有不渲染假按钮。
  // 分享走系统分享（无需后端），喜欢走 engagement.reactToPost。
  onLikePost?: ((postId: string) => void) | undefined;
  onReplyPost?: ((postId: string) => void) | undefined;
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

const PROFILE_TAB_LABEL: Record<ProfileTabKey, string> = {
  POSTS: "帖子",
  REPLIES: "回复",
  SAVED: "收藏",
  TAGGED: "标签",
  ABOUT: "关于"
};

const PROFILE_TAB_ICON: Record<ProfileTabKey, ProxyIconName> = {
  POSTS: "sparkle",
  REPLIES: "spark",
  SAVED: "star",
  TAGGED: "target",
  ABOUT: "ring"
};

export function ProfileTabs(props: ProfileTabsProps): React.JSX.Element {
  const [tab, setTab] = useState<ProfileTabKey>("POSTS");

  // PROFILE-TABS-001: SAVED 只给本人。viewer 身份未知时不给（fail-closed）。
  const tabs = useMemo(() => visibleProfileTabs(props.viewerMode), [props.viewerMode]);
  // 当前 tab 被隐藏时（例如从本人主页切到他人主页）回落 POSTS，避免留一个空白页。
  const activeTab: ProfileTabKey = tabs.includes(tab) ? tab : "POSTS";

  // R15.73: 置顶帖 = server 返的 pinnedIds 中第一个, 不在 profilePosts 时走 fallback.
  // 之前 (Phase 1) 取 posts[0] mock — 跟 post 列表重复, 只是占位.
  // R15.89 fix: 没真 pinnedIds 时 不渲染 置顶卡片 (PinnedCard 误写 '置顶' 标签).
  const { pinned: pinnedPost, rest: unpinnedPosts } = useMemo(
    () => selectPinnedPostAndRest(props.posts, props.pinnedIds),
    [props.posts, props.pinnedIds]
  );

  return (
    <View>
      {/* 2-col 行动按钮 (Threads R2: 边框 + 10px 圆角 + 9px 字)
         — 自己 profile = 编辑/分享 / 他人 profile = 关注/消息 (R15.55) */}
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
              style={[styles.actionBtn, styles.actionLime]}
            >
              <Text style={styles.actionLimeText}>分享主页</Text>
            </Pressable>
          </>
        )}
      </View>

      {/* Tabs N 选 1 — IG/Threads 风: 顶部小 icon + 中文 label, active 黑下划线 2px。
          PROFILE-TABS-001: 列表走 visibleProfileTabs，SAVED 只给本人。 */}
      <View style={styles.tabsRow}>
        {tabs.map((key) => (
          <Pressable
            key={key}
            accessibilityLabel={`${key} tab`}
            onPress={() => setTab(key)}
            style={styles.tabBtn}
          >
            <ProxyIcon name={PROFILE_TAB_ICON[key]} color={activeTab === key ? props.color.ink : props.color.muted} size={20} />
            <Text style={[styles.tabLabel, activeTab === key && styles.tabLabelActive]}>{PROFILE_TAB_LABEL[key]}</Text>
            {activeTab === key ? <View style={styles.tabUnderline} /> : null}
          </Pressable>
        ))}
      </View>

      {/* Tab body */}
      {activeTab === "POSTS" ? (
        <PostsTab
          pinnedPost={pinnedPost}
          posts={unpinnedPosts}
          mediaByPost={props.mediaByPost}
          pinnedIds={props.pinnedIds}
          avatarUri={props.profileAvatarUri}
          name={props.profileDraft.name}
          onOpenMedia={props.onOpenMedia}
          onOpenScene={props.onOpenScene}
          onLikePost={props.onLikePost}
          onReplyPost={props.onReplyPost}
          resolveMediaUrl={props.resolveMediaUrl}
          fallbackLogo={props.fallbackLogo}
          color={props.color}
        />
      ) : null}
      {activeTab === "REPLIES" ? (
        <RepliesTab
          replies={props.replies}
          targets={props.replyTargets}
          failed={props.repliesFailed}
          viewerMode={props.viewerMode}
          viewerAccountId={props.viewerAccountId}
          color={props.color}
        />
      ) : null}
      {activeTab === "SAVED" ? (
        <SavedTab
          saved={props.savedPosts}
          failed={props.savedFailed}
          mediaByPost={props.mediaByPost}
          onOpenMedia={props.onOpenMedia}
          resolveMediaUrl={props.resolveMediaUrl}
          color={props.color}
        />
      ) : null}
      {activeTab === "TAGGED" ? (
        <TaggedTab
          tagged={props.taggedPosts}
          failed={props.taggedFailed}
          mediaByPost={props.mediaByPost}
          onOpenMedia={props.onOpenMedia}
          resolveMediaUrl={props.resolveMediaUrl}
          color={props.color}
        />
      ) : null}
      {activeTab === "ABOUT" ? (
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
  onLikePost?: ((postId: string) => void) | undefined;
  onReplyPost?: ((postId: string) => void) | undefined;
  resolveMediaUrl: (path: string) => string;
  fallbackLogo: unknown;
  // R15.99: 接 pinnedIds 进来 — ProfileTabs 顶层 hasRealPin 闭包不传进 PostsTab,
  //   而 PostsTab 内部 PinnedCard render 条件需要.
  pinnedIds?: ReadonlyArray<string> | undefined;
  color: ProfileTabsProps["color"];
}): React.JSX.Element {
  const [view, setView] = useState<"LIST" | "GRID">("LIST");
  // R15.99: hasRealPin local — 跟 ProfileTabs 顶层同逻辑.
  const hasRealPin = !!(props.pinnedIds && props.pinnedIds.length > 0);
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
          <ProxyEmptyState title="还没有图片" sub="发布带图的帖子后会出现在这里" />
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

      {/* 置顶帖 (IG/Threads 风格 pin badge) — R15.89: 需 hasRealPin 才显示,
           避免 fallback posts[0] 被误标 '置顶' */}
      {hasRealPin && props.pinnedPost ? (
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
            onLikePost={props.onLikePost}
            onReplyPost={props.onReplyPost}
            resolveMediaUrl={props.resolveMediaUrl}
          />
        </View>
      ) : null}

      {props.posts.length === 0 && !props.pinnedPost ? (
        <ProxyEmptyState title="还没有动态" sub="发布的第一条帖子会出现在这里" />
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
            onLikePost={props.onLikePost}
            onReplyPost={props.onReplyPost}
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
  onLikePost?: ((postId: string) => void) | undefined;
  onReplyPost?: ((postId: string) => void) | undefined;
  resolveMediaUrl: (path: string) => string;
}): React.JSX.Element {
  const sharePost = (): void => {
    void Share.share({ message: `${props.post.body}\n\nProxy · ${props.name}` });
  };
  return (
    <View style={styles.postCard}>
      <View style={styles.postHead}>
        <View style={styles.postAvatar}>
          {props.avatarUri ? (
            <CircularAvatarImage accessibilityLabel={`${props.name}头像`} size={38} uri={props.avatarUri} />
          ) : (
            <Text style={styles.postAvatarText}>{(props.name || "?").charAt(0).toUpperCase()}</Text>
          )}
        </View>
        <View style={styles.postHeadBody}>
          <Text style={styles.postName} numberOfLines={1}>{props.name}</Text>
          <Text style={styles.postTime} numberOfLines={1}>· {new Date(props.post.createdAt).toLocaleDateString()}</Text>
        </View>
        <Pressable accessibilityLabel="更多" onPress={sharePost} style={styles.postMore}>
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
          {props.onLikePost ? (
            <Pressable onPress={() => props.onLikePost?.(props.post.postId)} style={styles.postAction} accessibilityLabel="喜欢">
              <Text style={styles.postActionText}>♡ 喜欢</Text>
            </Pressable>
          ) : null}
          {props.onReplyPost ? (
            <Pressable onPress={() => props.onReplyPost?.(props.post.postId)} style={styles.postAction} accessibilityLabel="回复">
              <Text style={styles.postActionText}>💬 回复</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={sharePost} style={styles.postAction} accessibilityLabel="分享帖子">
            <Text style={styles.postActionText}>↗ 分享</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ---------- RepliesTab (回复) ----------

function RepliesTab(props: {
  replies: ReplyEntry[];
  targets: Record<string, ReplyTarget>;
  viewerMode: "SELF" | "OTHER" | undefined;
  viewerAccountId?: string | undefined;
  color: ProfileTabsProps["color"];
  failed?: boolean | undefined;
}): React.JSX.Element {
  // PROFILE-TAB-LOAD-FAILED-001: 失败要单独一句，不能落进下面那条空态文案。
  if (props.failed) {
    return <ProxyEmptyState title="回复没读出来" sub="这次请求失败了 —— 不是真的没有。重进页面再试。" />;
  }
  if (props.replies.length === 0) {
    return <ProxyEmptyState title="还没有回复" sub="你在其他帖子下面的回复会出现在这里" />;
  }
  return (
    <View>
      {props.replies.map((reply) => {
        // REPLY-TARGET-001: 取不回来的父帖（已删 / 已收紧成仅关注者可见）就是
        // undefined —— 这一行退化成中性文案，不显示 id、不编名字。
        const target = props.targets[reply.parentPostId];
        return (
          // key 用 replyId：同一条帖子可以被同一个人回复多次，用父帖 id 会撞。
          <View key={reply.replyId} style={styles.replyCard}>
            <View style={styles.replyMeta}>
              <Text style={styles.replyTarget}>
                {replyTargetLabel(props.viewerMode, target, props.viewerAccountId)}
              </Text>
              <Text style={styles.replyTime}>· {replyTimestampLabel(reply.createdAt)}</Text>
            </View>
            <Text style={styles.replyText}>{reply.body}</Text>
            {/* 引用块：让「回复了谁」这条信息能落到实处 —— 看到原帖才知道
                说的是哪件事（Threads 的做法）。 */}
            {target && target.excerpt !== "" ? (
              <View style={styles.replyQuote}>
                <Text numberOfLines={2} style={styles.replyQuoteText}>{target.excerpt}</Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

// ---------- SavedTab (收藏, Phase 1 提示 + Photos 网格复用) ----------

function SavedTab(props: {
  saved: FeedPost[];
  mediaByPost: Record<string, FeedMediaItem[]>;
  onOpenMedia: (entry: { postId: string; index: number }) => void;
  resolveMediaUrl: (path: string) => string;
  color: ProfileTabsProps["color"];
  failed?: boolean | undefined;
}): React.JSX.Element {
  // PROFILE-TAB-LOAD-FAILED-001: 收藏读失败却显示空态文案，等于告诉用户收藏丢了。
  if (props.failed) {
    return <ProxyEmptyState title="收藏没读出来" sub="这次请求失败了 —— 不是真的没有。重进页面再试。" />;
  }
  if (props.saved.length === 0) {
    return <ProxyEmptyState title="还没有收藏" sub="点击帖子右下角的 🔖 可以加入收藏" />;
  }
  // 3-列网格 — 复用 IG 收藏页布局
  const all = selectPostMedia(props.saved, props.mediaByPost);
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
  mediaByPost: Record<string, FeedMediaItem[]>;
  onOpenMedia: (entry: { postId: string; index: number }) => void;
  resolveMediaUrl: (path: string) => string;
  color: ProfileTabsProps["color"];
  failed?: boolean | undefined;
}): React.JSX.Element {
  // PROFILE-TAB-LOAD-FAILED-001: 同 SavedTab —— 读失败 ≠ 没人 @ 过你。
  if (props.failed) {
    return <ProxyEmptyState title="被标记没读出来" sub="这次请求失败了 —— 不是真的没有。重进页面再试。" />;
  }
  if (props.tagged.length === 0) {
    return <ProxyEmptyState title="还没有被标记" sub="其他人在帖子里 @ 你时会出现在这里" />;
  }
  const all = selectPostMedia(props.tagged, props.mediaByPost);
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
      <View style={styles.aboutStatBig}>
        <Text style={styles.aboutStatBigLabel}>粉丝 / 关注 / 帖子</Text>
        <Text style={styles.aboutStatBigValue}>
          {props.stats.followers ?? "—"} · {props.stats.following ?? "—"} · {props.stats.posts ?? "—"}
        </Text>
      </View>
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
  // R15.66 Threads R2 行动按钮: 1px 边框 + 10 圆角 + 9px 标签 + 38px 高
  actionsRow: { flexDirection: "row", gap: 8, paddingHorizontal: 18, marginBottom: 13 },
  actionBtn: { flex: 1, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#dedede", backgroundColor: "#fff" },
  actionPrimary: { backgroundColor: "#111", borderColor: "#111" },
  actionPrimaryText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  actionSecondary: { backgroundColor: "#fff", borderColor: "#dedede" },
  actionSecondaryText: { color: "#111", fontSize: 11, fontWeight: "700" },
  actionLime: { backgroundColor: "#C9FF08", borderColor: "#C9FF08" },
  actionLimeText: { color: "#0f172a", fontSize: 11, fontWeight: "700" },

  // R15.66 sceneEntry 暂隐 (R2 设计没场景足迹卡片)
  // 场景
  sceneEntry: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 12, padding: 12, backgroundColor: "#f8fafc", borderRadius: 10, borderWidth: 1, borderColor: "#e2e8f0" },
  sceneEntryEmoji: { fontSize: 22, marginRight: 10 },
  sceneEntryCopy: { flex: 1 },
  sceneEntryTitle: { fontSize: 14, fontWeight: "700", color: "#0f172a" },
  sceneEntrySub: { fontSize: 11, color: "#64748b", marginTop: 1 },
  sceneEntryChevron: { fontSize: 22, color: "#94a3b8" },
  // Tabs — IG/Threads 风: icon + 中文 label, active 黑下划线
  tabsRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#e2e8f0", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", backgroundColor: "#fff" },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 10, position: "relative" },
  tabLabel: { fontSize: 11, color: "#94a3b8", marginTop: 4, fontWeight: "600" },
  tabLabelActive: { color: "#0f172a" },
  tabUnderline: { position: "absolute", bottom: 0, left: 12, right: 12, height: 2, backgroundColor: "#0f172a", borderRadius: 1 },
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
  // REPLY-TARGET-001: 被回复帖子的引用块（Threads 风格）。
  replyQuote: { marginTop: 6, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: "#e2e8f0" },
  replyQuoteText: { fontSize: 12, color: "#64748b", lineHeight: 17 },
  // About
  aboutCard: { marginHorizontal: 16, marginVertical: 12, padding: 16, backgroundColor: "#f8fafc", borderRadius: 10 },
  aboutBio: { fontSize: 13, color: "#0f172a", lineHeight: 19 },
  aboutMetaRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  aboutMetaLabel: { fontSize: 12, marginRight: 6, width: 18 },
  aboutMetaValue: { fontSize: 13, color: "#0f172a" },
  aboutDivider: { height: 1, backgroundColor: "#e2e8f0", marginVertical: 12 },
  aboutStatBig: { alignItems: "center" },
  aboutStatBigLabel: { fontSize: 11, color: "#64748b" },
  aboutStatBigValue: { fontSize: 18, fontWeight: "800", color: "#0f172a", marginTop: 4 },
  // Empty
});
