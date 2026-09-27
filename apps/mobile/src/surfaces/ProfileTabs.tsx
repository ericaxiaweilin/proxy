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

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import type { FeedMediaItem, FeedPost, PostEngagement, PostReply } from "@proxy/contracts";
import { ThreadsPostMedia } from "../components/threads-post-media";
import { ProxyIcon, type ProxyIconName } from "../components/proxy-icon";
import { CircularAvatarImage } from "../components/circular-avatar-image";
// ACTIVITY-REF-001：活动实体引用（contextId = activityId）不进 chip 行。
import { labelContextRefs } from "../activity-ref";
import type { LocalNetClient } from "../localnet-client";
import type { EngagementClient } from "../engagement-client";
import { resolveReplyAuthorDisplayName } from "../feed-author";
import {
  repliesEmptyHint,
  replyTargetParts,
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
  // SCENE-FAVORITE-002: home 场景卡片的 🤍 存本机（MOMENTS 是客户端静态目录，
  // 服务端没有「场景收藏」概念 —— 所以不编造服务端记录）。个人主页的收藏 tab
  // 以前完全不知道它存在 ⇒ 用户在首页点了 🤍、来「我的收藏」找，永远找不到。
  // 这里把同一份 hearts 也画出来；解析由调用方（me.tsx）用
  // resolveSavedSceneIds 完成，与「我的 → 收藏」共用同一份实现。
  savedScenes?: ReadonlyArray<{ id: string; title: string; meta: string }> | undefined;
  taggedPosts: FeedPost[];
  // PROFILE-TAB-LOAD-FAILED-001: 这三个列表加载失败时，调用方以前把它们 set 成 []。
  // 而空数组在这里渲染成「你还没有这类内容」的空态文案 —— 用户会以为自己的
  // 收藏、回复、被提及记录**没了**。失败和「真的没有」必须渲染成两句话。
  // 缺省 false（其它调用方不传）＝ 不显示失败态。
  savedFailed?: boolean;
  repliesFailed?: boolean;
  taggedFailed?: boolean;
  // PROFILE-POSTS-FAILURE-001（补齐）: POSTS 当初被漏掉了 —— me.tsx 把失败处理成
  // 「条数显示 —」＋一条可重试的提示，但**帖子列表本身**照样传空数组进来，于是
  // 同一屏上横幅写着「不是你没有动态」、下面的空态却写着「还没有动态」。
  // 一个说没拉到、一个说你没发过，用户只能信后者。同 savedFailed 口径。
  postsFailed?: boolean;
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
  //
  // PROFILE-ACTION-COUNTS-001：返回类型放宽到「可以回传新的 engagement」。
  // 动作行现在要显示真实计数（原型是 `♡ 12 💬 3 ↻`），而计数的持有者是
  // PostsTab（它自己 hydrate postEngagement）。调用方（me.tsx /
  // other-profile.tsx）本来就在调 `engagement.reactToPost(...)`，而那个方法
  // **返回新的 PostEngagement** —— 只是以前调用方 `void` 掉了、只拿它做错误
  // 提示，于是主页的计数永远停在初始值：点完赞数字不动，等于显示一个假数字。
  // 现在调用方把结果原样 return 出来，PostsTab 直接落库到自己的 state。
  // 不 return 也合法（那就保持今天的行为，计数不刷新），所以不是破坏性改动。
  onLikePost?: ((postId: string) => void | Promise<PostEngagement | void>) | undefined;
  // PROFILE-REPLIES-VISIBLE-001: 主页帖子收到的赞数/评论列表。feed 里能看到的
  // 互动，在个人主页上完全看不见 —— PostCard 只有动作按钮，没有计数也没有列表。
  // engagementClient 可选：没传就保持今天的样子（不渲染假按钮/假数字）。
  engagementClient?: EngagementClient | undefined;
  // PROFILE-ACTION-COUNTS-001 收尾（2026-09-25，用户「少了评论logo功能」）：
  // 这里原来有个 `onReplyPost`，而**全仓没有任何调用方传过它**（`grep -rn onReplyPost
  // apps/mobile/src` 只命中本文件自己）—— 所以 PostCard 那颗回复按钮（闸门
  // `{props.onReply ? … : null}`）**从来没画出来过**，动作行只剩 ♡ ↻ ⤴ 三颗。
  // 现在把它删掉，第 2 颗改成**评论**：原型 `function post(p)` 就是
  // `<button>${I.reply}<span>${p.replies}</span></button>`（图标 + 评论数），
  // 语义是「看这条帖子的评论」，正好复用已有的 onToggleReplies 通道
  // （展开/收起评论列表），不再留一个名字骗人的死 prop。
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
    // PROFILE-ACTION-COUNTS-001：动作行「已喜欢」那一下要跟 feed 同一支强调色
    // （feed 用 theme.color.magenta = #FF2474，原型里点亮的实心心形也是这支红）。
    // 两个调用方本来就是整个 theme 对象传进来的，所以这里只是把已有的字段
    // 声明出来，调用方不用改。
    magenta: string;
  };
  // SELF 主页的操作入口收拢到顶栏「更多 → 主页设置」，徽章墙下面只留 tabs。
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

// PROFILE-TAB-LOGO-001（2026-09-25，用户「还有 logo 要对齐原型」）：tab 图标一律
// 用原型 deepseek_html_20260925_4e54a0.html 的那套字形 —— 帖子 = 圆角方框 + 十字
// 分隔、回复 = 圆形对话气泡、标签 = 同心圆、关于 = ⓘ。
// 改之前：帖子 和 回复 共用同一颗 sparkle（两个 tab 长得一模一样），关于 是个空心
// 圆 —— 三个字形跟"帖子 / 回复 / 关于"没有任何关系，只有 标签 早就是同心圆。
// ⚠️ 第二轮：回复先被指到了现成的 chat（方角气泡），用户当场指出「回复的 logo 还是
// 不符合原型」—— 原型是**圆**气泡，所以单独加了 replyBubble，不复用 chat。
// SAVED 原型没有这一栏（收藏是私库，他人主页本来就不给），沿用 App 里「收藏」
// 一贯的 star（见 me.tsx 的收藏入口），不自己编一个字形。
const PROFILE_TAB_ICON: Record<ProfileTabKey, ProxyIconName> = {
  POSTS: "postsGrid",
  REPLIES: "replyBubble",
  SAVED: "star",
  TAGGED: "target",
  ABOUT: "infoCircle"
};

export function ProfileTabs(props: ProfileTabsProps): React.JSX.Element {
  const [tab, setTab] = useState<ProfileTabKey>("POSTS");
  // PROFILE-ACTION-MORE-001：行动行第三个控件（圆形「···」）的弹层开关。
  const [moreOpen, setMoreOpen] = useState(false);
  // 屏蔽作者的结果提示。失败必须说出来（静默成功 = 用户以为屏蔽了其实没有）。
  const [moreNotice, setMoreNotice] = useState<string | undefined>(undefined);
  const [moreBusy, setMoreBusy] = useState(false);

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
      {/* 行动按钮只给他人主页（关注/消息）。自己主页的操作入口在顶栏
          「更多 → 主页设置」，徽章墙下面不再重复摆编辑/分享。 */}
      {props.viewerMode === "OTHER" ? (
        <View style={styles.actionsRow}>
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
              <Text selectable style={props.isFollowing ? styles.actionSecondaryText : styles.actionPrimaryText}>
                {props.followBusy ? "处理中…" : props.isFollowing ? "✓ 已关注" : "+ 关注"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel="发送消息"
              onPress={props.onSendMessage}
              style={[styles.actionBtn, styles.actionSecondary]}
            >
              {/* REPLY-ROW-FORMAT-001（2026-09-25，用户「消息 logo 也没改」）：原来
                  是 `💬 消息` 直接打 emoji，跟新加的 replyBubble（圆气泡 SVG）不
                  一套。换成 replyBubble + 文字，跟回复 tab 字形同源，圆角统一；按钮
                  结构没变（依旧 Pressable + onSendMessage handler）。 */}
              <ProxyIcon name="replyBubble" color={props.color.ink} size={16} />
              <Text selectable style={styles.actionSecondaryText}> 消息</Text>
            </Pressable>
            {/* PROFILE-ACTION-MORE-001（2026-09-25，用户「还没有对齐原型」）：
                原型行动行是三个控件 —— 关注 / 消息 / 一个圆形「···」。以前只有前两个。
                字形用 ProxyIcon 的 ellipsis（真图标：三个 View 画点），不是往 Text 里
                塞 "···" 字符 —— 后者字重和基线跟着字号跑，正是这个仓库把 ♡/♥ 从
                字符换成图标的原因。菜单里只放真能做的事，见 ProfileMoreSheet。 */}
            <Pressable
              accessibilityLabel="更多"
              disabled={moreBusy}
              onPress={() => { setMoreNotice(undefined); setMoreOpen(true); }}
              style={styles.actionMore}
            >
              <ProxyIcon color={props.color.ink} name="ellipsis" size={18} />
            </Pressable>
          </>
        </View>
      ) : null}
      {props.viewerMode === "OTHER" && moreNotice ? (
        <Text selectable accessibilityLabel="更多操作结果" style={styles.moreNotice}>{moreNotice}</Text>
      ) : null}

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
            <Text selectable style={[styles.tabLabel, activeTab === key && styles.tabLabelActive]}>{PROFILE_TAB_LABEL[key]}</Text>
            {activeTab === key ? <View style={styles.tabUnderline} /> : null}
          </Pressable>
        ))}
      </View>

      {/* Tab body */}
      {activeTab === "POSTS" ? (
        <PostsTab
          pinnedPost={pinnedPost}
          posts={unpinnedPosts}
          failed={props.postsFailed}
          mediaByPost={props.mediaByPost}
          pinnedIds={props.pinnedIds}
          avatarUri={props.profileAvatarUri}
          name={props.profileDraft.name}
          onOpenMedia={props.onOpenMedia}
          onOpenScene={props.onOpenScene}
          onLikePost={props.onLikePost}
          engagementClient={props.engagementClient}
          viewerAccountId={props.viewerAccountId}
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
          // OWN-NAME-001：当前资料名优先只在 SELF 生效 —— OTHER 时 profileDraft
          // 是对方的名字，传进去会把"我回复过的帖子"标成对方的名字。
          viewerDisplayName={props.viewerMode === "SELF" ? props.profileDraft.name : undefined}
          // REPLY-ROW-FORMAT-001：作者块 = 主页本人，三个字段都取自 profileDraft。
          avatarUri={props.profileAvatarUri}
          name={props.profileDraft.name}
          handle={props.profileDraft.handle}
          color={props.color}
        />
      ) : null}
      {activeTab === "SAVED" ? (
        <SavedTab
          saved={props.savedPosts}
          savedScenes={props.savedScenes}
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

      {/* PROFILE-ACTION-MORE-001：行动行的「···」菜单。用真 Modal（不是
          absoluteFill 遮罩）—— 这个组件在调用方是**渲染在 ScrollView 里面**的，
          普通绝对定位覆盖层会被滚出可视区/被裁掉；ReportSheet 之所以能用遮罩，
          是因为调用方把它放在 ScrollView 外面。 */}
      <ProfileMoreSheet
        busy={moreBusy}
        client={props.engagementClient}
        handle={props.profileDraft.handle}
        name={props.profileDraft.name}
        onBusy={setMoreBusy}
        onClose={() => setMoreOpen(false)}
        onMuteFailed={(message) => setMoreNotice(message)}
        onMuted={() => {
          setMoreOpen(false);
          // MUTE-REVERSIBLE-001：屏蔽之后 Ta 的帖子会被 feed 永久过滤，你再也点不到
          // Ta 的帖子菜单或头像 —— 所以提示语必须给出**唯一还留着的那条**撤销路径，
          // 否则用户会以为这是一次不可逆操作（那正是这条注释当初被写歪的地方）。
          setMoreNotice("已屏蔽该作者。可在「我的 → 动态偏好 → 我屏蔽的人」里解除。");
        }}
        open={moreOpen}
      />
    </View>
  );
}

// ---------- ProfileMoreSheet (行动行「···」菜单) ----------

/**
 * PROFILE-ACTION-MORE-001（2026-09-25，用户「还没有对齐原型」）：主页行动行那个
 * 圆形「···」按钮打开的菜单。
 *
 * 里面**只放真能做的事**，这是刻意的：
 *   - **没有「举报」**：页头那颗 举报 就是唯一入口。两套菜单各缺几项比一套更糟
 *     —— FEED-MENU-DEDUP-001 就是为了这个把 feed 帖文里重复的「···」删掉的。
 *   - **没有「减少推荐」**：服务端只有按**帖子**的 RecordFeedPreference
 *     （不感兴趣 / 减少这类内容 / 少看这个人），没有按**账号**的对应命令。
 *     编一条出来点下去只会安静地什么都不发生。
 * 剩下两项都是真的：
 *   - 分享主页：走系统分享，不需要后端（原型那张分享卡也写着「只走标准分享」）。
 *   - 屏蔽作者：engagement.muteAuthor，跟 feed 的「屏蔽作者」是同一个命令。
 *     `props.client` 缺席（游客 / 没接 engagement）时**这一项整条不画** ——
 *     一个点下去没反应的菜单项比没有更糟。
 *
 * 失败一定说出来：屏蔽是「以后不再看到这个人」的承诺，静默失败会让用户以为
 * 已经生效（而它同时是 feed 永久过滤，撤销入口会变得很难找）。
 */
function ProfileMoreSheet(props: {
  open: boolean;
  busy: boolean;
  client?: EngagementClient | undefined;
  name: string;
  handle: string;
  onBusy: (busy: boolean) => void;
  onClose: () => void;
  onMuted: () => void;
  onMuteFailed: (message: string) => void;
}): React.JSX.Element {
  const [error, setError] = useState<string | undefined>(undefined);

  function shareProfile(): void {
    // handle 在两个调用方里都是账号 id（other-profile 传 target.userId），可能带
    // 前导 @（ProfileTabs 里回复 tab 就专门剥过）—— 剥掉再拼，别出现 "@@name"。
    const at = props.handle.replace(/^@+/, "").trim();
    void Share.share({ message: `Proxy · ${props.name}${at === "" ? "" : ` (@${at})`}` });
    props.onClose();
  }

  function mute(): void {
    const client = props.client;
    if (!client) return;
    props.onBusy(true);
    setError(undefined);
    void client.muteAuthor(props.handle.replace(/^@+/, "").trim())
      .then(() => props.onMuted())
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "";
        // 登录态问题不能说成网络问题，否则用户会一直重试（同 ReportSheet 口径）。
        props.onMuteFailed(/session|signed|sign in|auth|401|403/i.test(message) ? "请先登录后再屏蔽。" : "屏蔽没有提交成功，请检查连接后重试。");
      })
      .finally(() => props.onBusy(false));
  }

  return (
    <Modal animationType="fade" onRequestClose={props.onClose} transparent visible={props.open}>
      <Pressable accessibilityLabel="关闭更多菜单" onPress={() => { if (!props.busy) props.onClose(); }} style={styles.moreScrim}>
        <Pressable onPress={() => undefined} style={styles.moreSheet}>
          <View style={styles.moreGrab} />
          <Text selectable numberOfLines={1} style={styles.moreTitle}>{props.name}</Text>
          {error ? <Text selectable accessibilityLabel="更多操作失败" style={styles.moreError}>{error}</Text> : null}
          <Pressable accessibilityLabel="分享主页" onPress={shareProfile} style={styles.moreItem}>
            <Text selectable style={styles.moreItemText}>分享主页</Text>
          </Pressable>
          {props.client ? (
            <Pressable accessibilityLabel="屏蔽作者" disabled={props.busy} onPress={mute} style={styles.moreItem}>
              <Text selectable style={styles.moreItemText}>{props.busy ? "处理中…" : "屏蔽作者"}</Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------- PostsTab (置顶 + 帖子 + 3-列网格 toggle) ----------

function PostsTab(props: {
  pinnedPost: FeedPost | undefined;
  posts: FeedPost[];
  // PROFILE-POSTS-FAILURE-001: 拉动态失败时调用方传的是空数组，跟「一条都没发」
  // 长得一模一样。这个 flag 把两者分开 —— 见下面两个空态。
  failed?: boolean | undefined;
  mediaByPost: Record<string, FeedMediaItem[]>;
  avatarUri?: string | undefined;
  name: string;
  onOpenMedia: (entry: { postId: string; index: number }) => void;
  onOpenScene?: ((sceneId: string) => void) | undefined;
  // PROFILE-ACTION-COUNTS-001：返回类型跟 ProfileTabsProps 对齐 —— 调用方
  // 现在会回传新的 engagement（计数由 PostsTab.toggleLike 落库）。以前这里写成
  // `=> void`，靠 TS 的「void 返回值可赋值」规则侥幸过关，等于把 toggleLike 依赖的
  // 契约藏起来了（读这个类型的人会以为根本没有 Promise 参与）。
  onLikePost?: ((postId: string) => void | Promise<PostEngagement | void>) | undefined;
  resolveMediaUrl: (path: string) => string;
  fallbackLogo: unknown;
  // R15.99: 接 pinnedIds 进来 — ProfileTabs 顶层 hasRealPin 闭包不传进 PostsTab,
  //   而 PostsTab 内部 PinnedCard render 条件需要.
  pinnedIds?: ReadonlyArray<string> | undefined;
  // PROFILE-REPLIES-VISIBLE-001: 帖子互动数据（计数 + 评论列表） hydration 用。
  engagementClient?: EngagementClient | undefined;
  viewerAccountId?: string | undefined;
  color: ProfileTabsProps["color"];
}): React.JSX.Element {
  const [view, setView] = useState<"LIST" | "GRID">("LIST");
  // R15.99: hasRealPin local — 跟 ProfileTabs 顶层同逻辑.
  const hasRealPin = !!(props.pinnedIds && props.pinnedIds.length > 0);
  // PROFILE-REPLIES-VISIBLE-001: 每帖的计数（getPostEngagement）+ 评论列表
  // （点开才拉 ListPostReplies）。失败不断屏：计数缺席就不显示数字（不回填 0），
  // 评论拉失败行内提示可重试。hydratedRef 避免重复注水。
  const [postEngagement, setPostEngagement] = useState<Record<string, PostEngagement>>({});
  const [postReplies, setPostReplies] = useState<Record<string, PostReply[]>>({});
  const [expandedReplies, setExpandedReplies] = useState<ReadonlySet<string>>(new Set());
  const [repliesFailed, setRepliesFailed] = useState<Record<string, boolean>>({});
  const hydratedEngagementRef = useRef<Set<string>>(new Set());
  // PROFILE-ACTION-COUNTS-001：动作行的忙态 / 转发失败态，都按 postId 记。
  const [actionBusy, setActionBusy] = useState<ReadonlySet<string>>(new Set());
  const [repostFailed, setRepostFailed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const client = props.engagementClient;
    if (!client) return;
    const fresh = props.posts.map((post) => post.postId).filter((id) => !hydratedEngagementRef.current.has(id));
    if (fresh.length === 0) return;
    let cancelled = false;
    void (async () => {
      const settled = await Promise.all(fresh.map(async (postId) => {
        try {
          return await client.getPostEngagement(postId);
        } catch {
          return undefined;
        }
      }));
      if (cancelled) return;
      const next: Record<string, PostEngagement> = {};
      settled.forEach((eng, index) => {
        const postId = fresh[index];
        if (!postId || !eng) return;
        hydratedEngagementRef.current.add(postId);
        next[postId] = eng;
      });
      if (Object.keys(next).length > 0) setPostEngagement((previous) => ({ ...previous, ...next }));
    })();
    return () => { cancelled = true; };
  }, [props.posts, props.engagementClient]);
  function togglePostReplies(postId: string): void {
    const client = props.engagementClient;
    if (!client) return;
    if (expandedReplies.has(postId)) {
      setExpandedReplies((previous) => { const next = new Set(previous); next.delete(postId); return next; });
      return;
    }
    setExpandedReplies((previous) => new Set(previous).add(postId));
    if (postReplies[postId] !== undefined) return;
    setRepliesFailed((previous) => ({ ...previous, [postId]: false }));
    void client.listPostReplies(postId, 50)
      .then((listed) => setPostReplies((previous) => ({ ...previous, [postId]: listed.replies })))
      .catch(() => setRepliesFailed((previous) => ({ ...previous, [postId]: true })));
  }
  /**
   * PROFILE-ACTION-COUNTS-001：喜欢。
   *
   * 提交仍然走调用方的 `onLikePost`（错误提示归它管：me.tsx / other-profile.tsx
   * 各自有 notice 文案），但**计数由这里落库**。调用方会把它 `reactToPost(...)`
   * 拿到的新 engagement 原样 return 出来 —— 以前它 `void` 掉、只拿来做错误提示，
   * 于是主页的计数永远停在 hydrate 那一刻：点完赞数字不动。显示一个不会动的数字
   * 比不显示数字更糟，因为用户会以为点赞没生效。
   *
   * 调用方不 return 也合法（老调用方）—— 那就保持老行为，不刷新。
   */
  function toggleLike(postId: string): void {
    const pending = props.onLikePost?.(postId);
    if (!pending || typeof (pending as Promise<unknown>).then !== "function") return;
    setActionBusy((previous) => new Set(previous).add(postId));
    void (pending as Promise<PostEngagement | void>)
      .then((next) => { if (next) setPostEngagement((previous) => ({ ...previous, [postId]: next })); })
      // 提交失败由调用方提示；这里只保证不把失败当成新计数写进去。
      .catch(() => undefined)
      .finally(() => setActionBusy((previous) => { const next = new Set(previous); next.delete(postId); return next; }));
  }

  /**
   * PROFILE-ACTION-COUNTS-001：转发。原型动作行第 3 个按钮。
   *
   * `RepostPost` 从 R14 起服务端就完整实现（含幂等：重复转发返
   * REJECTED / ALREADY_REPOSTED，客户端那侧已把它当成功），但客户端一直没有这个
   * 方法 —— 手机上无处可转发，`reposts` 恒为 0。
   *
   * 它**不返回**新 engagement（服务端只回事件引用），所以成功后再读一次真实计数，
   * 不去猜 +1。
   */
  function repost(postId: string): void {
    const client = props.engagementClient;
    if (!client) return;
    setRepostFailed((previous) => ({ ...previous, [postId]: false }));
    setActionBusy((previous) => new Set(previous).add(postId));
    void client.repostPost(postId)
      .then(() => client.getPostEngagement(postId))
      .then((next) => setPostEngagement((previous) => ({ ...previous, [postId]: next })))
      .catch(() => setRepostFailed((previous) => ({ ...previous, [postId]: true })))
      .finally(() => setActionBusy((previous) => { const next = new Set(previous); next.delete(postId); return next; }));
  }

  /**
   * PROFILE-ACTION-COUNTS-001：一条帖子的动作行 props。
   *
   * 抽出来是因为置顶卡和普通卡要用**同一套**绑定 —— 两个调用点各抄一遍的话，
   * 迟早有一边忘记带 actionBusy 或 repostFailed（这个文件里已经有过一次
   * 「置顶卡少传一个 prop」的坑）。postId 由调用点给，所以这里不需要碰
   * props.pinnedPost 那个在闭包里会被 TS 放宽的窄化。
   */
  function postCardActions(postId: string): {
    onLike?: (() => void) | undefined;
    onRepost?: (() => void) | undefined;
    actionBusy: boolean;
    repostFailed: boolean;
  } {
    return {
      onLike: props.onLikePost ? () => toggleLike(postId) : undefined,
      // 第 2 颗（评论）不在这里 —— 它走 onToggleReplies（见 PostCard 的 💬 按钮），
      // 因为那一颗要同时知道 repliesExpanded 才能画对无障碍标签。以前这里绑过一个
      // 没人传的 onReplyPost，绑了等于没绑。
      // 没有 engagementClient 就没有转发的通道 —— 那一颗整个不画，不画假按钮。
      onRepost: props.engagementClient ? () => repost(postId) : undefined,
      actionBusy: actionBusy.has(postId),
      repostFailed: repostFailed[postId] === true
    };
  }

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
              <Text selectable style={[styles.viewToggleIcon, styles.viewToggleIconInactive]}>≡</Text>
            </Pressable>
            <Pressable onPress={() => setView("GRID")} style={[styles.viewToggleBtn, styles.viewToggleBtnActive]}>
              <Text selectable style={[styles.viewToggleIcon, styles.viewToggleIconActive]}>▦</Text>
            </Pressable>
          </View>
        </View>
        {allMediaEntries.length === 0 ? (
          props.failed
            ? <ProxyEmptyState title="动态没读出来" sub="这次请求失败了 —— 不是真的没有。重进页面再试。" />
            : <ProxyEmptyState title="还没有图片" sub="发布带图的帖子后会出现在这里" />
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
            <Text selectable style={[styles.viewToggleIcon, styles.viewToggleIconActive]}>≡</Text>
          </Pressable>
          <Pressable onPress={() => setView("GRID")} style={styles.viewToggleBtn}>
            <Text selectable style={[styles.viewToggleIcon, styles.viewToggleIconInactive]}>▦</Text>
          </Pressable>
        </View>
      </View>

      {/* 置顶帖 (IG/Threads 风格 pin badge) — R15.89: 需 hasRealPin 才显示,
           避免 fallback posts[0] 被误标 '置顶' */}
      {hasRealPin && props.pinnedPost ? (
        <View style={styles.pinnedCard}>
          <View style={styles.pinnedHeader}>
            <Text selectable style={styles.pinnedBadge}>📌 置顶</Text>
            <Text selectable style={styles.pinnedTime}>· {new Date(props.pinnedPost.createdAt).toLocaleDateString()}</Text>
          </View>
          <PostCard
            post={props.pinnedPost}
            media={props.mediaByPost[props.pinnedPost.postId] ?? []}
            avatarUri={props.avatarUri}
            name={props.name}
            onOpenMedia={props.onOpenMedia}
            onOpenScene={props.onOpenScene}
            {...postCardActions(props.pinnedPost.postId)}
            color={props.color}
            engagement={postEngagement[props.pinnedPost.postId]}
            replies={postReplies[props.pinnedPost.postId]}
            repliesExpanded={expandedReplies.has(props.pinnedPost.postId)}
            repliesFailed={repliesFailed[props.pinnedPost.postId] === true}
            // 没接 engagementClient 就没有评论通道 ⇒ 不传 handler，PostCard 那颗
            // 💬 整颗不画（不摆一颗按不动的按钮）。见 PROFILE-ACTION-COUNTS-001。
            onToggleReplies={props.engagementClient ? () => { const pinned = props.pinnedPost; if (pinned) togglePostReplies(pinned.postId); } : undefined}
            replyViewerId={props.viewerAccountId}
            resolveMediaUrl={props.resolveMediaUrl}
          />
        </View>
      ) : null}

      {props.posts.length === 0 && !props.pinnedPost ? (
        props.failed
          ? <ProxyEmptyState title="动态没读出来" sub="这次请求失败了 —— 不是真的没有。重进页面再试。" />
          : <ProxyEmptyState title="还没有动态" sub="发布的第一条帖子会出现在这里" />
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
            {...postCardActions(post.postId)}
            color={props.color}
            engagement={postEngagement[post.postId]}
            replies={postReplies[post.postId]}
            repliesExpanded={expandedReplies.has(post.postId)}
            repliesFailed={repliesFailed[post.postId] === true}
            // 同上：评论通道由 engagementClient 决定，没有就不画 💬。
            onToggleReplies={props.engagementClient ? () => togglePostReplies(post.postId) : undefined}
            replyViewerId={props.viewerAccountId}
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
  // PROFILE-ACTION-COUNTS-001：动作行回调由 PostsTab 绑好 postId 再传进来 ——
  // 它同时负责把新计数写回自己的 state（见 PostsTab.toggleLike / repost），
  // 所以这里签名是 () => void，不是 (postId) => void。
  onLike?: (() => void) | undefined;
  // 第 2 颗（💬 评论）**没有单独的 prop**：它直接走 onToggleReplies（下面
  // PROFILE-REPLIES-VISIBLE-001 那一组），因为那一颗还要读 repliesExpanded 才能
  // 把无障碍标签画对（查看评论 / 收起评论）。
  onRepost?: (() => void) | undefined;
  // 忙态/失败态也按 postId 记在 PostsTab，这里只收「当前这一条」的。
  actionBusy?: boolean | undefined;
  repostFailed?: boolean | undefined;
  // PROFILE-ACTION-COUNTS-001：动作行要用主题色（ink / magenta），PostCard 以前
  // 只吃硬编码 hex，没有颜色 prop —— 加了它才能让「已喜欢」跟 feed 用同一支强调色。
  color: ProfileTabsProps["color"];
  // PROFILE-REPLIES-VISIBLE-001: 收到的计数 + 评论列表（调用方 hydrate 进来）。
  // 全是可选：没传就是今天的样子（只有动作按钮，不编数字）。
  engagement?: PostEngagement | undefined;
  replies?: ReadonlyArray<PostReply> | undefined;
  repliesExpanded?: boolean | undefined;
  repliesFailed?: boolean | undefined;
  onToggleReplies?: (() => void) | undefined;
  replyViewerId?: string | undefined;
  resolveMediaUrl: (path: string) => string;
}): React.JSX.Element {
  const sharePost = (): void => {
    void Share.share({ message: `${props.post.body}\n\nProxy · ${props.name}` });
  };
  // PROFILE-ACTION-COUNTS-001：已喜欢。`reacted` 是服务端按观察者算的，不猜。
  // engagement 还没拉到（undefined）时按「未喜欢」画 —— 这只是描边心形，不声称
  // 任何事；等数据到了会自己变。
  const liked = props.engagement?.reacted === true;
  // ACTIVITY-REF-001：chip 行只画**标签**。活动实体引用（contextId = activityId）
  // 归 feed 的活动卡片，QUOTE_POST 归引用卡片 —— 这里都不重复画，更不能把
  // activityId 当文案印出来。
  const contextChips = labelContextRefs(props.post);
  return (
    <View style={styles.postCard}>
      <View style={styles.postHead}>
        <View style={styles.postAvatar}>
          {props.avatarUri ? (
            <CircularAvatarImage accessibilityLabel={`${props.name}头像`} size={38} uri={props.avatarUri} />
          ) : (
            <Text selectable style={styles.postAvatarText}>{(props.name || "?").charAt(0).toUpperCase()}</Text>
          )}
        </View>
        <View style={styles.postHeadBody}>
          <Text selectable style={styles.postName} numberOfLines={1}>{props.name}</Text>
          <Text selectable style={styles.postTime} numberOfLines={1}>· {new Date(props.post.createdAt).toLocaleDateString()}</Text>
        </View>
        <Pressable accessibilityLabel="更多" onPress={sharePost} style={styles.postMore}>
          <Text selectable style={styles.postMoreText}>⋯</Text>
        </Pressable>
      </View>
      <View style={styles.postBody}>
        <Text selectable style={styles.postText}>{props.post.body}</Text>
        {contextChips.length > 0 ? (
          <View style={styles.postContextRow}>
            {contextChips.map((entry) => (
              <Pressable
                key={`${entry.contextType}_${entry.contextId}`}
                // 只有 REALITY_SCENE 的 contextId 真的是场景 id。其余都是人话
                // 标签，把它喂给 onOpenScene 只会去开一个不存在的场景 ——
                // 点了没反应，也不报错，正是「通道看着接上了、其实解析不了」。
                disabled={entry.contextType !== "REALITY_SCENE" || !props.onOpenScene}
                onPress={() => props.onOpenScene?.(entry.contextId)}
                style={styles.postContextChip}
              >
                <Text selectable style={styles.postContextText}>{entry.contextType === "REALITY_SCENE" ? "查看场景 ›" : entry.contextId}</Text>
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
        {/* PROFILE-ACTION-COUNTS-001（2026-09-25，用户「还没有对齐原型」）：
            原型每一行的操作区是 4 个按钮 —— ♡ 计数 / 💬 计数 / ↻ 计数 / ⤴
            （见 docs/design/references/Proxy_Profile_Threads_Standalone_R2.html
            的 function post()：`<button>${I.heart}<span>${p.likes}</span></button>`
            四项）。我们以前是文字「♡ 喜欢」「💬 回复」「↗ 分享」，跟 feed 早就
            改好的动作行（FEED-ACTION-ICONS-001）都不是一套。

            三个刻意的选择：
            1. 字形跟 **feed 同一套**（heart / chat），已喜欢用 filled + magenta
               —— 同一个「喜欢」在两个页面不能长成两个样子。
            2. 计数**只在 engagement 拉到之后才画**（`props.engagement ? ... : null`）。
               没拉到就只画图标，不回填 0 —— 沿用这个文件自己的
               PROFILE-REPLIES-VISIBLE-001 口径：没数据不编数字。真·0 会照常显示 0。
            3. 转发（↻）第 3 个按钮：服务端 RepostPost 早就实现，客户端以前没有
               这个方法，所以它以前**根本画不出来**（画了也没法按）。现在
               engagementClient.repostPost 补上了，见 PostsTab.repost。 */}
        <View style={styles.postActions}>
          {props.onLike ? (
            <Pressable accessibilityLabel="喜欢" disabled={props.actionBusy} onPress={props.onLike} style={styles.postAction}>
              {/* FEED-ACTION-ROW-001：第 1 颗改用 replyLike，跟 💬/↻/⤴ 同一组 Feather
                  1.8 描边 —— 之前那颗 heart 是 CSS 拼的 View，几何和描边粗细都跟同排
                  另外 3 颗不一样，看起来「不像原型」。replyLike 的 case 已经支持
                  filled（跟 bookmark 同形），所以 liked=true 时仍然显示实心 ♥。
                  baseline 同步：B326 → B327，参考 docs/design/BASELINE_CHANGELOG.md。 */}
              <ProxyIcon color={liked ? props.color.magenta : props.color.ink} filled={liked} name="replyLike" size={18} />
              {props.engagement ? (
                <Text selectable style={[styles.postActionCount, liked && styles.postActionOn]}>{props.engagement.reactions}</Text>
              ) : null}
            </Pressable>
          ) : null}
          {/* PROFILE-ACTION-COUNTS-001 收尾（2026-09-25，用户「少了评论logo功能」）：
              第 2 颗 = **评论**。原型 `function post(p)` 是
              `<button>${I.reply}<span>${p.replies}</span></button>` —— 图标 + 评论数，
              语义是「看这条帖子的评论」。以前这一颗挂在 `onReplyPost` 上，而那个 prop
              **全仓没有任何调用方传过** ⇒ 它从来没画出来过（动作行只剩 ♡ ↻ ⤴ 三颗，
              用户对照原型一眼就看出来了）。
              现在改走 onToggleReplies（展开/收起评论列表），没接 engagementClient 时
              整颗不画 —— 没有评论通道就不摆一颗按不动的按钮。 */}
          {props.onToggleReplies ? (
            <Pressable
              accessibilityLabel={props.repliesExpanded ? "收起评论" : "查看评论"}
              onPress={props.onToggleReplies}
              style={styles.postAction}
            >
              {/* ⚠️ 字形必须是 replyBubble（**圆**气泡），不能用 chat：chat 是方角
                  气泡（`M5 6h14v9H9l-4 3z`），原型的 `I.reply` 是
                  `M20 11.5a7.5 7.5 0 1 1-3.2-6.1A7.5 7.5 0 0 1 20 11.5Z` + 尾巴
                  —— 圆的。同一个错在 PROFILE-TAB-LOGO-001 已经犯过一次（当时把
                  回复 tab 指到 chat，用户当场指出「回复的 logo 还是不符合原型」），
                  proxy-icon.tsx 里那条注释就是为它写的。回复行第 2 颗也是
                  replyBubble（REPLY-ACTION-ICONS-001），两处同一个字形。 */}
              <ProxyIcon color={props.color.ink} name="replyBubble" size={18} />
              {props.engagement ? <Text selectable style={styles.postActionCount}>{props.engagement.replies}</Text> : null}
            </Pressable>
          ) : null}
          {props.onRepost ? (
            <Pressable accessibilityLabel="转发" disabled={props.actionBusy} onPress={props.onRepost} style={styles.postAction}>
              <ProxyIcon color={props.color.ink} name="replyRepost" size={18} />
              {props.engagement ? <Text selectable style={styles.postActionCount}>{props.engagement.reposts}</Text> : null}
            </Pressable>
          ) : null}
          {/* 分享顶到行尾：原型的 `.pa` 第 4 个按钮带 margin-left:auto，用户给的
              设计稿里那个 ⤴ 也确实在最右端（回复行同形状，见 replyActionsSpacer）。 */}
          <View style={styles.postActionsSpacer} />
          <Pressable accessibilityLabel="分享帖子" onPress={sharePost} style={styles.postAction}>
            <ProxyIcon color={props.color.ink} name="replyShare" size={18} />
          </Pressable>
        </View>
        {/* 转发失败要能看见、能重试。静默失败在这个位置特别糟：用户以为转发出去
            了，别人却看不到。 */}
        {props.repostFailed && props.onRepost ? (
          <Pressable accessibilityLabel="重试转发" onPress={props.onRepost} style={styles.postActionRetry}>
            <Text selectable style={styles.postActionRetryText}>转发没有提交成功，点这里重试。</Text>
          </Pressable>
        ) : null}
        {/* PROFILE-REPLIES-VISIBLE-001：评论列表（点 💬 才拉，拉失败行内提示）。
            作者名走 resolveReplyAuthorDisplayName —— 无名不显示裸 id。
            ⚠️ 原来这里还有一行独立的「💬 N 条评论 ﹀」开关。PROFILE-ACTION-COUNTS-001
            收尾时删掉了：动作行第 2 颗现在**就是**这个开关（原型也是把评论数画在动作
            行里的），留着这一行等于同屏两个评论入口、隔 8px 说同一个数字。 */}
        {props.repliesExpanded && props.onToggleReplies ? (
          props.repliesFailed ? (
            <Pressable onPress={props.onToggleReplies} style={styles.postReplyToggle} accessibilityLabel="收起评论">
              <Text selectable style={styles.postReplyToggleText}>评论暂时无法读取，点这里收起重试</Text>
            </Pressable>
          ) : (props.replies ?? []).length === 0 ? (
            /* 展开成功但一条评论都没有时必须说一句话：否则点完 💬 屏幕上什么都不变，
               看起来像按钮坏了。只在**确实拉到过**（replies !== undefined）时才敢说，
               还在读的时候什么都不说 —— 不能把「还没读到」说成「没有」。 */
            props.replies === undefined ? null : (
              <Text selectable style={styles.postReplyEmpty}>还没有评论</Text>
            )
          ) : (
            <View>
              {(props.replies ?? []).map((reply) => (
                <View key={reply.replyId} style={styles.replyCard}>
                  <View style={styles.replyMeta}>
                    <Text selectable style={styles.replyTarget}>
                      {resolveReplyAuthorDisplayName(reply, props.replyViewerId)}
                    </Text>
                    <Text selectable style={styles.replyTime}>· {replyTimestampLabel(reply.createdAt)}</Text>
                  </View>
                  <Text selectable style={styles.replyText}>{reply.body}</Text>
                </View>
              ))}
            </View>
          )
        ) : null}
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
  viewerDisplayName?: string | undefined;
  // REPLY-ROW-FORMAT-001（2026-09-25，用户「回复的格式」对齐原型）：原型每一行是
  // `.feed-item` = 左侧头像 + 右侧一列（feed-head 名字/@handle → reply-context
  // 「回复了 X 的帖子 · 时间」→ 正文）。以前这一行只有后两项，没有作者块 ——
  // 一屏回复看不出是谁发的。作者就是主页本人，头像/名字/handle 都取自
  // profileDraft（真数据，不是占位）。
  avatarUri?: string | undefined;
  name: string;
  handle: string;
  color: ProfileTabsProps["color"];
  failed?: boolean | undefined;
}): React.JSX.Element {
  // PROFILE-TAB-LOAD-FAILED-001: 失败要单独一句，不能落进下面那条空态文案。
  if (props.failed) {
    return <ProxyEmptyState title="回复没读出来" sub="这次请求失败了 —— 不是真的没有。重进页面再试。" />;
  }
  if (props.replies.length === 0) {
    // REPLY-EMPTY-VIEWER-001: 这句以前写死成「你在其他帖子下面的回复…」——
    // 访客点开别人的主页、那个人一条回复都没有时，屏幕上就在说「你」。
    // 跟 REPLY-TARGET-001 当初那个 bug 同一句话、同一个毛病，只是漏在空态上。
    return <ProxyEmptyState title="还没有回复" sub={repliesEmptyHint(props.viewerMode)} />;
  }
  // REPLY-ROW-FORMAT-001: handle 可能带也可能不带前导 @（me.tsx 两处都在运行时补
  // @，见 1069/1099 行）。这里先剥掉再统一加一个 —— 否则会出现 "@@name"。
  // 剥完是空串就不渲染 handle：一个光秃秃的 "@" 比没有更糟（不编内容）。
  const atHandle = props.handle.replace(/^@+/, "").trim();
  return (
    <View>
      {props.replies.map((reply) => {
        // REPLY-TARGET-001: 取不回来的父帖（已删 / 已收紧成仅关注者可见）就是
        // undefined —— 这一行退化成中性文案，不显示 id、不编名字。
        const target = props.targets[reply.parentPostId];
        // REPLY-TARGET-NAME-INK-001: 名字要单独上墨色，所以取分段版（整句版就是
        // 这三段拼起来的，见 reply-target.ts）。句式本身仍然只由 reply-target.ts
        // 定义 —— 这里不拼字符串。调用保持单行：REPLY-TARGET-001 那颗钉是逐行
        // grep 的，拆成多行会让它变成假红。
        const targetParts = replyTargetParts(props.viewerMode, target, props.viewerAccountId, props.viewerDisplayName);
        return (
          // key 用 replyId：同一条帖子可以被同一个人回复多次，用父帖 id 会撞。
          <View key={reply.replyId} style={styles.replyCard}>
            <View style={styles.replyAvatar}>
              {props.avatarUri ? (
                <CircularAvatarImage accessibilityLabel={`${props.name}头像`} size={36} uri={props.avatarUri} />
              ) : (
                <Text selectable style={styles.replyAvatarText}>{(props.name || "?").charAt(0).toUpperCase()}</Text>
              )}
            </View>
            <View style={styles.replyBody}>
              <View style={styles.replyHead}>
                <Text selectable numberOfLines={1} style={styles.replyName}>{props.name}</Text>
                {atHandle !== "" ? (
                  <Text selectable numberOfLines={1} style={styles.replyHandle}>@{atHandle}</Text>
                ) : null}
              </View>
              <View style={styles.replyMeta}>
                {/* REPLY-TARGET-NAME-INK-001（2026-09-25，用户「你看回复xx 这个xx
                    是灰色 但是原型是黑色的」）：原型这一行是「回复了 Linh 的帖子」，
                    名字是墨色、其余是次要色。以前整句一个 <Text>（styles.replyTarget
                    只有一种颜色），名字跟着一起变灰。现在分三段渲染，只有名字段换成
                    styles.replyTargetName。文案一个字没改 —— replyTargetParts 拼
                    出来跟原来的 replyTargetLabel 逐字相同。 */}
                <Text selectable style={styles.replyTarget}>
                  {targetParts.prefix}
                  {targetParts.name !== "" ? (
                    <Text selectable style={styles.replyTargetName}>{targetParts.name}</Text>
                  ) : null}
                  {targetParts.suffix}
                </Text>
                <Text selectable style={styles.replyTime}>· {replyTimestampLabel(reply.createdAt)}</Text>
              </View>
              <Text selectable style={styles.replyText}>{reply.body}</Text>
              {/* 引用块：让「回复了谁」这条信息能落到实处 —— 看到原帖才知道
                  说的是哪件事（Threads 的做法）。 */}
              {target && target.excerpt !== "" ? (
                <View style={styles.replyQuote}>
                  <Text selectable numberOfLines={2} style={styles.replyQuoteText}>{target.excerpt}</Text>
                </View>
              ) : null}
              {/* REPLY-ACTION-ICONS-001（2026-09-25，用户「这几个 logo 没有对齐设计的」）：
                  原型 `.feed-actions{display:flex;align-items:center;gap:16px;margin-top:4px}`
                  + 4 个 Feather svg（♡/💬/↻/⤴）。我们以前这一行**没画**（PROFILE-
                  REPLIES-VISIBLE-001 没数据就别画假按钮），但现在图标形状本身就该
                  对齐原型 —— 至少形状先就位，**不渲染假数字、不挂假 handler**：
                  ReplyEntry 只有 replyId/parentPostId/body/createdAt，没有赞/评论数，
                  也没有 like/comment/repost 的接口。所以这一行只是图标**形状占位**，
                  等后端有数据/接口再加 Pressable + 计数（按 PROFILE-REPLIES-VISIBLE-001
                  「没传就不渲染假按钮/假数字」）。分享例外 —— 但目前 ReplyEntry 也没
                  有可分享的 URL，一并空着；Share 由 onOpenPost 那条入口走。
                  评论复用 replyBubble 字形（跟回复 tab 同源），其他 3 个是新加的
                  Feather 字形。 */}
              <View style={styles.replyActions}>
                <ProxyIcon name="replyLike" color={props.color.muted} size={18} />
                <ProxyIcon name="replyBubble" color={props.color.muted} size={18} />
                <ProxyIcon name="replyRepost" color={props.color.muted} size={18} />
                <View style={styles.replyActionsSpacer} />
                <ProxyIcon name="replyShare" color={props.color.muted} size={18} />
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ---------- SavedTab (收藏, Phase 1 提示 + Photos 网格复用) ----------

function SavedTab(props: {
  saved: FeedPost[];
  savedScenes?: ReadonlyArray<{ id: string; title: string; meta: string }> | undefined;
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
  const scenes = props.savedScenes ?? [];
  // SCENE-FAVORITE-002: 只有场景收藏、没有帖子收藏时，以前整屏显示「还没有收藏」
  // —— 用户明明刚在首页点过 🤍，来这里看到的却是一句"你没有收藏"。只要有一边
  // 非空就不能说"还没有收藏"。
  if (props.saved.length === 0 && scenes.length === 0) {
    return <ProxyEmptyState title="还没有收藏" sub="点击帖子右下角的 🔖 或首页场景卡片右上角的 🤍 可以加入收藏" />;
  }
  // 3-列网格 — 复用 IG 收藏页布局
  const all = selectPostMedia(props.saved, props.mediaByPost);
  return (
    <View>
      {scenes.length > 0 ? (
        <View>
          <View style={styles.savedHint}>
            <Text selectable style={styles.savedHintText}>场景灵感 · 来自首页收藏</Text>
          </View>
          {scenes.map((scene) => (
            <View key={scene.id} style={styles.savedSceneRow}>
              <Text selectable style={styles.savedSceneTitle}>{scene.title}</Text>
              <Text selectable style={styles.savedSceneMeta}>{scene.meta}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {all.length > 0 ? (
        <View>
          <View style={styles.savedHint}>
            <Text selectable style={styles.savedHintText}>仅自己可见 · {all.length} 项</Text>
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
      ) : null}
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
            <Text selectable style={styles.taggedOverlayText}>@{entry.postId.slice(0, 6)}</Text>
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
      <Text selectable style={styles.aboutBio}>{props.profileDraft.bio}</Text>
      <View style={styles.aboutMetaRow}>
        <Text selectable style={styles.aboutMetaLabel}>📍</Text>
        <Text selectable style={styles.aboutMetaValue}>{props.profileDraft.city}</Text>
      </View>
      <View style={styles.aboutMetaRow}>
        <Text selectable style={styles.aboutMetaLabel}>🆔</Text>
        <Text selectable style={styles.aboutMetaValue}>@{props.profileDraft.handle}</Text>
      </View>
      <View style={styles.aboutDivider} />
      <View style={styles.aboutStatBig}>
        <Text selectable style={styles.aboutStatBigLabel}>粉丝 / 关注 / 帖子</Text>
        <Text selectable style={styles.aboutStatBigValue}>
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
  // PROFILE-ACTION-MORE-001：行动行第三个控件 —— 原型那个圆形「···」。
  // 高度和描边跟旁边两颗药丸同源（38 / #dedede），但**不吃 flex** ——
  // 药丸是 flex:1 平分剩余宽度，这颗是固定宽的正圆（原型里它明显更窄）。
  actionMore: { alignItems: "center", borderColor: "#dedede", borderRadius: 19, borderWidth: 1, height: 38, justifyContent: "center", width: 38 },
  moreNotice: { color: "#b45309", fontSize: 11, marginBottom: 10, paddingHorizontal: 18 },
  // 「···」菜单的弹层。数值跟 components/report-sheet.tsx 对齐（同一套视觉语言：
  // 半透明遮罩 + 底部圆角白卡 + 抓手条），不另造一套。
  moreScrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  moreSheet: { backgroundColor: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 20, paddingHorizontal: 16, paddingTop: 10, width: "100%" },
  moreGrab: { alignSelf: "center", backgroundColor: "#e2e8f0", borderRadius: 2, height: 4, marginBottom: 12, width: 36 },
  moreTitle: { color: "#111", fontSize: 15, fontWeight: "800", marginBottom: 6 },
  moreError: { color: "#b45309", fontSize: 12, paddingBottom: 6 },
  moreItem: { paddingVertical: 13 },
  moreItemText: { color: "#111", fontSize: 14 },
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
  postReplyToggle: { marginTop: 8 },
  postReplyToggleText: { color: "#64748b", fontSize: 12, fontWeight: "600" },
  // 「还没有评论」：点开 💬 但确实一条都没有时的那句话。跟 postReplyToggleText 同支
  // 次要色，但**不是**按钮（没有 Pressable 包它，没有下划/箭头）—— 它是一句陈述。
  postReplyEmpty: { color: "#64748b", fontSize: 12, marginTop: 8 },
  // PROFILE-ACTION-COUNTS-001：图标 + 计数并排。计数**只在 engagement 到了才渲染**
  // （见 PostCard），所以这里不设 minWidth —— 没数字时按钮就是纯图标，跟原型第 4 个
  // （只有 ⤴）同一形状。
  // 计数文字的颜色/字重照抄 feed 的动作行（postActionCount / postActionOn），
  // 这样同一个「喜欢」在 feed 和个人主页上长得一样；已喜欢时图标用
  // props.color.magenta、文字用 #6C36C8，也是照抄 feed 的现状，不另发明一套。
  postAction: { alignItems: "center", flexDirection: "row", gap: 5, paddingVertical: 4 },
  postActionCount: { color: "#111", fontSize: 12, fontWeight: "700" },
  postActionOn: { color: "#6C36C8" },
  postActionsSpacer: { flex: 1 },
  postActionRetry: { marginTop: 6 },
  postActionRetryText: { color: "#b45309", fontSize: 11, fontWeight: "600" },
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
  // SCENE-FAVORITE-002: 场景收藏行（个人主页收藏 tab）。跟「我的 → 收藏」
  // 同一份数据、同一套解析，样式各自适配各页的排版。
  savedSceneRow: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e2e8f0" },
  savedSceneTitle: { fontSize: 14, color: "#0f172a" },
  savedSceneMeta: { fontSize: 12, color: "#64748b", marginTop: 2 },
  // Reply
  // REPLY-ROW-FORMAT-001：照原型 `.feed-item{display:flex;gap:12px}` + 左头像右一
  // 列；头像 36 圆形、名字 13/700、@handle 11 灰 —— 跟 PostsTab 的 postHead 同一口径
  // （那边头像 38），两栏看起来是同一套列表。gap 12 直接抄原型。
  replyCard: { flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e2e8f0" },
  replyAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#cbd5e1", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  replyAvatarText: { fontSize: 15, color: "#0f172a", fontWeight: "700" },
  replyBody: { flex: 1, minWidth: 0 },
  replyHead: { alignItems: "center", flexDirection: "row", gap: 6, marginBottom: 2 },
  replyName: { fontSize: 13, fontWeight: "700", color: "#0f172a", flexShrink: 1 },
  replyHandle: { fontSize: 11, color: "#94a3b8", flexShrink: 1 },
  replyMeta: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  replyTarget: { fontSize: 11, color: "#94a3b8" },
  // REPLY-TARGET-NAME-INK-001: 「回复了 X 的帖子」里的 X 单独上墨色（跟 replyName /
  // replyText 同一支墨色 #0f172a），其余仍是次要色。嵌套 <Text> 继承父级字号，
  // 所以这里只给颜色 —— 11pt 的底线由 styles.replyTarget 撑着。
  replyTargetName: { color: "#0f172a" },
  replyTime: { fontSize: 11, color: "#94a3b8" },
  replyText: { fontSize: 13, color: "#0f172a", marginTop: 4, lineHeight: 18 },
  // REPLY-TARGET-001: 被回复帖子的引用块（Threads 风格）。
  replyQuote: { marginTop: 6, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: "#e2e8f0" },
  replyQuoteText: { fontSize: 12, color: "#64748b", lineHeight: 17 },
  // REPLY-ACTION-ICONS-001: 4 个图标 + 间隔 16 + 最后一个 share 用 marginLeft:auto
  // 顶到行尾（原型 .feed-actions 第四个图标 style="margin-left:auto"）。
  replyActions: { alignItems: "center", flexDirection: "row", gap: 16, marginTop: 6 },
  replyActionsSpacer: { flex: 1 },
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
