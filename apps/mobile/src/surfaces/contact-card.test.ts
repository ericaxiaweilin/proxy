import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// CONTACT-CARD-001: 名片 picker 曾经只有 UI 壳 —— setCardOptions 一次都没被
// 调用过，打开永远转圈。数据源：首项"我自己的名片"（profileClient），后面是
// 好友（relationship 逐个解 handle）。拼不出合法 vcard 的不列（fail-closed）。
// 注释先剥掉再断言，只认代码。
const convo = readFileSync(fileURLToPath(new URL("./conversation.tsx", import.meta.url)), "utf8");
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const convoCode = stripComments(convo);

describe("CONTACT-CARD-001 contact picker is backed by real data, not an empty shell", () => {
  it("loads options when the picker opens instead of leaving them undefined forever", () => {
    // 原 bug：setCardOptions 零调用，cardOptions 永远 undefined，picker 永远转圈。
    expect(convoCode).toContain("setCardOptions(options)");
    expect(convoCode).toContain("if (!cardPickerOpen)");
  });

  it("puts my own card first, built from the signed-in profile", () => {
    expect(convoCode).toContain("profileClient.getProfile()");
    expect(convoCode).toContain('name: "我的名片"');
    expect(convoCode).toContain("buildContactCard({ name:");
  });

  it("resolves each friend to a handle and skips the ones without one", () => {
    // handle 不在好友侧能解出来时宁可不列 —— 发一张扫了落不到人的卡等于没接。
    expect(convoCode).toContain("listMyFriendships");
    expect(convoCode).toContain('state === "FRIEND"');
    expect(convoCode).toContain("getProfile(f.userId)");
    expect(convoCode).toContain("if (profile && vcard)");
  });
});
