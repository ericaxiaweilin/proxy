// SEARCH-CORPUS-001：feed 搜索的字段语义 —— TS 侧唯一实现。
//
// 为什么要有这个模块：搜索框的 placeholder 是「搜索人、机会、活动、情报…」，
// 但搜索此前只在**已加载的那几页**里做本地过滤，server 端 R15.94 建好的
// search 通道根本没有 caller（listFeedPosts 的 searchQuery 参数全仓无人传）。
// 于是「搜人」只能搜到你恰好滚过的那几条。
//
// 修法是两端都按同一份字段语义过滤，所以这里必须与 Go 侧的
// postMatchesSearch（apps/api-go/internal/localnet/service.go）逐字对应。
// 两边一旦漂移，客户端 filter 只会把 server 已经认可的帖子再丢掉一遍，
// 表现为「服务端明明匹配了，列表里却没有」—— 这正是修之前的状态
// （server 只匹配 body，客户端却 OR 了 authorDisplayName）。
//
// 匹配「用户看得见的东西」：正文、作者展示名、城市。
//
// 刻意**不含** contextRefs：它是 server 端 classifyPostFallback 从正文派生的
// （见 createPost），让搜索命中派生标签会返回用户根本没写过的词，
// 那是噪音而不是功能。
import type { FeedPost } from "@proxy/contracts";

/** 搜索只读这三个字段 —— 结构上兼容 FeedPost，测试里也能直接喂字面量。 */
export type SearchablePost = {
  body: string;
  authorDisplayName?: string | undefined;
  cityScope?: string | undefined;
};

/**
 * 归一查询串：trim + 小写。空串表示「不搜索」（此时不过滤任何帖子）。
 *
 * 用 toLowerCase 而不是 toLocaleLowerCase：Go 侧是 strings.ToLower，
 * 它是 locale 无关的默认大小写折叠，toLowerCase 才是它的对应物。
 */
export function normalizeFeedSearchQuery(raw: string | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/** 该帖是否命中查询。空查询恒 true —— 不搜索即不过滤。 */
export function postMatchesFeedSearch(post: SearchablePost, normalizedQuery: string): boolean {
  if (normalizedQuery === "") {
    return true;
  }
  if (post.body.toLowerCase().includes(normalizedQuery)) {
    return true;
  }
  const name = post.authorDisplayName;
  if (name && name.toLowerCase().includes(normalizedQuery)) {
    return true;
  }
  const city = post.cityScope;
  if (city && city.toLowerCase().includes(normalizedQuery)) {
    return true;
  }
  return false;
}

/** 按查询过滤一组帖子。空查询返回原顺序的浅拷贝。 */
export function filterPostsByFeedSearch<T extends SearchablePost>(
  posts: readonly T[],
  raw: string | undefined
): T[] {
  const query = normalizeFeedSearchQuery(raw);
  if (query === "") {
    return [...posts];
  }
  return posts.filter((post) => postMatchesFeedSearch(post, query));
}

/** FeedPost 是 SearchablePost 的超集；这里只做类型层面的确认，无运行时开销。 */
export type FeedPostIsSearchable = FeedPost extends SearchablePost ? true : never;
