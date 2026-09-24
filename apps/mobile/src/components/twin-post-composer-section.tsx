import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import type { CreatePostPayload, FeedMediaItem, FeedPost } from "@proxy/contracts";
import type { PersonaGalleryItem } from "../ai-persona-client";
import type { FriendView, RelationshipClient } from "../relationship-client";
import { color, foundation } from "../theme";
import { ProxyAvatar, ProxyEmptyState } from "./proxy-foundation";
import { HorizontalSwipeRail } from "./horizontal-swipe-rail";
import { ProxyIcon } from "./proxy-icon";
import { twinAvatarSource } from "./twin-avatar-source";

// AI-TWIN-POST-AUDIENCE-002 — 帖文编排（用户 2026-09-21 原型：deepseek_html_
// 20260921_663482.html「小美 · AI 分身（受众调度版）」帖文区）。
//
// AI-TWIN-POST-AUDIENCE-003（2026-09-22，用户反馈"帖文编辑本质就是一个
// 开关，决定对哪个人展开，你这个都没有"）：原型里帖文编排的核心交互不是
// "写一篇新帖子"，是点开已发布帖子顶部的受众条，把"谁能看到"从公开切成
// 指定好友、或者反过来——一个开关，不是一次性写死在创建那一刻。这版补上
// PostCard 的受众条可点，弹 AudienceEditSheet，真的调
// LocalNetClient.updatePostAudience（服务端 UpdatePostAudience 命令）。
//
// 范围（跟图库同一版的收窄方式，理由一样：不做"点了没反应"或需要另外
// 提示"开发中"的假交互）：
//   * 能做、也做了：
//     - 创建新帖，可选"公开"或"只给指定好友看"（AI-TWIN-POST-AUDIENCE-001）。
//     - 编辑已发布帖子的受众开关（AI-TWIN-POST-AUDIENCE-003）。
//     - 受众选项来自真实好友列表（RelationshipClient.listMyFriendships），
//       不是原型里带假分数的 audienceOptions。
//   * 没做，原型里有但这版跳过：
//     - "AI 重编"/自动生成文案+标签+受众——那需要真的接一个生成模型，
//       现在接了等于伪造"AI 判断"；宁可留白，不编一个看起来像 AI、
//       实际是模板字符串的东西。
//     - 草稿 / 定时发布——服务端 CreatePost 现在只会创建 PUBLISHED 状态
//       的帖子，没有另开草稿存储或调度器。"发布"就是立刻真发布。
//     - 受众开关目前只能在 公开 / 指定好友 之间切——FOLLOWERS/AGENT_ONLY
//       不是这个交互要表达的东西（服务端 UpdatePostAudience 只接受这两档）。
//   * 列表数据是这个人自己真实帖子里的 TARGETED 那一份——受众条读的是
//     服务端在 TARGETED 帖子上真的返回的 audienceTargetIds（只对作者
//     本人下发）。
//
// AI-TWIN-POST-AUDIENCE-004（2026-09-22，用户纠正："帖文编排拿的是公共
// 主页的帖文，没理解对……不能跟主页的帖文重合"）：调用方（me.tsx 的
// aiidentity 分支）已经把 profilePosts 按 visibility 拆成两份不重叠的
// 集合——非 TARGETED 的留在「我的·个人主页」（ProfileTabs），TARGETED
// 的传给这里的 posts prop。这个组件因此天然只管理"私密副空间"的帖子，
// 不会跟主页帖子列表重复渲染同一条帖子；图库（galleryItems）拿的是主页
// 那份公开素材当原始图片/视频来源，两者不是同一个数据源。

type AuthorType = NonNullable<CreatePostPayload["authorType"]>;
type AudienceUpdater = (postId: string, visibility: "PUBLIC" | "TARGETED", audienceTargetIds: string[]) => Promise<void>;

export function TwinPostComposerSection({ posts, mediaByPost, galleryItems, relationshipClient, viewerAccountId, createPost, updatePostAudience, onPublished, resolveMediaUrl }: {
  posts: FeedPost[];
  mediaByPost: Record<string, FeedMediaItem[]>;
  galleryItems: PersonaGalleryItem[];
  relationshipClient: RelationshipClient | undefined;
  viewerAccountId: string | undefined;
  createPost: (payload: CreatePostPayload) => Promise<string>;
  /** AI-TWIN-POST-AUDIENCE-003: 受众开关——已发布帖子的编辑走这条命令，
   * 不是重新发帖。 */
  updatePostAudience: AudienceUpdater;
  onPublished: () => void;
  /** AI-TWIN-GALLERY-004: mediaByPost 是原始 profileMedia，URL 是相对路径，
   * 跟图库一样要经这个函数才能喂给 <Image>（galleryItems 在 me.tsx 已经
   * 解析过了，这里不用再处理）。 */
  resolveMediaUrl: (path: string) => string;
}): React.JSX.Element {
  const [friends, setFriends] = useState<FriendView[]>();
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<FeedPost>();

  useEffect(() => {
    if (!relationshipClient) return;
    let cancelled = false;
    void relationshipClient.listMyFriendships()
      .then((result) => { if (!cancelled) setFriends(result.active); })
      .catch(() => { if (!cancelled) setFriends([]); });
    return () => { cancelled = true; };
  }, [relationshipClient]);

  const friendNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const friend of friends ?? []) map.set(friend.userId, friend.displayName);
    return map;
  }, [friends]);

  const myPosts = useMemo(
    () => [...posts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 20),
    [posts],
  );

  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Text selectable style={styles.title}>帖文编排</Text>
        <Pressable accessibilityLabel="发新帖" onPress={() => setComposerOpen(true)}>
          <Text selectable style={styles.newPostBtn}>＋ 新帖</Text>
        </Pressable>
      </View>
      <Text selectable style={styles.sectionSub}>私密副空间，不在你的主页上——只有你按开关选中的人能看到。</Text>

      {myPosts.length === 0 ? (
        <ProxyEmptyState sub="点右上角「＋ 新帖」，选指定好友后发布" title="这里还没有帖子" />
      ) : (
        <View style={styles.postList}>
          {myPosts.map((post) => (
            <PostCard friendNameById={friendNameById} key={post.postId} media={mediaByPost[post.postId] ?? []} onEditAudience={() => setEditingPost(post)} post={post} resolveMediaUrl={resolveMediaUrl} />
          ))}
        </View>
      )}

      {composerOpen ? (
        <ComposerSheet
          createPost={createPost}
          friends={friends}
          galleryItems={galleryItems}
          onClose={() => setComposerOpen(false)}
          onPublished={() => { setComposerOpen(false); onPublished(); }}
          resolveMediaUrl={resolveMediaUrl}
          viewerAccountId={viewerAccountId}
        />
      ) : null}

      {editingPost ? (
        <AudienceEditSheet
          friends={friends}
          onClose={() => setEditingPost(undefined)}
          onSaved={() => { setEditingPost(undefined); onPublished(); }}
          post={editingPost}
          resolveMediaUrl={resolveMediaUrl}
          updatePostAudience={updatePostAudience}
        />
      ) : null}
    </View>
  );
}

function relativeTimeLabel(iso: string): string {
  const diffMs = Date.now() - Date.parse(iso);
  if (Number.isNaN(diffMs)) return "";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function mediaThumb(item: FeedMediaItem): string | undefined {
  return item.thumbnailUrl ?? item.feedUrl ?? item.galleryUrl ?? item.placeholderUrl;
}

function PostCard({ post, media, friendNameById, resolveMediaUrl, onEditAudience }: { post: FeedPost; media: FeedMediaItem[]; friendNameById: Map<string, string>; resolveMediaUrl: (path: string) => string; onEditAudience: () => void }): React.JSX.Element {
  const isTargeted = post.visibility === "TARGETED";
  const canEdit = post.visibility === "PUBLIC" || isTargeted; // FOLLOWERS/AGENT_ONLY 不走这个开关
  const targets = post.audienceTargetIds ?? [];
  const audienceLabel = isTargeted
    ? targets.length === 0
      ? "受众未知（不是这条帖子的作者视角）"
      : targets.length === 1
        ? `仅对 ${friendNameById.get(targets[0] ?? "") ?? "1 位好友"} 可见`
        : `对 ${targets.length} 位好友可见`
    : post.visibility === "FOLLOWERS"
      ? "仅关注者可见"
      : "公开可见";

  return (
    <View style={styles.postCard}>
      <Pressable
        accessibilityLabel={canEdit ? "设置这条帖子谁能看到" : audienceLabel}
        disabled={!canEdit}
        onPress={onEditAudience}
        style={[styles.audienceBar, isTargeted ? styles.audienceBarTargeted : undefined]}
      >
        <Text selectable style={styles.audienceIcon}>{isTargeted ? "🎯" : "🌐"}</Text>
        <Text selectable style={[styles.audienceText, isTargeted ? styles.audienceTextTargeted : undefined]} numberOfLines={1}>{audienceLabel}</Text>
        {canEdit ? <Text selectable style={styles.audienceChevron}>›</Text> : null}
      </Pressable>
      <View style={styles.postMeta}>
        <Text selectable style={styles.postName} numberOfLines={1}>{post.authorDisplayName || "我"}</Text>
        <Text selectable style={styles.postTime}>{relativeTimeLabel(post.createdAt)}</Text>
      </View>
      {media.length > 0 ? (
        <View style={styles.postImages}>
          {media.slice(0, 3).map((item, i) => {
            const rawUri = mediaThumb(item);
            return rawUri ? <Image contentFit="cover" key={`${post.postId}:${i}`} source={{ uri: resolveMediaUrl(rawUri) }} style={styles.postImage} /> : null;
          })}
        </View>
      ) : null}
      {post.body ? <Text selectable numberOfLines={4} style={styles.postCaption}>{post.body}</Text> : null}
    </View>
  );
}

function ComposerSheet({ galleryItems, friends, viewerAccountId, createPost, onClose, onPublished, resolveMediaUrl }: {
  galleryItems: PersonaGalleryItem[];
  friends: FriendView[] | undefined;
  viewerAccountId: string | undefined;
  createPost: (payload: CreatePostPayload) => Promise<string>;
  onClose: () => void;
  onPublished: () => void;
  resolveMediaUrl: (path: string) => string;
}): React.JSX.Element {
  const [caption, setCaption] = useState("");
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [audienceMode, setAudienceMode] = useState<"public" | "targeted">("public");
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function toggleMedia(id: string): void {
    setSelectedMediaIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 6 ? prev : [...prev, id]);
  }
  function toggleFriend(id: string): void {
    setSelectedFriendIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  const canPublish = (caption.trim().length > 0 || selectedMediaIds.length > 0)
    && (audienceMode === "public" || selectedFriendIds.length > 0);

  async function publish(): Promise<void> {
    if (!canPublish || busy || !viewerAccountId) return;
    setBusy(true);
    setError(undefined);
    try {
      const payload: CreatePostPayload = {
        authorType: "USER" as AuthorType,
        body: caption.trim(),
        mediaRefs: selectedMediaIds.map((mediaAssetId, sortOrder) => ({ mediaAssetId, sortOrder })),
        visibility: audienceMode === "targeted" ? "TARGETED" : "PUBLIC",
        ...(audienceMode === "targeted" ? { audienceTargetIds: selectedFriendIds } : {}),
      };
      await createPost(payload);
      onPublished();
    } catch (err) {
      setError(err instanceof Error ? err.message : "发布失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible>
      <Pressable onPress={onClose} style={styles.sheetBackdrop}>
        <Pressable onPress={(e) => e.stopPropagation()} style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
            <Text selectable style={styles.sheetTitle}>新帖</Text>

            <TextInput
              multiline
              onChangeText={setCaption}
              placeholder="写点什么…"
              placeholderTextColor={color.muted}
              style={styles.captionInput}
              value={caption}
            />

            {galleryItems.length > 0 ? (
              <>
                <Text selectable style={styles.fieldLabel}>选图库照片（最多 6 张）</Text>
                {/* SWIPE-RAIL-001：选图横滑不能触发外层切页。 */}
                <HorizontalSwipeRail preserveChildPresses style={styles.mediaPicker} threshold={3}>
                  {galleryItems.map((item) => {
                    const selected = selectedMediaIds.includes(item.id);
                    return (
                      <Pressable accessibilityLabel="选择这张照片" key={item.id} onPress={() => toggleMedia(item.id)} style={styles.mediaPickerThumb}>
                        <Image contentFit="cover" source={{ uri: item.thumbnailUrl }} style={StyleSheet.absoluteFill} />
                        {selected ? <View style={styles.mediaPickerCheck}><ProxyIcon color={color.white} name="check" size={14} /></View> : null}
                      </Pressable>
                    );
                  })}
                </HorizontalSwipeRail>
              </>
            ) : null}

            <Text selectable style={styles.fieldLabel}>谁能看到</Text>
            <AudiencePicker
              audienceMode={audienceMode}
              friends={friends}
              resolveMediaUrl={resolveMediaUrl}
              selectedFriendIds={selectedFriendIds}
              setAudienceMode={setAudienceMode}
              toggleFriend={toggleFriend}
            />

            {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}

            <View style={styles.sheetFooter}>
              <Pressable onPress={onClose} style={styles.sheetCancelBtn}>
                <Text selectable style={styles.sheetCancelText}>取消</Text>
              </Pressable>
              <Pressable
                disabled={!canPublish || busy}
                onPress={() => void publish()}
                style={[styles.sheetPublishBtn, (!canPublish || busy) && styles.sheetPublishBtnDisabled]}
              >
                <Text selectable style={styles.sheetPublishText}>{busy ? "发布中…" : "发布"}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// AI-TWIN-POST-AUDIENCE-003: 公开/指定好友 开关 + 好友多选，发帖和编辑
// 已发布帖子共用同一套 UI——两处除了"提交时调哪个命令"以外，交互一样。
function AudiencePicker({ audienceMode, setAudienceMode, friends, resolveMediaUrl, selectedFriendIds, toggleFriend }: {
  audienceMode: "public" | "targeted";
  setAudienceMode: (mode: "public" | "targeted") => void;
  friends: FriendView[] | undefined;
  resolveMediaUrl: (path: string) => string;
  selectedFriendIds: string[];
  toggleFriend: (id: string) => void;
}): React.JSX.Element {
  return (
    <>
      <View style={styles.audienceSwitch}>
        <Pressable
          onPress={() => setAudienceMode("public")}
          style={[styles.audienceSwitchBtn, audienceMode === "public" && styles.audienceSwitchBtnActive]}
        >
          <Text selectable style={[styles.audienceSwitchText, audienceMode === "public" && styles.audienceSwitchTextActive]}>🌐 公开</Text>
        </Pressable>
        <Pressable
          onPress={() => setAudienceMode("targeted")}
          style={[styles.audienceSwitchBtn, audienceMode === "targeted" && styles.audienceSwitchBtnActive]}
        >
          <Text selectable style={[styles.audienceSwitchText, audienceMode === "targeted" && styles.audienceSwitchTextActive]}>🎯 指定好友</Text>
        </Pressable>
      </View>

      {audienceMode === "targeted" ? (
        friends === undefined ? (
          <ActivityIndicator color={color.muted} style={{ marginVertical: 12 }} />
        ) : friends.length === 0 ? (
          <Text selectable style={styles.friendsEmpty}>还没有好友，先去加几个好友才能指定受众。</Text>
        ) : (
          <View style={styles.friendList}>
            {friends.map((friend) => {
              const selected = selectedFriendIds.includes(friend.userId);
              const avatarSource = twinAvatarSource(friend.avatarUrl, resolveMediaUrl);
              return (
                <Pressable
                  accessibilityLabel={`选择${friend.displayName}`}
                  key={friend.userId}
                  onPress={() => toggleFriend(friend.userId)}
                  style={[styles.friendRow, selected && styles.friendRowSelected]}
                >
                  <View style={styles.friendIdentity}>
                    <ProxyAvatar
                      accessibilityLabel={`${friend.displayName}头像`}
                      fallback={friend.displayName}
                      size={32}
                      {...(avatarSource ? { source: avatarSource } : {})}
                    />
                    <Text selectable numberOfLines={1} style={styles.friendName}>{friend.displayName}</Text>
                  </View>
                  <View style={[styles.friendCheck, selected && styles.friendCheckOn]}>
                    {selected ? <ProxyIcon color={color.white} name="check" size={12} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )
      ) : null}
    </>
  );
}

// AI-TWIN-POST-AUDIENCE-003: 已发布帖子受众条的编辑面板——原型说的
// "本质就是一个开关"。跟 ComposerSheet 的区别只有两条：初始值来自
// post 现在的受众，提交时调 updatePostAudience 而不是 createPost。
function AudienceEditSheet({ post, friends, updatePostAudience, onClose, onSaved, resolveMediaUrl }: {
  post: FeedPost;
  friends: FriendView[] | undefined;
  updatePostAudience: AudienceUpdater;
  onClose: () => void;
  onSaved: () => void;
  resolveMediaUrl: (path: string) => string;
}): React.JSX.Element {
  const [audienceMode, setAudienceMode] = useState<"public" | "targeted">(post.visibility === "TARGETED" ? "targeted" : "public");
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>(post.audienceTargetIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function toggleFriend(id: string): void {
    setSelectedFriendIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  const changed = audienceMode !== (post.visibility === "TARGETED" ? "targeted" : "public")
    || (audienceMode === "targeted" && JSON.stringify([...selectedFriendIds].sort()) !== JSON.stringify([...(post.audienceTargetIds ?? [])].sort()));
  const canSave = changed && (audienceMode === "public" || selectedFriendIds.length > 0);

  async function save(): Promise<void> {
    if (!canSave || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await updatePostAudience(post.postId, audienceMode === "targeted" ? "TARGETED" : "PUBLIC", audienceMode === "targeted" ? selectedFriendIds : []);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "受众没改成，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible>
      <Pressable onPress={onClose} style={styles.sheetBackdrop}>
        <Pressable onPress={(e) => e.stopPropagation()} style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
            <Text selectable style={styles.sheetTitle}>谁能看到这条帖子</Text>
            <Text selectable style={styles.sheetSub}>AI 分身按这个开关决定这条帖子出现在谁的信息流里——看不到的人，就不会出现在他们的信息流里。</Text>

            <AudiencePicker
              audienceMode={audienceMode}
              friends={friends}
              resolveMediaUrl={resolveMediaUrl}
              selectedFriendIds={selectedFriendIds}
              setAudienceMode={setAudienceMode}
              toggleFriend={toggleFriend}
            />

            {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}

            <View style={styles.sheetFooter}>
              <Pressable onPress={onClose} style={styles.sheetCancelBtn}>
                <Text selectable style={styles.sheetCancelText}>取消</Text>
              </Pressable>
              <Pressable
                disabled={!canSave || busy}
                onPress={() => void save()}
                style={[styles.sheetPublishBtn, (!canSave || busy) && styles.sheetPublishBtnDisabled]}
              >
                <Text selectable style={styles.sheetPublishText}>{busy ? "保存中…" : "保存"}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: foundation.space.four },
  head: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: foundation.space.two },
  title: { color: foundation.ink, fontSize: 18, fontWeight: "800" },
  sectionSub: { color: color.muted, fontSize: 12, lineHeight: 17, marginBottom: foundation.space.three },
  newPostBtn: { color: color.violet, fontSize: 12, fontWeight: "800" },

  postList: { gap: 10 },
  postCard: { backgroundColor: color.white, borderColor: color.cardBorder, borderRadius: 14, borderWidth: 1, overflow: "hidden" },

  audienceBar: { alignItems: "center", backgroundColor: color.chipNeutralBg, flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  audienceBarTargeted: { backgroundColor: color.violetSoftBg },
  audienceIcon: { fontSize: 12 },
  audienceText: { color: color.chipNeutralText, flex: 1, fontSize: 11, fontWeight: "700" },
  audienceTextTargeted: { color: color.violet },
  audienceChevron: { color: color.muted, fontSize: 16 },

  postMeta: { alignItems: "center", flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingTop: 8 },
  postName: { color: foundation.ink, flex: 1, fontSize: 12, fontWeight: "800" },
  postTime: { color: color.muted, fontSize: 11 },

  postImages: { flexDirection: "row", gap: 2, marginTop: 8, paddingHorizontal: 2 },
  postImage: { aspectRatio: 1, backgroundColor: color.chipNeutralBg, flex: 1 },

  postCaption: { color: foundation.ink, fontSize: 12, lineHeight: 17, padding: 12 },

  errorText: { color: "#b91c1c", fontSize: 12, paddingVertical: 8 },

  sheetBackdrop: { backgroundColor: "rgba(0,0,0,0.4)", flex: 1, justifyContent: "flex-end" },
  sheet: { backgroundColor: color.white, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: "86%" },
  sheetHandle: { alignSelf: "center", backgroundColor: color.cardBorder, borderRadius: 2, height: 4, marginTop: 10, width: 36 },
  sheetContent: { padding: 20, paddingBottom: 32 },
  sheetTitle: { color: foundation.ink, fontSize: 16, fontWeight: "800", marginBottom: 4 },
  sheetSub: { color: color.muted, fontSize: 12, lineHeight: 17, marginBottom: 14 },

  captionInput: { backgroundColor: color.chipNeutralBg, borderRadius: 12, color: foundation.ink, fontSize: 14, minHeight: 72, padding: 12, textAlignVertical: "top" },

  fieldLabel: { color: color.muted, fontSize: 11, fontWeight: "800", marginBottom: 8, marginTop: 16 },

  mediaPicker: { gap: 6 },
  mediaPickerThumb: { backgroundColor: color.chipNeutralBg, borderRadius: 8, height: 72, marginRight: 6, overflow: "hidden", width: 72 },
  mediaPickerCheck: { alignItems: "center", backgroundColor: "rgba(133,51,245,0.85)", borderRadius: 999, height: 20, justifyContent: "center", position: "absolute", right: 4, top: 4, width: 20 },

  audienceSwitch: { backgroundColor: color.chipNeutralBg, borderRadius: 12, flexDirection: "row", gap: 4, padding: 3 },
  audienceSwitchBtn: { alignItems: "center", borderRadius: 9, flex: 1, paddingVertical: 9 },
  audienceSwitchBtnActive: { backgroundColor: color.white },
  audienceSwitchText: { color: color.muted, fontSize: 12, fontWeight: "700" },
  audienceSwitchTextActive: { color: foundation.ink },

  friendsEmpty: { color: color.muted, fontSize: 12, paddingVertical: 12 },
  friendList: { gap: 6, marginTop: 8 },
  friendRow: { alignItems: "center", borderColor: color.cardBorder, borderRadius: 10, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8 },
  friendRowSelected: { backgroundColor: color.violetSoftBg, borderColor: color.violet },
  friendIdentity: { alignItems: "center", flex: 1, flexDirection: "row", gap: 10, minWidth: 0 },
  friendName: { color: foundation.ink, flexShrink: 1, fontSize: 13, fontWeight: "700" },
  friendCheck: { alignItems: "center", borderColor: color.cardBorder, borderRadius: 999, borderWidth: 1.5, height: 20, justifyContent: "center", width: 20 },
  friendCheckOn: { backgroundColor: color.violet, borderColor: color.violet },

  sheetFooter: { flexDirection: "row", gap: 10, marginTop: 20 },
  sheetCancelBtn: { alignItems: "center", backgroundColor: color.chipNeutralBg, borderRadius: 12, flex: 1, paddingVertical: 13 },
  sheetCancelText: { color: foundation.ink, fontSize: 13, fontWeight: "700" },
  sheetPublishBtn: { alignItems: "center", backgroundColor: color.violet, borderRadius: 12, flex: 1, paddingVertical: 13 },
  sheetPublishBtnDisabled: { opacity: 0.4 },
  sheetPublishText: { color: color.white, fontSize: 13, fontWeight: "800" },
});
