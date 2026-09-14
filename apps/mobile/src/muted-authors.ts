// muted-authors.ts — MUTE-REVERSIBLE-001「我屏蔽的人」的纯逻辑。
//
// 为什么单独一个模块：feed-prefs 是 RN 组件，渲染测试成本高。把「列表怎么显示、
// 解除之后本地怎么变」抽成纯函数（跟 feed-search.ts 同一个路子），门禁能钉、
// vitest 能直接跑，不需要渲染器。
//
// 注意别和 feed-prefs 里那个 `muted` 集合搞混：那个是**主题**级别的本地偏好
// （「不想看的内容」，只存在本地 store），这里是**作者**级别的关系事实，
// 权威在服务端。两者不是一个东西，不要合并。

import type { MutedAuthorEntry } from "@proxy/contracts";
import { resolveAuthorDisplayName } from "./feed-author";

/**
 * 解除屏蔽成功后，立刻把那一行从本地列表里去掉。
 *
 * 为什么不重新拉一次 ListMutedAuthors：解除已经 ACCEPTED 了，重拉只是把同一个
 * 事实再问一遍；慢网下还会让那一行「先消失又回来」。服务端的 UnmuteAuthor 本身
 * 就是幂等的（重复解除返 NOT_MUTED），本地跟着幂等即可。
 */
export function removeMutedAuthor(
  entries: readonly MutedAuthorEntry[],
  authorId: string
): MutedAuthorEntry[] {
  return entries.filter((entry) => entry.authorId !== authorId);
}

/**
 * 展示名走**唯一**那条身份解析链（feed-author.resolveAuthorDisplayName），
 * 不在这里另起一套：同一个人在帖子、评论、屏蔽列表里必须是同一个称呼。
 * 解析不到（老数据 / 没设过 profile 名）就退化成中性标签 —— 绝不显示 account id，
 * 否则用户只能对着一串账号 id 猜该解除谁。
 */
export function mutedAuthorLabel(
  entry: MutedAuthorEntry,
  viewerAccountId?: string | undefined
): string {
  return resolveAuthorDisplayName(
    { authorId: entry.authorId, authorDisplayName: entry.authorDisplayName },
    viewerAccountId
  );
}
