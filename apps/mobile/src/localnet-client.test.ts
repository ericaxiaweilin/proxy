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
      refreshExpiresAt: "2026-10-04T00:00:00.000Z",
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
        refreshExpiresAt: "2026-09-24T00:00:00.000Z",
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
describe("LocalNetClient listMyFeedPosts pagination (R16.6)", () => {
  it("paginates past first page when viewer's own posts are not in page 1", async () => {
    const userId = "user_viewer_paginate";
    const store = await authenticatedStore(userId);
    let page = 0;
    const requestedPaths: string[] = [];
    const client = new LocalNetClient({
      baseUrl: "https://api.proxy.test",
      secureSessionStore: store,
      authClient: {
        request: async () => { throw new Error("authenticated listMyFeedPosts must use public feed"); },
        requestPublic: async (path, init) => {
          page += 1;
          requestedPaths.push(`${init.method} ${path}`);
          if (page === 1) {
            // 第一页 3 条全别人的帖 — 不含 viewer.
            return {
              status: 200,
              json: async () => ({
                posts: [
                  { postId: "post_other_1", authorId: "agent_linh", authorType: "AGENT", body: "seed 1", mediaRefs: [], visibility: "PUBLIC", cityScope: "hanoi", status: "PUBLISHED", contextRefs: [], createdAt: "2026-09-03T10:00:00Z", sceneType: "UNKNOWN" },
                  { postId: "post_other_2", authorId: "user_stranger", authorType: "USER", body: "seed 2", mediaRefs: [], visibility: "PUBLIC", cityScope: "hanoi", status: "PUBLISHED", contextRefs: [], createdAt: "2026-09-03T10:01:00Z", sceneType: "UNKNOWN" },
                  { postId: "post_other_3", authorId: "user_other", authorType: "USER", body: "seed 3", mediaRefs: [], visibility: "PUBLIC", cityScope: "hanoi", status: "PUBLISHED", contextRefs: [], createdAt: "2026-09-03T10:02:00Z", sceneType: "UNKNOWN" }
                ],
                media: {},
                nextCursor: "cursor_page_2",
                hasMore: true
              })
            };
          }
          // 第二页包含 viewer 自己的 2 条 — 必须立刻返回。
        if (page === 2) {
            return {
              status: 200,
              json: async () => ({
                posts: [
                  { postId: "post_mine_1", authorId: userId, authorType: "USER", body: "我的帖 1", mediaRefs: [], visibility: "PUBLIC", cityScope: "hanoi", status: "PUBLISHED", contextRefs: [], createdAt: "2026-08-25T00:00:00Z", sceneType: "UNKNOWN" },
                  { postId: "post_mine_2", authorId: userId, authorType: "USER", body: "我的帖 2", mediaRefs: [], visibility: "PUBLIC", cityScope: "hanoi", status: "PUBLISHED", contextRefs: [], createdAt: "2026-08-24T00:00:00Z", sceneType: "UNKNOWN" }
                ],
                media: { post_mine_1: [], post_mine_2: [] },
                nextCursor: "cursor_page_3",
                hasMore: false
              })
            };
          }
          throw new Error(`unexpected page ${page}`);
        }
      }
    });

    const mine = await client.listMyFeedPosts();
    expect(mine.posts.map((p) => p.postId)).toEqual(["post_mine_1", "post_mine_2"]);
    expect(mine.posts.every((p) => p.authorId === userId)).toBe(true);
    expect(page).toBe(2); // 必须翻 2 页才停 (不准只拉第一页)。
  });

  it("returns immediately on first page when viewer's own posts are already there", async () => {
    const userId = "user_viewer_fast";
    const store = await authenticatedStore(userId);
    let pages = 0;
    const client = new LocalNetClient({
      baseUrl: "https://api.proxy.test",
      secureSessionStore: store,
      authClient: {
        request: async () => { throw new Error("unused"); },
        requestPublic: async () => {
          pages += 1;
          return {
            status: 200,
            json: async () => ({
              posts: [
                { postId: "post_mine_x", authorId: userId, authorType: "USER", body: "hi", mediaRefs: [], visibility: "PUBLIC", cityScope: "hanoi", status: "PUBLISHED", contextRefs: [], createdAt: "2026-09-03T00:00:00Z", sceneType: "UNKNOWN" }
              ],
              media: { post_mine_x: [] },
              nextCursor: "cursor_x",
              hasMore: true
            })
          };
        }
      }
    });

    const mine = await client.listMyFeedPosts();
    expect(mine.posts.map((p) => p.postId)).toEqual(["post_mine_x"]);
    expect(pages).toBe(1); // 第一页就有 viewer 帖, 不需要翻。
  });

  it("returns empty array when viewer truly has zero posts after paginating", async () => {
    const userId = "user_viewer_empty";
    const store = await authenticatedStore(userId);
    let pages = 0;
    const client = new LocalNetClient({
      baseUrl: "https://api.proxy.test",
      secureSessionStore: store,
      authClient: {
        request: async () => { throw new Error("unused"); },
        requestPublic: async () => {
          pages += 1;
          return {
            status: 200,
            json: async () => ({
              posts: [
                { postId: `p${pages}`, authorId: "user_stranger", authorType: "USER", body: "others", mediaRefs: [], visibility: "PUBLIC", cityScope: "hanoi", status: "PUBLISHED", contextRefs: [], createdAt: "2026-09-03T00:00:00Z", sceneType: "UNKNOWN" }
              ],
              media: {},
              nextCursor: pages < 2 ? "next" : "",
              hasMore: pages < 2
            })
          };
        }
      }
    });

    const mine = await client.listMyFeedPosts();
    expect(mine.posts).toEqual([]);
    expect(pages).toBe(2); // 翻到底 (hasMore=false) 后停止, 不无限翻。
  });
});
