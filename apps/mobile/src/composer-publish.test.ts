// composer-publish.test.ts — 验证 ComposerV2Screen 的发布逻辑（无 RN / 无真实网络）
//
// 覆盖：
//   - buildCreatePostPayload 的所有字段组装
//   - draftHasContent 的各种 falsy / truthy 边界
//   - applyUploadOutcomes 的 ok / failed / cancelled / paused 分支
//   - performPublish 的 happy path + upload failed path
//   - newPublishIdempotencyKey 唯一性 + 格式

import { describe, expect, it } from "vitest";
import type { CreatePostPayload, FeedPost } from "@proxy/contracts";
import { type DraftMediaItem } from "./composer-media";
import { assembleComposerBody } from "./composer-body";
import {
  applyUploadOutcomes,
  buildCreatePostPayload,
  draftHasContent,
  newPublishIdempotencyKey,
  performPublish,
  type ComposerDraftForPublish
} from "./composer-publish";

const quotePost: FeedPost = {
  postId: "p1",
  authorType: "USER",
  authorId: "u1",
  authorDisplayName: "Linh",
  body: "周日下午去西湖拍照。",
  mediaRefs: [],
  status: "READY",
  contextRefs: [],
  createdAt: "2024-01-01T00:00:00Z"
};

const baseDraft: ComposerDraftForPublish = {
  body: "",
  media: [],
  visibility: "PUBLIC",
  includeCity: true,
  quoteTargetId: null,
  place: null,
  topic: null,
  gifWord: null,
  poll: { open: false, options: ["", ""], durationLabel: "1 天" },
  isGhost24h: false
};

function mediaReady(localId: string, mediaAssetId: string): DraftMediaItem {
  return {
    localId,
    image: { uri: `file://${localId}.jpg`, width: 100, height: 100 },
    altText: "",
    status: "READY",
    mediaAssetId
  };
}

describe("draftHasContent", () => {
  it("空 draft 不算有内容", () => {
    expect(draftHasContent(baseDraft)).toBe(false);
  });
  it("body 算", () => {
    expect(draftHasContent({ ...baseDraft, body: "hi" })).toBe(true);
  });
  it("空白 body 不算", () => {
    expect(draftHasContent({ ...baseDraft, body: "  \n  " })).toBe(false);
  });
  it("media / gifWord / poll.open / place / topic / quoteTargetId 都算", () => {
    expect(draftHasContent({ ...baseDraft, media: [mediaReady("a", "m1")] })).toBe(true);
    expect(draftHasContent({ ...baseDraft, gifWord: "YES!" })).toBe(true);
    expect(draftHasContent({ ...baseDraft, poll: { ...baseDraft.poll, open: true, options: ["A", "B"] } })).toBe(true);
    // 空选项的 poll 仍不算可发布（避免发出一条无效帖文）
    expect(draftHasContent({ ...baseDraft, poll: { ...baseDraft.poll, open: true } })).toBe(false);
    expect(draftHasContent({
      ...baseDraft,
      place: { id: "hn-swordlake", city: "河内", area: "还剑湖附近", kind: "PRESET" }
    })).toBe(true);
    expect(draftHasContent({ ...baseDraft, topic: "# topic" })).toBe(true);
    expect(draftHasContent({ ...baseDraft, quoteTargetId: "p1" })).toBe(true);
  });
});

describe("buildCreatePostPayload", () => {
  it("基础：body + visibility + cityScope", () => {
    const payload = buildCreatePostPayload({ ...baseDraft, body: "今天下午" });
    expect(payload.body).toBe("今天下午");
    expect(payload.visibility).toBe("PUBLIC");
    expect(payload.cityScope).toBe("hn");
    expect(payload.ephemeralUntil).toBeUndefined();
    expect(payload.poll).toBeUndefined();
    expect(payload.contextRefs).toBeUndefined();
    expect(payload.mediaRefs).toBeUndefined();
  });

  it("quoteTargetId → contextRefs", () => {
    const payload = buildCreatePostPayload({ ...baseDraft, quoteTargetId: "p1" });
    expect(payload.contextRefs).toEqual([{ contextType: "QUOTE_POST", contextId: "p1" }]);
  });

  it("isGhost24h → ephemeralUntil +24h", () => {
    const before = Date.now();
    const payload = buildCreatePostPayload({ ...baseDraft, isGhost24h: true });
    expect(payload.ephemeralUntil).toBeDefined();
    const until = Date.parse(payload.ephemeralUntil!);
    expect(until).toBeGreaterThanOrEqual(before + 24 * 3600 * 1000 - 100);
    expect(until).toBeLessThanOrEqual(before + 24 * 3600 * 1000 + 100);
  });

  it("poll.open + 选项 → Post.Poll", () => {
    const payload = buildCreatePostPayload({
      ...baseDraft,
      poll: { open: true, options: ["甜", "辣"], durationLabel: "2 天" }
    });
    expect(payload.poll).toBeDefined();
    expect(payload.poll?.options).toHaveLength(2);
    expect(payload.poll?.options[0]?.label).toBe("甜");
    expect(payload.poll?.options[1]?.sortOrder).toBe(1);
    // expiresAt 大约 2 天后
    const expires = Date.parse(payload.poll!.expiresAt);
    expect(expires - Date.now()).toBeGreaterThan(48 * 3600 * 1000 - 1000);
    expect(expires - Date.now()).toBeLessThan(48 * 3600 * 1000 + 1000);
  });

  it("poll 全空选项 → 不发 Post.Poll", () => {
    const payload = buildCreatePostPayload({
      ...baseDraft,
      poll: { open: true, options: ["", ""], durationLabel: "1 天" }
    });
    expect(payload.poll).toBeUndefined();
  });

  it("includeCity=false → 没有 cityScope", () => {
    const payload = buildCreatePostPayload({ ...baseDraft, includeCity: false });
    expect(payload.cityScope).toBeUndefined();
  });

  it("body + 装饰一并进入 body 文本（向后兼容 fallback）", () => {
    const payload = buildCreatePostPayload({ ...baseDraft, body: "今天下午", isGhost24h: true, gifWord: "OK" });
    expect(payload.body).toContain("⏱ [24h 临时动态]");
    expect(payload.body).toContain("🎬 GIF: OK");
    expect(payload.body).toContain("今天下午");
    expect(payload.ephemeralUntil).toBeDefined();
  });

  it("overrides.body 优先级最高", () => {
    const payload = buildCreatePostPayload(
      { ...baseDraft, body: "原始 body", isGhost24h: true },
      undefined,
      { body: "调换后的 body" }
    );
    expect(payload.body).toBe("调换后的 body");
    // 字段映射仍生效
    expect(payload.ephemeralUntil).toBeDefined();
  });

  it("overrides.mediaRefs 跳过 buildCreatePostPayload 里的解析（调用方负责传入完整列表）", () => {
    const payload = buildCreatePostPayload(
      { ...baseDraft, body: "帖子" },
      undefined,
      { mediaRefs: [{ mediaAssetId: "m1", sortOrder: 0 }] }
    );
    expect(payload.mediaRefs).toEqual([{ mediaAssetId: "m1", sortOrder: 0 }]);
  });

  it("空选项 poll → body 有 poll 前缀但 payload.poll 不写（避免后端拒收）", () => {
    const draft = { ...baseDraft, poll: { open: true as const, options: ["", ""], durationLabel: "1 天" } };
    const payload = buildCreatePostPayload(draft);
    expect(payload.poll).toBeUndefined();
    // body 拼装也跟上了：空选项不发
    expect(assembleComposerBody({
      body: draft.body,
      gifWord: draft.gifWord,
      poll: draft.poll,
      place: draft.place,
      topic: draft.topic,
      isGhost24h: draft.isGhost24h,
      quoteTarget: undefined
    })).not.toContain("📊");
  });

  it("FEED-OWN-001: 默认不再写死 authorDisplayName=你（读端按 author id 判定归属）", () => {
    const payload = buildCreatePostPayload({ ...baseDraft, body: "今天下午" });
    expect(payload.authorDisplayName).toBeUndefined();
  });

  it("FEED-OWN-001: 调用方传入的真名通过 overrides 上线", () => {
    const payload = buildCreatePostPayload(
      { ...baseDraft, body: "今天下午" },
      undefined,
      { authorDisplayName: "Huyen" }
    );
    expect(payload.authorDisplayName).toBe("Huyen");
  });
});

describe("applyUploadOutcomes", () => {
  const item: DraftMediaItem = {
    localId: "a",
    image: { uri: "x", width: 1, height: 1 },
    altText: "",
    status: "UPLOADING",
    progress: 0.5
  };

  it("ok → READY + mediaAssetId + 清掉 progress / uploadSession", () => {
    const next = applyUploadOutcomes([item], [{ kind: "ok", localId: "a", mediaAssetId: "m1" }]);
    expect(next[0]?.status).toBe("READY");
    expect(next[0]?.mediaAssetId).toBe("m1");
    expect(next[0]?.progress).toBe(1);
  });

  it("paused → PAUSED + error message", () => {
    const next = applyUploadOutcomes([item], [{ kind: "paused", localId: "a", message: "已暂停" }]);
    expect(next[0]?.status).toBe("PAUSED");
    expect(next[0]?.error).toBe("已暂停");
  });

  it("cancelled → FAILED + '照片上传已取消'", () => {
    const next = applyUploadOutcomes([item], [{ kind: "cancelled", localId: "a" }]);
    expect(next[0]?.status).toBe("FAILED");
    expect(next[0]?.error).toBe("照片上传已取消");
  });

  it("failed → FAILED + message", () => {
    const next = applyUploadOutcomes([item], [{ kind: "failed", localId: "a", message: "网络错误" }]);
    expect(next[0]?.status).toBe("FAILED");
    expect(next[0]?.error).toBe("网络错误");
  });

  it("没有 outcome 的项保持原状", () => {
    const next = applyUploadOutcomes([item], []);
    expect(next[0]).toEqual(item);
  });
});

describe("newPublishIdempotencyKey", () => {
  it("格式：mobile_post_publish_<base36>_<8字符>", () => {
    const key = newPublishIdempotencyKey();
    expect(key).toMatch(/^mobile_post_publish_[0-9a-z]+_[0-9a-z]{8}$/);
  });
  it("每次调用都不同", () => {
    const keys = new Set(Array.from({ length: 20 }, () => newPublishIdempotencyKey()));
    expect(keys.size).toBe(20);
  });
});

describe("performPublish", () => {
  it("happy: 上传 + 发布一次", async () => {
    const createdPost: FeedPost = { ...quotePost, postId: "new" };
    let uploadedCount = 0;
    const mediaClient = {
      uploadMedia: async () => {
        uploadedCount += 1;
        return { mediaAssetId: `m${uploadedCount}` };
      }
    } as unknown as Parameters<typeof performPublish>[2]["mediaClient"];
    const localNet = {
      createPost: async (payload: CreatePostPayload) => {
        expect(payload.mediaRefs).toHaveLength(1);
        return createdPost;
      }
    } as unknown as Parameters<typeof performPublish>[2]["localNet"];

    const result = await performPublish(
      { ...baseDraft, media: [itemPending("a")] },
      undefined,
      { localNet, mediaClient },
      { idempotencyKey: "key1" }
    );
    expect(result.ok).toBe(true);
    expect(uploadedCount).toBe(1);
  });

  it("upload 失败 → ok=false, reason='upload-failed'", async () => {
    const mediaClient = {
      uploadMedia: async () => { throw new Error("boom"); }
    } as unknown as Parameters<typeof performPublish>[2]["mediaClient"];
    const localNet = {
      createPost: async () => quotePost
    } as unknown as Parameters<typeof performPublish>[2]["localNet"];

    const result = await performPublish(
      { ...baseDraft, media: [itemPending("a")] },
      undefined,
      { localNet, mediaClient },
      { idempotencyKey: "key1" }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("upload-failed");
  });

  it("没有 media 的纯文字帖：直接发", async () => {
    const mediaClient = {
      uploadMedia: async () => ({ mediaAssetId: "x" })
    } as unknown as Parameters<typeof performPublish>[2]["mediaClient"];
    const localNet = {
      createPost: async (payload: CreatePostPayload) => ({ ...quotePost, body: payload.body })
    } as unknown as Parameters<typeof performPublish>[2]["localNet"];

    const result = await performPublish(
      { ...baseDraft, body: "纯文字", media: [] },
      undefined,
      { localNet, mediaClient },
      { idempotencyKey: "k1" }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.body).toBe("纯文字");
      expect(result.payload.mediaRefs).toBeUndefined();
    }
  });

  it("FEED-OWN-001: performPublish 默认不带展示名，真名经 options 上线", async () => {
    const mediaClient = {
      uploadMedia: async () => ({ mediaAssetId: "x" })
    } as unknown as Parameters<typeof performPublish>[2]["mediaClient"];
    const seen: CreatePostPayload[] = [];
    const localNet = {
      createPost: async (payload: CreatePostPayload) => {
        seen.push(payload);
        return quotePost;
      }
    } as unknown as Parameters<typeof performPublish>[2]["localNet"];

    const anonymous = await performPublish(
      { ...baseDraft, body: "a", media: [] },
      undefined,
      { localNet, mediaClient },
      { idempotencyKey: "k-anon" }
    );
    expect(anonymous.ok).toBe(true);
    expect(seen[0]?.authorDisplayName).toBeUndefined();

    const named = await performPublish(
      { ...baseDraft, body: "b", media: [] },
      undefined,
      { localNet, mediaClient },
      { idempotencyKey: "k-named", authorDisplayName: "Huyen" }
    );
    expect(named.ok).toBe(true);
    expect(seen[1]?.authorDisplayName).toBe("Huyen");
  });
});

function itemReady(localId: string): DraftMediaItem {
  return mediaReady(localId, `media_${localId}`);
}

function itemPending(localId: string): DraftMediaItem {
  return {
    localId,
    image: { uri: `file://${localId}.jpg`, width: 100, height: 100 },
    altText: "",
    status: "LOCAL"
  };
}