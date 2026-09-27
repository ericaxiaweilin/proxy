// reply-target.ts — REPLIES tab: 「我回复了谁的帖子」。
//
// R15.87 把这一行降级成了光秃秃的「你回复了」：当时的判断是「server 的 Reply
// 还没有 parentPostId 字段」。这个判断是错的 —— 服务端一直在发 parentPostId
// （就是这条回复挂在哪条帖子下面），只是客户端从来没读它，于是这一栏唯一有用
// 的信息被丢掉了；而且 "你回复了" 是写死的，看别人的主页时也在说 "你"。
//
// 父帖走 PROFILE-SAVED-001 的 ListPostsByIds 回查，好处是可见性口径跟动态流
// 完全一致：已经删掉、或已经收紧成「仅关注者可见」的帖子取不回来，这一栏就
// 退化成中性文案 —— 不猜、不编，也绝不把 account id 当名字显示。
//
// 名字一律经 resolveAuthorDisplayName（feed-author.ts），跟 feed 和评论共用
// 同一个身份判定：同一个人在任何一栏里都得是同一个称呼。

import type { FeedPost } from "@proxy/contracts";
import { resolveAuthorDisplayName } from "./feed-author";

/**
 * 一条回复。React key 用 replyId，不用 parentPostId —— 同一条帖子可以被
 * 同一个人回复很多次（真实数据里就是这样），用父帖 id 当 key 会撞。
 */
export type ReplyEntry = {
  replyId: string;
  parentPostId: string;
  body: string;
  createdAt: string;
};

/** 被回复的那条帖子，只留这一栏用得上的部分。 */
export type ReplyTarget = {
  authorId: string;
  authorType?: string | undefined;
  authorDisplayName?: string | undefined;
  excerpt: string;
};

/** 引用块最多显示多少个字符。 */
export const REPLY_TARGET_EXCERPT_MAX = 90;

/** 服务端 ListUserReplies 里一行 reply 的原始形状。 */
export type RawRepliedPost = {
  replyId?: string | undefined;
  postId?: string | undefined;
  parentPostId?: string | undefined;
  body?: string | undefined;
  createdAt?: string | undefined;
};

/**
 * 把服务端返回的 reply 行转成可渲染的条目。
 *
 * 没有 replyId 的行直接丢掉：没有稳定 key 就只能退化成下标，而同一条帖子被
 * 回复多次时，用下标/父帖 id 都会把两行渲染成同一行。宁可少显示一条，也不要
 * 渲染出错误的内容。
 */
export function replyEntriesFromReplies(raw: readonly RawRepliedPost[]): ReplyEntry[] {
  const out: ReplyEntry[] = [];
  for (const row of raw) {
    const replyId = (row.replyId ?? "").trim();
    if (replyId === "") continue;
    out.push({
      replyId,
      parentPostId: (row.parentPostId ?? "").trim(),
      body: row.body ?? "",
      createdAt: row.createdAt ?? ""
    });
  }
  return out;
}

/** 需要回查的父帖 id：去重、保持服务端顺序、跳过空值。 */
export function parentPostIdsForReplies(replies: readonly ReplyEntry[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const reply of replies) {
    const id = reply.parentPostId.trim();
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * 引用块文案：先压平空白（正文里的换行会把一行撑成一块），再按「字符」截断
 * —— 用 Array.from 而不是 slice，避免把代理对（emoji）切成半个字符。
 */
export function replyTargetExcerpt(body: string, max: number = REPLY_TARGET_EXCERPT_MAX): string {
  const flat = body.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  const limit = Math.max(0, max);
  if (chars.length <= limit) return flat;
  return `${chars.slice(0, limit).join("").trimEnd()}…`;
}

/**
 * 父帖 id -> 引用块数据。取不回来的帖子不进 map，调用方据此退化成中性文案。
 * 同 id 重复出现时保留第一条。
 */
export function replyTargetsFromPosts(posts: readonly FeedPost[]): Record<string, ReplyTarget> {
  const out: Record<string, ReplyTarget> = {};
  for (const post of posts) {
    const id = post.postId.trim();
    if (id === "" || id in out) continue;
    out[id] = {
      authorId: post.authorId,
      authorType: post.authorType,
      authorDisplayName: post.authorDisplayName,
      excerpt: replyTargetExcerpt(post.body)
    };
  }
  return out;
}

/**
 * 这一行的标题，**分段**版（REPLY-TARGET-NAME-INK-001，2026-09-25 用户：
 * 「你看回复xx 这个xx是灰色 但是原型是黑色的」）。
 *
 * 原型那一行是「回复了 Linh 的帖子 · 1.2B」，其中**名字是墨色**、其余是次要色。
 * 整句拼成一个字符串就没法给名字单独上色，所以拆成三段交给调用方分三个
 * <Text> 渲染（RN 的嵌套 Text 可以各自带 color）。
 *
 * 分段规则与 replyTargetLabel 严格同源 —— 后者就是这三段拼起来的，两处不会漂。
 * 别在别处再手工拼一遍这个句式。
 */
export type ReplyTargetParts = {
  /** 「回复了 」/「你回复了 」；没有可指名的父帖时是整句。 */
  prefix: string;
  /** 名字（名字取不到时是中性词，绝不给 id）。取不到父帖时是空串。 */
  name: string;
  /** 「 的帖子」。没有名字段时是空串。 */
  suffix: string;
};

/**
 * 名字取不到时给中性文案，绝不给 id。OWN-NAME-001 起自己的内容显示用户名
 * 不再是「你」—— 当前资料名优先（viewerDisplayName），其次帖子保存的名字；
 * 「你回复了你」这种自指句式不再出现。
 */
export function replyTargetParts(
  viewerMode: "SELF" | "OTHER" | undefined,
  target: ReplyTarget | undefined,
  viewerAccountId?: string | undefined,
  viewerDisplayName?: string | undefined
): ReplyTargetParts {
  const self = viewerMode !== "OTHER";
  if (!target) {
    return { prefix: self ? "你回复了这条帖子" : "回复了这条帖子", name: "", suffix: "" };
  }
  return {
    prefix: self ? "你回复了 " : "回复了 ",
    name: resolveAuthorDisplayName(target, viewerAccountId, viewerDisplayName),
    suffix: " 的帖子"
  };
}

/** 整句版本 = 三段拼起来。任何调用方都不该自己拼这个句式。 */
export function replyTargetLabel(
  viewerMode: "SELF" | "OTHER" | undefined,
  target: ReplyTarget | undefined,
  viewerAccountId?: string | undefined,
  viewerDisplayName?: string | undefined
): string {
  const parts = replyTargetParts(viewerMode, target, viewerAccountId, viewerDisplayName);
  return `${parts.prefix}${parts.name}${parts.suffix}`;
}

/**
 * 回复 tab 空态那句副文案（REPLY-EMPTY-VIEWER-001）。
 *
 * REPLY-TARGET-001 修的是标题里的「你」，同一屏的空态漏了：访客点开别人的主页、
 * 那个人一条回复都没有时，屏幕上写着「**你**在其他帖子下面的回复会出现在这里」
 * —— 跟当初那个 bug 是同一句话、同一个毛病（把别人的东西说成访问者的）。
 */
export function repliesEmptyHint(viewerMode: "SELF" | "OTHER" | undefined): string {
  return viewerMode === "OTHER"
    ? "这个人回复过的帖子会出现在这里"
    : "你在其他帖子下面的回复会出现在这里";
}

/**
 * 时间戳文案。服务端契约里 createdAt 只是个 string，空串/脏值会让
 * `new Date(...).toLocaleDateString()` 渲染出 "Invalid Date" —— 宁可不显示。
 */
export function replyTimestampLabel(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString();
}
