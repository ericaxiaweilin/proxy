import { describe, expect, it } from "vitest";
import type { MutedAuthorEntry } from "@proxy/contracts";
import { mutedAuthorLabel, removeMutedAuthor } from "./muted-authors";

// MUTE-REVERSIBLE-001 — 「我屏蔽的人」列表的两条纯逻辑。
//
// 钉住的是能力不是实现：
//   1) 解除屏蔽后那一行必须真的从本地列表消失（否则界面会把已解除的人继续列着）
//   2) 列表里的名字必须走唯一那条身份链，**永远不显示 account id**
//      （屏蔽列表的人帖子全被过滤了，没有别的名字来源）

function entry(authorId: string, authorDisplayName?: string): MutedAuthorEntry {
  return {
    muteId: `mute_${authorId}`,
    authorId,
    createdAt: "2026-09-13T12:00:00Z",
    ...(authorDisplayName === undefined ? {} : { authorDisplayName })
  };
}

describe("removeMutedAuthor", () => {
  it("drops the unmuted row and keeps the rest in order", () => {
    const before = [entry("author_a", "Huyen"), entry("author_b", "Khoa"), entry("author_c", "Linh")];
    const after = removeMutedAuthor(before, "author_b");
    expect(after.map((row) => row.authorId)).toEqual(["author_a", "author_c"]);
    expect(after[0]?.authorDisplayName).toBe("Huyen");
  });

  it("is idempotent when the author is not in the list", () => {
    const before = [entry("author_a", "Huyen")];
    expect(removeMutedAuthor(before, "author_never_muted").map((row) => row.authorId)).toEqual(["author_a"]);
    // 重复解除同一个人：第二次仍然只是「没有这一行」，不报错、不误删别人。
    const once = removeMutedAuthor(before, "author_a");
    expect(removeMutedAuthor(once, "author_a")).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const before = [entry("author_a", "Huyen"), entry("author_b", "Khoa")];
    const snapshot = [...before];
    removeMutedAuthor(before, "author_a");
    expect(before).toEqual(snapshot);
  });

  it("returns an empty list for an empty list", () => {
    expect(removeMutedAuthor([], "author_a")).toEqual([]);
  });
});

describe("mutedAuthorLabel", () => {
  it("uses the server-resolved display name", () => {
    expect(mutedAuthorLabel(entry("author_a", "NguyenThanhHuyen"))).toBe("NguyenThanhHuyen");
  });

  it("never degrades to the raw account id", () => {
    const label = mutedAuthorLabel(entry("user_9f3c1a2b4d5e"));
    expect(label).not.toBe("user_9f3c1a2b4d5e");
    expect(label).not.toContain("user_9f3c1a2b4d5e");
    expect(label).toBe("用户");
  });

  it("treats a blank server name as missing", () => {
    expect(mutedAuthorLabel(entry("author_a", "   "))).toBe("用户");
  });

  it("does not repeat the legacy poisoned '你' as a name", () => {
    // FEED-OWN-001: 历史客户端把 "你" 硬编码进过 profile。当成名字回给所有人
    // 会让被屏蔽者显示成"你"。
    expect(mutedAuthorLabel(entry("author_a", "你"))).toBe("用户");
  });

  it("is viewer-relative like every other author label", () => {
    // 跟 feed-author 同一条链（OWN-NAME-001：自己也显示名字，不再是「你」）。
    // 这里断言的是「同一个解析器」，不是另起一套命名规则。
    expect(mutedAuthorLabel(entry("user_001", "Huyen"), "user_001")).toBe("Huyen");
    expect(mutedAuthorLabel(entry("author_b", "Khoa"), "user_001")).toBe("Khoa");
  });

  it("keeps two different people distinguishable", () => {
    const rows = [entry("author_a", "Huyen"), entry("author_b", "Khoa")];
    const labels = rows.map((row) => mutedAuthorLabel(row));
    expect(new Set(labels).size).toBe(2);
  });
});
