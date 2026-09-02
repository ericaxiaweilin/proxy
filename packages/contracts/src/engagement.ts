import { z } from "zod";

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
