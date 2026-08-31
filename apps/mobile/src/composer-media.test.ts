// composer-media.test.ts — 验证 composer 媒体辅助函数

import { describe, expect, it } from "vitest";
import {
  createDraftMedia,
  draftMediaDragTarget,
  draftMediaRefs,
  MAX_ALT_LENGTH,
  mediaStatusLabel,
  moveDraftMedia,
  normalizeRestoredDraftMedia,
  pendingDraftMedia,
  type DraftMediaItem
} from "./composer-media";

function ready(localId: string, mediaAssetId: string): DraftMediaItem {
  return {
    localId,
    image: { uri: `file://${localId}.jpg`, width: 100, height: 100 },
    altText: "",
    status: "READY",
    mediaAssetId
  };
}

describe("createDraftMedia", () => {
  it("返回 LOCAL 状态、空 altText", () => {
    const item = createDraftMedia({ uri: "x", width: 1, height: 1 }, "a");
    expect(item.localId).toBe("a");
    expect(item.status).toBe("LOCAL");
    expect(item.altText).toBe("");
  });
});

describe("moveDraftMedia", () => {
  const items = [ready("a", "1"), ready("b", "2"), ready("c", "3")];

  it("交换相邻位置", () => {
    const next = moveDraftMedia(items, 0, 2);
    expect(next.map((it) => it.localId)).toEqual(["b", "c", "a"]);
  });

  it("from === to → 原样返回", () => {
    const next = moveDraftMedia(items, 1, 1);
    expect(next).toEqual(items);
  });

  it("越界 from → 原样返回", () => {
    expect(moveDraftMedia(items, -1, 0)).toEqual(items);
    expect(moveDraftMedia(items, 99, 0)).toEqual(items);
  });

  it("原数组不被修改（immutable）", () => {
    const snapshot = items.map((it) => it.localId);
    moveDraftMedia(items, 0, 2);
    expect(items.map((it) => it.localId)).toEqual(snapshot);
  });
});

describe("draftMediaDragTarget", () => {
  const span = 130;
  it("dx=0 → from", () => {
    expect(draftMediaDragTarget(0, 0, span, 4)).toBe(0);
  });
  it("dx=span → +1", () => {
    expect(draftMediaDragTarget(0, span, span, 4)).toBe(1);
  });
  it("dx=-span → -1", () => {
    expect(draftMediaDragTarget(2, -span, span, 4)).toBe(1);
  });
  it("clamp 上界", () => {
    expect(draftMediaDragTarget(3, span * 5, span, 4)).toBe(3);
  });
  it("clamp 下界", () => {
    expect(draftMediaDragTarget(0, -span * 5, span, 4)).toBe(0);
  });
  it("itemCount=0 → 返回 from", () => {
    expect(draftMediaDragTarget(2, 100, span, 0)).toBe(2);
  });
});

describe("pendingDraftMedia", () => {
  it("READY + 有 mediaAssetId 不算 pending", () => {
    expect(pendingDraftMedia([ready("a", "m1")])).toEqual([]);
  });
  it("READY 但缺 mediaAssetId 算 pending", () => {
    const item = { ...ready("a", "m1"), mediaAssetId: undefined };
    expect(pendingDraftMedia([item]).length).toBe(1);
  });
  it("LOCAL / UPLOADING / PAUSED / FAILED 算 pending", () => {
    const items: DraftMediaItem[] = [
      { ...ready("a", "m1"), status: "LOCAL" },
      { ...ready("b", "m2"), status: "UPLOADING" },
      { ...ready("c", "m3"), status: "PAUSED" },
      { ...ready("d", "m4"), status: "FAILED" }
    ];
    expect(pendingDraftMedia(items)).toHaveLength(4);
  });
});

describe("draftMediaRefs", () => {
  it("全部 READY + 有 mediaAssetId → 返回 ref 列表", () => {
    const refs = draftMediaRefs([ready("a", "m1"), ready("b", "m2")]);
    expect(refs).toEqual([
      { mediaAssetId: "m1", sortOrder: 0 },
      { mediaAssetId: "m2", sortOrder: 1 }
    ]);
  });

  it("altText 空白时不写入 altText 字段", () => {
    const refs = draftMediaRefs([{ ...ready("a", "m1"), altText: "   " }]);
    expect(refs?.[0]?.altText).toBeUndefined();
  });

  it("altText 有内容时写入", () => {
    const refs = draftMediaRefs([{ ...ready("a", "m1"), altText: "猫" }]);
    expect(refs?.[0]?.altText).toBe("猫");
  });

  it("任一项非 READY → 返回 undefined", () => {
    const items = [ready("a", "m1"), { ...ready("b", "m2"), status: "FAILED" as const }];
    expect(draftMediaRefs(items)).toBeUndefined();
  });
});

describe("mediaStatusLabel", () => {
  it("UPLOADING + progress < 1 → 百分数", () => {
    expect(mediaStatusLabel({ ...ready("a", "m"), status: "UPLOADING", progress: 0.4 })).toBe("上传 40%");
  });
  it("UPLOADING + progress >= 1 → 服务端处理中", () => {
    expect(mediaStatusLabel({ ...ready("a", "m"), status: "UPLOADING", progress: 1 })).toBe("服务端处理中…");
  });
  it("UPLOADING 没 progress → 服务端处理中", () => {
    expect(mediaStatusLabel({ ...ready("a", "m"), status: "UPLOADING" })).toBe("服务端处理中…");
  });
  it("PAUSED → 已暂停", () => {
    expect(mediaStatusLabel({ ...ready("a", "m"), status: "PAUSED" })).toBe("已暂停 · 可续传");
  });
  it("READY → 已就绪", () => {
    expect(mediaStatusLabel(ready("a", "m"))).toBe("已就绪");
  });
  it("FAILED → 失败可重试", () => {
    expect(mediaStatusLabel({ ...ready("a", "m"), status: "FAILED" })).toBe("失败 · 可重试");
  });
  it("LOCAL → 待上传", () => {
    expect(mediaStatusLabel({ ...ready("a", "m"), status: "LOCAL" })).toBe("待上传");
  });
});

describe("normalizeRestoredDraftMedia", () => {
  it("UPLOADING → PAUSED + progress 用 uploadSession 计算", () => {
    const item: DraftMediaItem = {
      ...ready("a", "m1"),
      status: "UPLOADING",
      progress: 0.5,
      uploadSession: { mediaAssetId: "m1", storageKey: "k", uploadUrl: "https://example.com", offset: 50, totalBytes: 100 }
    };
    const next = normalizeRestoredDraftMedia([item]);
    expect(next[0]?.status).toBe("PAUSED");
    expect(next[0]?.progress).toBe(0.5);
    expect(next[0]?.error).toContain("已暂停");
  });

  it("UPLOADING + 无 uploadSession → progress 用原 progress", () => {
    const item: DraftMediaItem = { ...ready("a", "m1"), status: "UPLOADING", progress: 0.3 };
    const next = normalizeRestoredDraftMedia([item]);
    expect(next[0]?.progress).toBe(0.3);
  });

  it("非 UPLOADING → 原样保留", () => {
    const item = ready("a", "m1");
    expect(normalizeRestoredDraftMedia([item])).toEqual([item]);
  });
});

describe("MAX_ALT_LENGTH", () => {
  it("为合理的 280 字符", () => {
    expect(MAX_ALT_LENGTH).toBe(280);
  });
});