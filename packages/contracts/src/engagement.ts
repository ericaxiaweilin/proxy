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
export const PostReplySchema = z.object({
  replyId: z.string().min(1), postId: z.string().min(1), actorId: z.string().min(1),
  body: z.string(), createdAt: z.string(),
  actorDisplayName: z.string().optional()
});
export type PostReply = z.infer<typeof PostReplySchema>;
export const PostRepliesListSchema = z.object({
  postId: z.string().min(1), replies: z.array(PostReplySchema), count: z.number().int().min(0)
});
export type PostRepliesList = z.infer<typeof PostRepliesListSchema>;

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
