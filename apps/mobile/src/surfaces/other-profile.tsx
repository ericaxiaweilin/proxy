import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { FeedMediaItem, FeedPost } from "@proxy/contracts";
import type { EngagementClient } from "../engagement-client";
import type { LocalNetClient } from "../localnet-client";
import type { SecureSessionStore } from "../secure-session";
import { color } from "../theme";
import { ProfileTabs, type ProfileMediaEntry } from "./ProfileTabs";

const OTTER_LOGO = require("../../assets/otter-logo.png");

export type OtherProfileTarget = {
  userId: string;
  name: string;
  city?: string | undefined;
  posts: FeedPost[];
  mediaByPost: Record<string, FeedMediaItem[]>;
};

export function OtherProfileSurface({ target, engagement, localNet, secureSessionStore, onBack, onMessage }: {
  target: OtherProfileTarget;
  engagement: EngagementClient;
  localNet: LocalNetClient;
  secureSessionStore?: SecureSessionStore | undefined;
  onBack: () => void;
  onMessage: (name: string) => void;
}): React.JSX.Element {
  const [counts, setCounts] = useState({ followers: 0, following: 0 });
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [resolvedPosts, setResolvedPosts] = useState<FeedPost[]>(target.posts);
  const [resolvedMedia, setResolvedMedia] = useState<Record<string, FeedMediaItem[]>>(target.mediaByPost);
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

  async function toggleFollow(): Promise<void> {
    if (busy) return;
    setBusy(true); setNotice(undefined);
    try {
      if (following) await engagement.unfollowProfile(target.userId); else await engagement.followProfile(target.userId);
      setFollowing(!following);
      setCounts((current) => ({ ...current, followers: Math.max(0, current.followers + (following ? -1 : 1)) }));
    } catch {
      setNotice("访客不能关注，请先登录");
    } finally { setBusy(false); }
  }

  return <View style={styles.root}>
    <View style={styles.header}><Pressable onPress={onBack} style={styles.back}><Text style={styles.backText}>‹ 返回</Text></Pressable><Text style={styles.headerTitle}>{target.name}</Text><View style={styles.headerSpacer} /></View>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.identity}><View style={styles.avatar}><Text style={styles.avatarText}>{target.name.charAt(0).toUpperCase()}</Text></View><View style={styles.identityCopy}><Text style={styles.name}>{target.name}</Text><Text style={styles.handle}>@{target.userId}</Text><Text style={styles.bio}>{target.city ?? "公开主页"}</Text></View></View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <ProfileTabs profileDraft={{ name: target.name, handle: target.userId, bio: "", city: target.city ?? "" }} posts={resolvedPosts} mediaByPost={resolvedMedia} photos={photos} replyPosts={[]} savedPosts={[]} taggedPosts={[]} stats={{ posts: resolvedPosts.length, followers: counts.followers, following: counts.following }} onOpenMedia={() => undefined} resolveMediaUrl={(path) => localNet.resolveMediaUrl(path)} fallbackLogo={OTTER_LOGO} color={color} viewerMode="OTHER" isFollowing={following} followBusy={busy} onFollow={toggleFollow} onUnfollow={toggleFollow} onSendMessage={() => onMessage(target.name)} />
    </ScrollView>
  </View>;
}

const styles=StyleSheet.create({root:{backgroundColor:color.offWhite,flex:1},header:{alignItems:"center",borderBottomColor:color.line,borderBottomWidth:1,flexDirection:"row",height:50,paddingHorizontal:16},back:{flex:1},backText:{color:color.magenta,fontSize:15,fontWeight:"800"},headerTitle:{color:color.ink,fontSize:17,fontWeight:"900"},headerSpacer:{flex:1},content:{paddingBottom:30},identity:{alignItems:"center",flexDirection:"row",gap:14,padding:18},avatar:{alignItems:"center",backgroundColor:color.proxyPurpleSoft,borderRadius:38,height:76,justifyContent:"center",width:76},avatarText:{color:color.violet,fontSize:30,fontWeight:"900"},identityCopy:{flex:1},name:{color:color.ink,fontSize:24,fontWeight:"900"},handle:{color:color.muted,fontSize:13,marginTop:2},bio:{color:color.ink,fontSize:13,marginTop:7},notice:{color:color.error,fontSize:12,paddingHorizontal:18,paddingBottom:8}});
