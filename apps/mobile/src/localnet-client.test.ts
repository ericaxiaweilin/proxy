import { describe, expect, it } from "vitest";
import { LocalNetClient } from "./localnet-client";
import { InMemorySecureStorageDriver, SecureSessionStore } from "./secure-session";

async function authenticatedStore(userId: string): Promise<SecureSessionStore> {
  const store = new SecureSessionStore(new InMemorySecureStorageDriver());
  await store.write({
    userAccountId: userId,
    principal: { type: "INDIVIDUAL", id: userId },
    auth: {
      sessionId: `session_${userId}`,
      userAccountId: userId,
      principal: { type: "INDIVIDUAL", id: userId },
      accessToken: "access",
      refreshToken: "refresh",
      accessExpiresAt: "2026-09-04T00:00:00.000Z",
      refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(),
      rotation: 1
    }
  });
  return store;
}

describe("LocalNetClient post publishing", () => {
  it("reads the anonymous feed through the cacheable GET projection", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    const requests: string[] = [];
    const client = new LocalNetClient({
      baseUrl: "https://api.proxy.test",
      secureSessionStore: store,
      authClient: {
        request: async () => { throw new Error("command fallback must not run"); },
        requestPublic: async (path, init) => {
          requests.push(`${init.method} ${path}`);
          return {
            status: 200,
            json: async () => ({ posts: [], media: {}, nextCursor: "next_page", hasMore: true })
          };
        }
      }
    });
    const page = await client.listFeedPosts("opaque cursor", 20);
    expect(requests).toEqual(["GET /v1/feed?limit=20&cursor=opaque%20cursor"]);
    expect(page).toMatchObject({ nextCursor: "next_page", hasMore: true });
  });

  it("reuses the caller's stable idempotency key for a publish retry", async () => {
    const store = new SecureSessionStore(new InMemorySecureStorageDriver(), () => new Date("2026-08-24T00:00:00.000Z"));
    await store.write({
      userAccountId: "user_001",
      principal: { type: "INDIVIDUAL", id: "user_001" },
      auth: {
        sessionId: "session_001",
        userAccountId: "user_001",
        principal: { type: "INDIVIDUAL", id: "user_001" },
        accessToken: "access",
        refreshToken: "refresh",
        accessExpiresAt: "2026-08-24T01:00:00.000Z",
        refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(),
        rotation: 1
      }
    });
    const envelopes: Array<Record<string, unknown>> = [];
    const client = new LocalNetClient({
      baseUrl: "https://api.proxy.test",
      secureSessionStore: store,
      authClient: {
        request: async (_path, init) => {
          envelopes.push(init.body as Record<string, unknown>);
          return {
            status: 200,
            json: async () => ({
              commandId: "command_001",
              outcome: "ACCEPTED",
              aggregate: { type: "Post", id: "post_001", version: 1, state: "PUBLISHED" },
              eventRefs: [],
              correlationId: "correlation_001"
            })
          };
        }
      }
    });
    const payload = { body: "同一草稿", mediaRefs: [{ mediaAssetId: "media_001", sortOrder: 0, altText: "全身照" }] };
    await client.createPost(payload, "publish_draft_001");
    await client.createPost(payload, "publish_draft_001");
    expect(envelopes.map((envelope) => envelope.idempotencyKey)).toEqual(["publish_draft_001", "publish_draft_001"]);
  });
});

// R16.6: 守卫 listMyFeedPosts — 不准单页 0 匹配返空。
// 场景：server 第一页全返别人的帖（agent_linh integration seeds 或更晚
// 发的其他 user），commander 自己发的帖在第二页才出现。客户端必须分页
// 找到自己帖为止，不能 first-page-empty 返 0。
// 我的主页的帖子：服务端按作者取，不再把全局动态翻几页再在客户端挑。
// 原来的做法（翻最多 10 页 × 50 条）在库里有上千条别人的帖子时必空白 —— 本机实测：
// 比我最新一条还新的帖子有 1812 条，我的 23 条根本进不了前 500 条。
describe("LocalNetClient listMyFeedPosts asks the server for my own posts (profile P0)", () => {
  async function mine(userId: string, posts: unknown[], extra: Record<string, unknown> = {}) {
    const store = await authenticatedStore(userId);
    const envelopes: Array<Record<string, unknown>> = [];
    const publicCalls: string[] = [];
    const client = new LocalNetClient({
      baseUrl: "https://api.proxy.test",
      secureSessionStore: store,
      authClient: {
        request: async (_path, init) => {
          envelopes.push(init.body as Record<string, unknown>);
          return {
            status: 200,
            json: async () => ({
              commandId: "command_mine_001", outcome: "ACCEPTED", aggregate: { type: "Feed", id: "", version: 0, state: "LISTED" }, eventRefs: [],
              correlationId: "correlation_mine_001",
              operationRef: JSON.stringify({ posts, media: {}, nextCursor: "", hasMore: false, ...extra })
            })
          };
        },
        requestPublic: async (path) => { publicCalls.push(path); throw new Error("my posts must never be scraped from the public feed"); }
      }
    });
    return { client, envelopes, publicCalls };
  }
  const post = (id: string, author: string) => ({ postId: id, authorId: author, authorType: "USER", body: id, mediaRefs: [], visibility: "PUBLIC", cityScope: "hanoi", status: "PUBLISHED", contextRefs: [], createdAt: "2026-08-25T00:00:00Z", sceneType: "UNKNOWN" });

  it("sends ONE authenticated request filtered to my account id, never walks the global feed", async () => {
    const { client, envelopes, publicCalls } = await mine("user_viewer_a", [post("post_mine_1", "user_viewer_a"), post("post_mine_2", "user_viewer_a")]);
    const read = await client.listMyFeedPosts();
    expect(read.posts.map((p) => p.postId)).toEqual(["post_mine_1", "post_mine_2"]);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]!.commandType).toBe("ListFeedPosts");
    expect(envelopes[0]!.payload).toMatchObject({ authorIds: ["user_viewer_a"], limit: 50 });
    expect(publicCalls).toEqual([]);
  });

  it("an empty answer is a real answer (no posts yet), and a cursor is passed through for the next page", async () => {
    const { client, envelopes } = await mine("user_viewer_b", [], { nextCursor: "", hasMore: false });
    expect((await client.listMyFeedPosts()).posts).toEqual([]);
    await client.listMyFeedPosts("cursor_2");
    expect(envelopes[1]!.payload).toMatchObject({ cursor: "cursor_2", authorIds: ["user_viewer_b"] });
  });

  it("other people's profiles use the public feed with the author filter, one request", async () => {
    const store = await authenticatedStore("user_viewer_c");
    const paths: string[] = [];
    const client = new LocalNetClient({
      baseUrl: "https://api.proxy.test", secureSessionStore: store,
      authClient: {
        request: async () => { throw new Error("unused"); },
        requestPublic: async (path) => { paths.push(path); return { status: 200, json: async () => ({ posts: [post("p1", "user_other")], media: {}, nextCursor: "", hasMore: false }) }; }
      }
    });
    const read = await client.listPostsByAuthors(["user_other"], 50);
    expect(read.posts).toHaveLength(1);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain("authors=user_other");
  });
});

describe("PROFILE-SAVED-001 — saved posts are fetched by id, not scraped from the feed", () => {
  async function clientWithCapture(): Promise<{
    client: LocalNetClient;
    envelopes: Record<string, unknown>[];
    publicCalls: string[];
  }> {
    const store = await authenticatedStore("user_001");
    const envelopes: Record<string, unknown>[] = [];
    const publicCalls: string[] = [];
    const client = new LocalNetClient({
      baseUrl: "https://api.proxy.test",
      secureSessionStore: store,
      authClient: {
        request: async (_path, init) => {
          envelopes.push(init.body as Record<string, unknown>);
          return {
            status: 200,
            json: async () => ({
              commandId: "command_saved_001",
              outcome: "ACCEPTED",
              aggregate: { type: "Post", id: "", version: 0, state: "POSTS_BY_IDS" },
              eventRefs: [],
              correlationId: "correlation_saved_001",
              operationRef: JSON.stringify({ posts: [], media: {} })
            })
          };
        },
        requestPublic: async (path) => {
          publicCalls.push(path);
          throw new Error("saved posts must never be read from the public feed");
        }
      }
    });
    return { client, envelopes, publicCalls };
  }

  it("asks the server for the bookmarked ids instead of filtering one feed page", async () => {
    const { client, envelopes, publicCalls } = await clientWithCapture();
    await client.listPostsByIds(["post_b", "post_a"]);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]!.commandType).toBe("ListPostsByIds");
    expect(envelopes[0]!.payload).toEqual({ postIds: ["post_b", "post_a"] });
    // 走的是需要鉴权的 command 通道，不是匿名 feed 通道。
    expect(publicCalls).toEqual([]);
  });

  it("deduplicates, trims and caps the id batch", async () => {
    const { client, envelopes } = await clientWithCapture();
    const ids = ["post_a", " post_a ", "", "   ", "post_b"];
    for (let i = 0; i < 150; i += 1) ids.push(`post_extra_${i}`);
    await client.listPostsByIds(ids);
    const sent = (envelopes[0]!.payload as { postIds: string[] }).postIds;
    expect(sent.slice(0, 2)).toEqual(["post_a", "post_b"]);
    expect(sent).toHaveLength(100);
    expect(new Set(sent).size).toBe(100);
  });

  it("sends an envelope the server will actually dispatch, with a non-empty target id", async () => {
    // 服务端 internal/api/command_dispatch.go 的 validateEnvelope 在 dispatch
    // 之前就要求 target.id 非空，空串会被拒成 INVALID_COMMAND_ENVELOPE ——
    // 收藏 tab 每次都会抛错，而且因为拒绝发生在 dispatch 之前，服务端日志里
    // 看不出「命令不支持」和「信封不合法」的区别。这里把服务端的必填字段契约
    // 钉在客户端侧：批量读没有单一聚合，必须用显式哨兵值而不是空串。
    const { client, envelopes } = await clientWithCapture();
    await client.listPostsByIds(["post_a"]);
    const envelope = envelopes[0]!;
    const target = envelope.target as { type: string; id: string };
    const actor = envelope.actor as { type: string; id: string };
    const principal = envelope.principal as { type: string; id: string };
    expect(target.type).not.toBe("");
    expect(target.id).not.toBe("");
    expect(actor.type).not.toBe("");
    expect(actor.id).not.toBe("");
    expect(principal.type).not.toBe("");
    expect(principal.id).not.toBe("");
    expect(envelope.commandVersion as number).toBeGreaterThan(0);
    expect((envelope.idempotencyKey as string).length).toBeGreaterThanOrEqual(8);
    expect(envelope.authContext).not.toBeNull();
    expect(envelope.purpose).not.toBe("");
    expect(envelope.correlationId).not.toBe("");
    expect(Number.isNaN(Date.parse(envelope.requestedAt as string))).toBe(false);
    expect(envelope.payload).not.toBeNull();
  });

  it("does not touch the network for an empty collection", async () => {
    const { client, envelopes } = await clientWithCapture();
    const page = await client.listPostsByIds([]);
    expect(envelopes).toEqual([]);
    expect(page).toMatchObject({ posts: [], hasMore: false });
  });
});

describe("MENTION-001 — tagged posts come from the server, not from one feed page", () => {
  async function mentionClient(): Promise<{
    client: LocalNetClient;
    envelopes: Record<string, unknown>[];
    publicCalls: string[];
  }> {
    const store = await authenticatedStore("user_001");
    const envelopes: Record<string, unknown>[] = [];
    const publicCalls: string[] = [];
    const client = new LocalNetClient({
      baseUrl: "https://api.proxy.test",
      secureSessionStore: store,
      authClient: {
        request: async (_path, init) => {
          envelopes.push(init.body as Record<string, unknown>);
          return {
            status: 200,
            json: async () => ({
              commandId: "command_mention_001",
              outcome: "ACCEPTED",
              aggregate: { type: "Post", id: "", version: 0, state: "POSTS_MENTIONING" },
              eventRefs: [],
              correlationId: "correlation_mention_001",
              operationRef: JSON.stringify({ posts: [], media: {}, hasMore: true })
            })
          };
        },
        requestPublic: async (path) => {
          publicCalls.push(path);
          throw new Error("mentions must never be scraped from the public feed");
        }
      }
    });
    return { client, envelopes, publicCalls };
  }

  it("asks the server for mentions instead of scanning one feed page", async () => {
    const { client, envelopes, publicCalls } = await mentionClient();
    await client.listPostsMentioning("@thanh");
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]!.commandType).toBe("ListPostsMentioning");
    // 走鉴权 command 通道，不碰匿名 feed —— 扫 feed 就又会退化成「只看得见一页」。
    expect(publicCalls).toEqual([]);
    expect(envelopes[0]!.payload).toEqual({ handle: "thanh", limit: 30 });
  });

  it("normalizes the handle before sending it", async () => {
    const { client, envelopes } = await mentionClient();
    await client.listPostsMentioning("  @@Thanh  ");
    expect((envelopes[0]!.payload as { handle: string }).handle).toBe("thanh");
  });

  it("does not touch the network when there is no handle to look up", async () => {
    const { client, envelopes } = await mentionClient();
    const page = await client.listPostsMentioning("  @ ");
    expect(envelopes).toEqual([]);
    expect(page).toMatchObject({ posts: [], hasMore: false });
  });

  it("reports the server's hasMore instead of pretending the first page is everything", async () => {
    const { client } = await mentionClient();
    const page = await client.listPostsMentioning("@thanh");
    expect(page.hasMore).toBe(true);
  });

  it("clamps the limit to the server's range", async () => {
    const { client, envelopes } = await mentionClient();
    await client.listPostsMentioning("@thanh", 500);
    expect((envelopes[0]!.payload as { limit: number }).limit).toBe(50);
    envelopes.length = 0;
    await client.listPostsMentioning("@thanh", 0);
    expect((envelopes[0]!.payload as { limit: number }).limit).toBe(1);
  });

  it("sends an envelope the server will actually dispatch, with a non-empty target id", async () => {
    // 与 PROFILE-SAVED-001 同一个坑：validateEnvelope 在 dispatch 之前就要求
    // target.id 非空，空串会被拒成 INVALID_COMMAND_ENVELOPE。
    const { client, envelopes } = await mentionClient();
    await client.listPostsMentioning("@thanh");
    const target = envelopes[0]!.target as { type: string; id: string };
    expect(target.type).not.toBe("");
    expect(target.id).not.toBe("");
  });
});

describe("SEARCH-CORPUS-001 — feed search actually reaches the server", () => {
  // 回归本体：listFeedPosts 的 searchQuery 参数**全仓无人传**，server 端 R15.94
  // 建好的 search 通道因此没有任何 caller —— 搜索只在「已加载的那几页」里做
  // 本地过滤，搜「人」只能搜到你恰好滚过的几条。下面钉住两条分支都要真的把
  // 查询交给服务端，而不是在本地把一页结果再筛一遍。
  function publicClient(): { client: LocalNetClient; requests: string[] } {
    const requests: string[] = [];
    const client = new LocalNetClient({
      baseUrl: "https://api.proxy.test",
      secureSessionStore: new SecureSessionStore(new InMemorySecureStorageDriver()),
      authClient: {
        request: async () => { throw new Error("command fallback must not run"); },
        requestPublic: async (path, init) => {
          requests.push(`${init.method} ${path}`);
          return { status: 200, json: async () => ({ posts: [], media: {}, nextCursor: "", hasMore: false }) };
        }
      }
    });
    return { client, requests };
  }

  it("forwards a trimmed, lowercased query on the public projection", async () => {
    const { client, requests } = publicClient();
    await client.listFeedPosts(undefined, 25, "  晴晴 ");
    expect(requests).toEqual(["GET /v1/feed?limit=25&search=%E6%99%B4%E6%99%B4"]);
  });

  it("omits the param entirely when the query is blank", async () => {
    const { client, requests } = publicClient();
    await client.listFeedPosts(undefined, 25, "   ");
    expect(requests).toEqual(["GET /v1/feed?limit=25"]);
  });

  it("sends search in the command payload on the authenticated path", async () => {
    // 这条分支以前完全不带 search，登录态下搜索就退化成「只筛一页」。
    const store = await authenticatedStore("user_001");
    const envelopes: Record<string, unknown>[] = [];
    const client = new LocalNetClient({
      baseUrl: "https://api.proxy.test",
      secureSessionStore: store,
      authClient: {
        request: async (_path, init) => {
          envelopes.push(init.body as Record<string, unknown>);
          return {
            status: 200,
            json: async () => ({
              commandId: "command_search_001",
              outcome: "ACCEPTED",
              aggregate: { type: "Feed", id: "local", version: 0, state: "LISTED" },
              eventRefs: [],
              correlationId: "correlation_search_001",
              operationRef: JSON.stringify({ posts: [], media: {}, hasMore: false })
            })
          };
        }
      }
    });
    await client.listFeedPosts(undefined, 25, "岘港");
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]!.commandType).toBe("ListFeedPosts");
    expect((envelopes[0]!.payload as { search?: string }).search).toBe("岘港");
  });

  it("keeps a post found by author name even though its body does not contain the query", async () => {
    // 修之前：server 只匹配 body 就把这条丢了，客户端再 OR authorDisplayName
    // 也永远匹配不到东西 —— 搜作者名恒返回 0 条，而代码看起来是支持的。
    const store = new SecureSessionStore(new InMemorySecureStorageDriver());
    const client = new LocalNetClient({
      baseUrl: "https://api.proxy.test",
      secureSessionStore: store,
      authClient: {
        request: async () => { throw new Error("command fallback must not run"); },
        requestPublic: async () => ({
          status: 200,
          json: async () => ({
            posts: [{
              postId: "post_by_name",
              authorType: "USER",
              authorId: "user_1",
              authorDisplayName: "晴晴",
              body: "今天的咖啡不错",
              mediaRefs: [],
              contextRefs: [],
              status: "PUBLISHED",
              createdAt: "2026-09-12T00:00:00Z"
            }],
            media: {},
            nextCursor: "",
            hasMore: false
          })
        })
      }
    });
    const page = await client.listFeedPosts(undefined, 25, "晴晴");
    expect(page.posts.map((p) => p.postId)).toEqual(["post_by_name"]);
  });
});
