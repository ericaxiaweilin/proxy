import { z } from "zod";

export const PostEngagementSchema = z.object({
  postId: z.string().min(1), followed: z.boolean(),
  reactions: z.number().int().min(0), replies: z.number().int().min(0),
  reposts: z.number().int().min(0), bookmarked: z.boolean(), reacted: z.boolean()
});
export type PostEngagement = z.infer<typeof PostEngagementSchema>;

// FEED-REPLY-001: actorDisplayName 是服务端按 profile 解析出的评论作者展示名，
// 可能缺失（老评论 / 无 profile）。缺失时客户端必须退化成中性标签，
// 绝不能把 actorId 当名字显示——显示名与权威身份是两件事。
// REPLY-IMAGE-001: 评论图片——形状与帖文 PostMediaRef 同构（mediaAssetId +
// sortOrder），上限同样 6 张。读模型只带引用，展示 URL 由客户端经
// localNet.resolveMediaUrl 解析（engagement 不注入媒体查询，跟帖文 hydrate 解耦）。
// 内联定义而不是 import index 的 PostMediaRefSchema —— index 会 export * 本文件，
// 反向 import 造成循环依赖。
export const ReplyMediaRefSchema = z.object({
  mediaAssetId: z.string().min(1),
  sortOrder: z.number().int().nonnegative()
});
export type ReplyMediaRef = z.infer<typeof ReplyMediaRefSchema>;
export const PostReplySchema = z.object({
  replyId: z.string().min(1), postId: z.string().min(1), actorId: z.string().min(1),
  body: z.string(), createdAt: z.string(),
  actorDisplayName: z.string().optional(),
  media: z.array(ReplyMediaRefSchema).max(6).default([])
});
export type PostReply = z.infer<typeof PostReplySchema>;
export const PostRepliesListSchema = z.object({
  postId: z.string().min(1), replies: z.array(PostReplySchema), count: z.number().int().min(0)
});
export type PostRepliesList = z.infer<typeof PostRepliesListSchema>;

// ANALYTICS-ME-001: 自己帖子收到的互动合计（窗口内别人给的赞 + 评论）。
// 自赞/自评不计入；服务端按作者归属聚合，客户端不做 N+1 逐条加总。
export const ReceivedEngagementStatsSchema = z.object({
  reactions: z.number().int().min(0),
  replies: z.number().int().min(0),
});
export type ReceivedEngagementStats = z.infer<typeof ReceivedEngagementStatsSchema>;

// ---------- R15.45 PostMenu / Report / MuteAuthor ----------

// PostReportReason — 举报原因枚举 (mobile menu 4 选项)
export const PostReportReasonSchema = z.enum([
  "SPAM",
  "HARASSMENT",
  "MISINFORMATION",
  "OTHER"
]);
export type PostReportReason = z.infer<typeof PostReportReasonSchema>;

// MutedAuthor — 屏蔽作者 aggregate
export const MutedAuthorSchema = z.object({
  muteId: z.string().min(1),
  actorId: z.string().min(1),
  authorId: z.string().min(1),
  createdAt: z.string()
});
export type MutedAuthor = z.infer<typeof MutedAuthorSchema>;

// MUTE-REVERSIBLE-001 — 「我屏蔽的人」列表的一行。
//
// authorDisplayName 跟评论（PostReply.actorDisplayName）一样是**读时**由服务端
// 用同一个 profile 解析器填的，不落库、不接受客户端提供。为什么这条列表非得
// 服务端给名字：屏蔽列表恰恰是「帖子全被 feed 过滤掉」的一群人，客户端没法像
// feed 那样从帖子读模型里借名字，它手里只有一个 authorId。缺失时客户端必须
// 退化成中性标签，绝不能把 authorId 当名字显示 —— 否则用户只能对着一串账号 id
// 猜该解除谁，这个「解除屏蔽」入口等于没做。
export const MutedAuthorEntrySchema = z.object({
  muteId: z.string().min(1),
  authorId: z.string().min(1),
  createdAt: z.string(),
  authorDisplayName: z.string().optional()
});
export type MutedAuthorEntry = z.infer<typeof MutedAuthorEntrySchema>;

// MutedAuthorsList — ListMutedAuthors 返 { actorId, mutedAuthors[], count }
export const MutedAuthorsListSchema = z.object({
  actorId: z.string().min(1),
  mutedAuthors: z.array(MutedAuthorEntrySchema),
  count: z.number().int().min(0)
});
export type MutedAuthorsList = z.infer<typeof MutedAuthorsListSchema>;

// ListMutedAuthorsPayload — limit 可选（服务端默认 50、上限 100）
export const ListMutedAuthorsPayloadSchema = z.object({
  limit: z.number().int().positive().optional()
});
export type ListMutedAuthorsPayload = z.infer<typeof ListMutedAuthorsPayloadSchema>;

export function parseMutedAuthorsList(raw: unknown): MutedAuthorsList {
  return MutedAuthorsListSchema.parse(raw);
}
export function parseListMutedAuthorsPayload(raw: unknown): ListMutedAuthorsPayload {
  return ListMutedAuthorsPayloadSchema.parse(raw);
}

// ---------- R15.54 follow graph ----------

// FollowCounts — GetFollowCounts 返 { userId, followers, following }
export const FollowCountsSchema = z.object({
  userId: z.string().min(1),
  followers: z.number().int().min(0),
  following: z.number().int().min(0)
});
export type FollowCounts = z.infer<typeof FollowCountsSchema>;

// FollowingState — IsFollowing 返 { isFollowing: bool }
export const FollowingStateSchema = z.object({
  isFollowing: z.boolean()
});
export type FollowingState = z.infer<typeof FollowingStateSchema>;

// UnfollowProfilePayload
export const UnfollowProfilePayloadSchema = z.object({
  followeeId: z.string().min(1)
});
export type UnfollowProfilePayload = z.infer<typeof UnfollowProfilePayloadSchema>;

// GetFollowCountsPayload
export const GetFollowCountsPayloadSchema = z.object({
  userId: z.string().min(1)
});
export type GetFollowCountsPayload = z.infer<typeof GetFollowCountsPayloadSchema>;

// IsFollowingPayload (anonymous OK, followerId 可空)
export const IsFollowingPayloadSchema = z.object({
  followerId: z.string(),
  followeeId: z.string().min(1)
});
export type IsFollowingPayload = z.infer<typeof IsFollowingPayloadSchema>;

export function parseUnfollowProfilePayload(raw: unknown): UnfollowProfilePayload {
  return UnfollowProfilePayloadSchema.parse(raw);
}
export function parseGetFollowCountsPayload(raw: unknown): GetFollowCountsPayload {
  return GetFollowCountsPayloadSchema.parse(raw);
}
export function parseIsFollowingPayload(raw: unknown): IsFollowingPayload {
  return IsFollowingPayloadSchema.parse(raw);
}
export function parseFollowCounts(raw: unknown): FollowCounts {
  return FollowCountsSchema.parse(raw);
}
export function parseFollowingState(raw: unknown): FollowingState {
  return FollowingStateSchema.parse(raw);
}

// ---------- R15.56 Post pin (置顶) ----------

// PostPin — 置顶 aggregate
export const PostPinSchema = z.object({
  pinId: z.string().min(1),
  ownerId: z.string().min(1),
  postId: z.string().min(1),
  createdAt: z.string()
});
export type PostPin = z.infer<typeof PostPinSchema>;

// PinnedPostsList — ListPinnedPosts 返 { ownerId, postIds, count }
export const PinnedPostsListSchema = z.object({
  ownerId: z.string().min(1),
  postIds: z.array(z.string()),
  count: z.number().int().min(0)
});
export type PinnedPostsList = z.infer<typeof PinnedPostsListSchema>;

// PinPostPayload / UnpinPostPayload
export const PinPostPayloadSchema = z.object({
  postId: z.string().min(1)
});
export type PinPostPayload = z.infer<typeof PinPostPayloadSchema>;
export const UnpinPostPayloadSchema = z.object({
  postId: z.string().min(1)
});
export type UnpinPostPayload = z.infer<typeof UnpinPostPayloadSchema>;

// ListPinnedPostsPayload
export const ListPinnedPostsPayloadSchema = z.object({
  ownerId: z.string().min(1)
});
export type ListPinnedPostsPayload = z.infer<typeof ListPinnedPostsPayloadSchema>;

export function parsePinPostPayload(raw: unknown): PinPostPayload {
  return PinPostPayloadSchema.parse(raw);
}
export function parseUnpinPostPayload(raw: unknown): UnpinPostPayload {
  return UnpinPostPayloadSchema.parse(raw);
}
export function parseListPinnedPostsPayload(raw: unknown): ListPinnedPostsPayload {
  return ListPinnedPostsPayloadSchema.parse(raw);
}
export function parsePinnedPostsList(raw: unknown): PinnedPostsList {
  return PinnedPostsListSchema.parse(raw);
}

// ---------- R15.61 ListUserReplies ----------

// RepliedPost (单条 reply summary, 包含父 post)
export const RepliedPostSchema = z.object({
  replyId: z.string().min(1),
  postId: z.string().min(1),
  parentPostId: z.string().min(1),
  body: z.string(),
  createdAt: z.string()
});
export type RepliedPost = z.infer<typeof RepliedPostSchema>;

export const UserRepliesListSchema = z.object({
  userId: z.string().min(1),
  replies: z.array(RepliedPostSchema),
  count: z.number().int().min(0)
});
export type UserRepliesList = z.infer<typeof UserRepliesListSchema>;

export const ListUserRepliesPayloadSchema = z.object({
  userId: z.string().min(1),
  limit: z.number().int().positive().optional()
});
export type ListUserRepliesPayload = z.infer<typeof ListUserRepliesPayloadSchema>;

export function parseListUserRepliesPayload(raw: unknown): ListUserRepliesPayload {
  return ListUserRepliesPayloadSchema.parse(raw);
}
export function parseUserRepliesList(raw: unknown): UserRepliesList {
  return UserRepliesListSchema.parse(raw);
}

// ---------- R15.62 ListUserBookmarks ----------

export const UserBookmarksListSchema = z.object({
  userId: z.string().min(1),
  bookmarks: z.array(z.string()),
  count: z.number().int().min(0)
});
export type UserBookmarksList = z.infer<typeof UserBookmarksListSchema>;

export const ListUserBookmarksPayloadSchema = z.object({
  userId: z.string().min(1),
  limit: z.number().int().positive().optional()
});
export type ListUserBookmarksPayload = z.infer<typeof ListUserBookmarksPayloadSchema>;

export function parseListUserBookmarksPayload(raw: unknown): ListUserBookmarksPayload {
  return ListUserBookmarksPayloadSchema.parse(raw);
}
export function parseUserBookmarksList(raw: unknown): UserBookmarksList {
  return UserBookmarksListSchema.parse(raw);
}
