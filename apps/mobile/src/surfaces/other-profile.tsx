import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { FeedMediaItem, FeedPost } from "@proxy/contracts";
import type { EngagementClient } from "../engagement-client";
import type { LocalNetClient } from "../localnet-client";
import type { ModerationClient } from "../moderation-client";
import { ReportSheet } from "../components/report-sheet";
import type { SecureSessionStore } from "../secure-session";
import { color } from "../theme";
import { ProfileTabs, type ProfileMediaEntry } from "./ProfileTabs";
import { MediaViewer } from "../media/AdaptiveMediaCollection";
import { mapFollowError } from "./feed-error-map";
import { beginMediaView, beginPostView, endMediaView, endPostView } from "../post-impression";
import {
  parentPostIdsForReplies,
  replyEntriesFromReplies,
  replyTargetsFromPosts,
  type ReplyEntry,
  type ReplyTarget
} from "../reply-target";

const OTTER_LOGO = require("../../assets/otter-logo.png");

export type OtherProfileTarget = {
  userId: string;
  name: string;
  city?: string | undefined;
  avatarUri?: string | undefined;
  posts: FeedPost[];
  mediaByPost: Record<string, FeedMediaItem[]>;
};

export function OtherProfileSurface({ target, engagement, localNet, moderation, secureSessionStore, onBack, onMessage }: {
  target: OtherProfileTarget;
  engagement: EngagementClient;
  localNet: LocalNetClient;
  // COMP-REPORT-002: 举报这个账号。冒充他人 / 招嫖揽客这类事，用户往往
  // 是从某个账号整体看出来的，而不是某一条帖子。
  moderation: ModerationClient;
  secureSessionStore?: SecureSessionStore | undefined;
  onBack: () => void;
  onMessage: (name: string, avatarUri?: string) => void;
}): React.JSX.Element {
  const [counts, setCounts] = useState<{ followers: number; following: number } | undefined>(undefined);
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [reporting, setReporting] = useState(false);
  const [resolvedPosts, setResolvedPosts] = useState<FeedPost[]>(target.posts);
  const [resolvedMedia, setResolvedMedia] = useState<Record<string, FeedMediaItem[]>>(target.mediaByPost);
  // PROFILE-TABS-001: 他人主页的 REPLIES tab 之前硬编码传 []，5 个 tabs 里有
  // 3 个永远是空态。回复是公开内容，这里拉真数据；SAVED/TAGGED 保持空 ——
  // 收藏是别人的私库（不上他人主页），标记目前只有客户端侧的说法，没有
  // 服务端依据，宁可留空态也不编数据。
  // REPLY-TARGET-001: 回复有自己的形状（replyId 才是稳定 key），被回复的父帖
  // 另放一张表。以前这里把作者硬写成 target.userId、标题写死「你回复了」——
  // 看别人的主页却说「你回复了」。
  const [replyEntries, setReplyEntries] = useState<ReplyEntry[]>([]);
  const [replyTargets, setReplyTargets] = useState<Record<string, ReplyTarget>>({});
  // 判定「被回复的帖子是不是访问者自己的」用，跟 feed 同一套身份规则。
  const [viewerAccountId, setViewerAccountId] = useState<string | undefined>(undefined);
  // 图片查看器：之前 onOpenMedia 是空函数，他人照片点不开。
  // 与我的主页同款 MediaViewer，可左右切、可关。
  const [viewer, setViewer] = useState<{ postId: string; index: number } | undefined>(undefined);
  const viewedItems = viewer ? resolvedMedia[viewer.postId] ?? [] : [];
  // TWIN-SIGNALS-001: 看别人的帖子 = 一次曝光，按帖子记一次停留——只在
  // 换到不同帖子时才 flush，同一个帖子里划着看好几张照片不重复计。依赖数组
  // 用 viewer?.postId（字符串），不是 viewer（对象引用），是这条区别的关键：
  // 划照片只改 index，postId 字符串没变，effect 不会重跑。
  const postViewStartRef = useRef(0);
  useEffect(() => {
    if (!viewer) return;
    postViewStartRef.current = beginPostView();
    const postId = viewer.postId;
    return () => { void endPostView(localNet, postId, postViewStartRef.current); };
  }, [viewer?.postId, localNet]);
  // MEDIA-DWELL-001: 同一个帖子里的每张照片单独计时——划到下一张就 flush
  // 上一张，不是整段查看会话关闭才报一次（那样多张照片的时间会全记在
  // postId 一个数字里，参考稿里"每张照片都有追溯"要的正是这个粒度）。
  // 依赖数组用 viewer（对象引用），每次 index 变都要重跑。
  const mediaViewStartRef = useRef(0);
  useEffect(() => {
    if (!viewer) return;
    mediaViewStartRef.current = beginMediaView();
    const mediaAssetId = resolvedMedia[viewer.postId]?.[viewer.index]?.mediaAssetId;
    return () => { if (mediaAssetId) void endMediaView(localNet, mediaAssetId, mediaViewStartRef.current); };
  }, [viewer, localNet, resolvedMedia]);
  // PROFILE-VISIT-001: 打开别人的主页 = 一次访问，喂给对方的"主页访问"战绩
  // （见 friend-crm.tsx 的 Advanced Insight / me.tsx 的访问与转化）。失败静默，
  // 埋点从不影响主渲染路径；recordProfileOpen 内部已经排除"自己看自己"。
  useEffect(() => {
    void localNet.recordProfileOpen(target.userId);
  }, [target.userId, localNet]);
  const photos = useMemo<ProfileMediaEntry[]>(() => resolvedPosts.flatMap((post) => (resolvedMedia[post.postId] ?? []).map((item, index) => ({ item, index, postId: post.postId }))), [resolvedPosts, resolvedMedia]);
  useEffect(() => {
    setResolvedPosts(target.posts);
    setResolvedMedia(target.mediaByPost);
  }, [target.posts, target.mediaByPost]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // 若传入的 posts 为空或少于 1 页，分页扫 feed 按 authorId/name 兜底，避免他人的主页空白
        if (resolvedPosts.length > 0) return;
        let cursor: string | undefined = undefined;
        let hasMore = true;
        const allPosts: FeedPost[] = [];
        const allMedia: Record<string, FeedMediaItem[]> = {};
        let pages = 0;
        while (hasMore && pages < 4 && !cancelled) {
          const page = await localNet.listFeedPosts(cursor, 50);
          if (cancelled) return;
          allPosts.push(...page.posts);
          Object.assign(allMedia, page.media);
          cursor = page.nextCursor;
          hasMore = page.hasMore;
          pages += 1;
        }
        if (cancelled) return;
        const filtered = allPosts.filter((post) => post.authorId === target.userId || post.authorDisplayName === target.name);
        if (filtered.length > 0) {
          const media: Record<string, FeedMediaItem[]> = {};
          for (const post of filtered) { const items = allMedia[post.postId]; if (items) media[post.postId] = items; }
          setResolvedPosts(filtered);
          setResolvedMedia(media);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [target.userId, target.name, localNet, resolvedPosts.length]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const nextCounts = await engagement.getFollowCounts(target.userId);
        if (!cancelled) setCounts(nextCounts);
        const session = await secureSessionStore?.read();
        if (session?.userAccountId) {
          if (!cancelled) setViewerAccountId(session.userAccountId);
          const state = await engagement.isFollowing(session.userAccountId, target.userId);
          if (!cancelled) setFollowing(state);
        }
      } catch {
        // Public profile remains readable when the authenticated relationship
        // projection is temporarily unavailable.
      }
    })();
    return () => { cancelled = true; };
  }, [engagement, secureSessionStore, target.userId]);

  useEffect(() => {
    let cancelled = false;
    void engagement.listUserReplies(target.userId, 30)
      .then(async (r) => {
        if (cancelled) return;
        // REPLY-TARGET-001: 服务端一直在发 parentPostId，只是以前没人读，
        // 于是这一栏只能显示光秃秃的「你回复了」。父帖走 ListPostsByIds 回查
        // —— 与动态流同一条可见性口径，取不回来的就退化成中性文案。
        const entries = replyEntriesFromReplies(r.replies);
        setReplyEntries(entries);
        const parentIds = parentPostIdsForReplies(entries);
        if (parentIds.length === 0) {
          setReplyTargets({});
          return;
        }
        try {
          const parents = await localNet.listPostsByIds(parentIds);
          if (!cancelled) setReplyTargets(replyTargetsFromPosts(parents.posts));
        } catch {
          // 引用块拿不到不该把回复本身也吞掉。
          if (!cancelled) setReplyTargets({});
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReplyEntries([]);
          setReplyTargets({});
        }
      });
    return () => { cancelled = true; };
  }, [engagement, localNet, target.userId]);

  async function likePost(postId: string): Promise<void> {
    setNotice(undefined);
    try {
      await engagement.reactToPost(postId, "LIKE", true);
      setNotice("已点赞");
    } catch {
      setNotice("点赞没有提交成功，请检查连接后重试。");
    }
  }

  async function toggleFollow(): Promise<void> {    if (busy) return;
    setBusy(true); setNotice(undefined);
    try {
      if (following) await engagement.unfollowProfile(target.userId); else await engagement.followProfile(target.userId);
      setFollowing(!following);
      setCounts((current) => (current ? { ...current, followers: Math.max(0, current.followers + (following ? -1 : 1)) } : current));
    } catch (e) {
      // 同一个 catch 曾全报"访客不能关注"——登录着网络抖一下也被赶去登录。
      setNotice(mapFollowError(e, following ? "unfollow" : "follow"));
    } finally { setBusy(false); }
  }

  return <View style={styles.root}>
    <View style={styles.header}><Pressable onPress={onBack} style={styles.back}><Text style={styles.backText}>‹ 返回</Text></Pressable><Text style={styles.headerTitle}>{target.name}</Text><Pressable onPress={() => setReporting(true)} style={styles.headerAction} accessibilityLabel="举报这个账号"><Text style={styles.headerActionText}>举报</Text></Pressable></View>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.identity}><View style={styles.avatar}>{target.avatarUri ? <Image source={{ uri: target.avatarUri }} style={styles.avatarPhoto} /> : <Text style={styles.avatarText}>{target.name.charAt(0).toUpperCase()}</Text>}</View><View style={styles.identityCopy}><Text style={styles.name}>{target.name}</Text><Text style={styles.handle}>@{target.userId}</Text><Text style={styles.bio}>{target.city ?? "公开主页"}</Text></View></View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {/* AVATAR-CARRY-001: profileAvatarUri 之前没传——ProfileTabs 内部这根线
          (PostsTab → PostCard.avatarUri) 本来就是通的，帖子头像栏一直画着，
          只是没人喂真图给它，所以每条帖子都落回首字母。不是另一套管线要修，
          是同一套管线里这一路调用方漏接的最后一根线，跟顶部身份区用的
          target.avatarUri 是同一个值。 */}
      <ProfileTabs profileDraft={{ name: target.name, handle: target.userId, bio: "", city: target.city ?? "" }} profileAvatarUri={target.avatarUri} posts={resolvedPosts} mediaByPost={resolvedMedia} photos={photos} replies={replyEntries} replyTargets={replyTargets} savedPosts={[]} taggedPosts={[]} stats={{ posts: resolvedPosts.length, followers: counts?.followers, following: counts?.following }} onOpenMedia={(entry) => setViewer(entry)} onLikePost={(postId) => void likePost(postId)} resolveMediaUrl={(path) => localNet.resolveMediaUrl(path)} fallbackLogo={OTTER_LOGO} color={color} viewerMode="OTHER" viewerAccountId={viewerAccountId} isFollowing={following} followBusy={busy} onFollow={toggleFollow} onUnfollow={toggleFollow} onSendMessage={() => onMessage(target.name, target.avatarUri)} />
    </ScrollView>
    {viewer && viewedItems.length > 0 ? <MediaViewer items={viewedItems} index={viewer.index} author={target.name} resolveUrl={(path) => localNet.resolveMediaUrl(path)} onNavigate={(index) => setViewer((current) => current ? { ...current, index } : current)} onClose={() => setViewer(undefined)} /> : null}
    {/* COMP-REPORT-002: 举报账号。target 用 userId —— 举报要指到账号，
        不是指到某条帖子（帖子举报走 feed 的入口）。 */}
    {reporting ? (
      <ReportSheet
        moderation={moderation}
        targetType="ACCOUNT"
        targetId={target.userId}
        title={`举报账号 ${target.name}`}
        {...(target.userId ? { subtitle: `@${target.userId}` } : {})}
        onClose={() => setReporting(false)}
        onDone={() => { setReporting(false); setNotice("举报已提交，平台将按审核流程处理。"); }}
      />
    ) : null}
  </View>;
}

const styles=StyleSheet.create({root:{backgroundColor:color.offWhite,flex:1},header:{alignItems:"center",borderBottomColor:color.line,borderBottomWidth:1,flexDirection:"row",height:50,paddingHorizontal:16},back:{flex:1},backText:{color:color.magenta,fontSize:15,fontWeight:"800"},headerTitle:{color:color.ink,fontSize:17,fontWeight:"900"},headerSpacer:{flex:1},headerAction:{alignItems:"flex-end",flex:1},headerActionText:{color:color.muted,fontSize:14,fontWeight:"700"},content:{paddingBottom:30},identity:{alignItems:"center",flexDirection:"row",gap:14,padding:18},avatar:{alignItems:"center",backgroundColor:color.proxyPurpleSoft,borderRadius:38,height:76,justifyContent:"center",overflow:"hidden",width:76},avatarPhoto:{height:"100%",width:"100%"},avatarText:{color:color.violet,fontSize:30,fontWeight:"900"},identityCopy:{flex:1},name:{color:color.ink,fontSize:24,fontWeight:"900"},handle:{color:color.muted,fontSize:13,marginTop:2},bio:{color:color.ink,fontSize:13,marginTop:7},notice:{color:color.error,fontSize:12,paddingHorizontal:18,paddingBottom:8}});
