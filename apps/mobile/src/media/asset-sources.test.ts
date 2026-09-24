import { describe, expect, it } from "vitest";
import { avatarPathToInput, resolveAssetSource } from "./asset-sources";

const BASE = "http://api.test";

describe("MEDIA-PIPELINE-001 unified asset resolution", () => {
  it("resolves media ids to versioned thumb URLs", () => {
    expect(resolveAssetSource({ kind: "mediaId", id: "m1", version: 3 }, { baseUrl: BASE }))
      .toEqual({ uri: "http://api.test/v1/media/thumb/m1?v=3" });
  });

  it("resolves server paths and absolute URLs", () => {
    expect(resolveAssetSource({ kind: "serverPath", path: "/a/b.png" }, { baseUrl: BASE }))
      .toEqual({ uri: "http://api.test/a/b.png" });
    expect(resolveAssetSource({ kind: "serverPath", path: "https://cdn.test/x.png" }, { baseUrl: BASE }))
      .toEqual({ uri: "https://cdn.test/x.png" });
    expect(resolveAssetSource({ kind: "remote", url: "https://cdn.test/y.png" }, { baseUrl: BASE }))
      .toEqual({ uri: "https://cdn.test/y.png" });
  });

  it("never returns broken URLs", () => {
    expect(resolveAssetSource({ kind: "mediaId", id: "  " }, { baseUrl: BASE })).toBeUndefined();
    expect(resolveAssetSource({ kind: "mediaId", id: "m1" }, { baseUrl: "" })).toBeUndefined();
    expect(resolveAssetSource({ kind: "remote", url: "not-a-url" }, { baseUrl: BASE })).toBeUndefined();
    expect(resolveAssetSource({ kind: "file", uri: "" }, { baseUrl: BASE })).toBeUndefined();
    expect(resolveAssetSource({ kind: "file", uri: "file:///a.jpg" }, { baseUrl: BASE }))
      .toEqual({ uri: "file:///a.jpg" });
  });

  it("prioritises media asset over path over bundled persona", () => {
    expect(avatarPathToInput({ avatarMediaAssetId: "m9", avatarVersion: 2, avatarPath: "/a.png", personaId: "ai_001" }))
      .toEqual({ kind: "mediaId", id: "m9", version: 2 });
    expect(avatarPathToInput({ avatarPath: "/a.png", personaId: "ai_001" }))
      .toEqual({ kind: "serverPath", path: "/a.png" });
    expect(avatarPathToInput({ avatarPath: "", personaId: "ai_001" }))
      .toEqual({ kind: "bundled", key: "ai_001" });
    // 不以 / 开头的相对路径是打包 key 材料，不拼服务端 URL。
    expect(avatarPathToInput({ avatarPath: "ai-personas/photos/ai_001.png", personaId: "ai_001" }))
      .toEqual({ kind: "bundled", key: "ai_001" });
    expect(avatarPathToInput({ avatarPath: "" })).toBeUndefined();
  });

  it("passes a caller-supplied bundled registry through (test seam)", () => {
    expect(resolveAssetSource({ kind: "bundled", key: "ai_001" }, { baseUrl: BASE, bundledRegistry: { ai_001: 123 } }))
      .toBe(123);
    expect(resolveAssetSource({ kind: "bundled", key: "missing" }, { baseUrl: BASE, bundledRegistry: {} }))
      .toBeUndefined();
  });
});

// AVATAR-OTHER-HUMAN-002 (2026-09-21): identity.profiles.avatar_path 的**真实**
// 存储格式是 `assets/<mediaAssetId>` —— migrations/039_profile.sql:18 的 CHECK 是
// `avatar_path ~ '^ai-personas/|^assets/|^store/|^photo_'`。旧实现只认 mediaId /
// http(s) / 前导 `/`，所以真实 profile 的这个格式会掉到 personaId 分支再落到
// undefined：**即使把真实账号塞进来也转不出 URL**。
describe("AVATAR-OTHER-HUMAN-002 avatarPathToInput reads the server's real assets/ format", () => {
  const REAL = "ma_9b85d31f5712125ca8d5682e";

  it("turns assets/<mediaAssetId> into a mediaId input", () => {
    expect(avatarPathToInput({ avatarPath: `assets/${REAL}` }))
      .toEqual({ kind: "mediaId", id: REAL, version: 1 });
  });

  it("carries the profile version through to the thumb URL", () => {
    expect(avatarPathToInput({ avatarPath: "assets/ma_1", avatarVersion: 7 }))
      .toEqual({ kind: "mediaId", id: "ma_1", version: 7 });
    const input = avatarPathToInput({ avatarPath: `assets/${REAL}`, avatarVersion: 3 });
    expect(resolveAssetSource(input!, { baseUrl: BASE }))
      .toEqual({ uri: `${BASE}/v1/media/thumb/${REAL}?v=3` });
  });

  it("does not invent an asset id when the prefix has nothing after it", () => {
    expect(avatarPathToInput({ avatarPath: "assets/" })).toBeUndefined();
    expect(avatarPathToInput({ avatarPath: "assets/   " })).toBeUndefined();
  });

  it("leaves the two undocumented prefixes alone rather than guessing a URL", () => {
    // store/ 与 photo_ 也在 CHECK 的合法前缀里，但目前没有任何消费方、语义未知。
    // 拼一个必 404 的图比首字兜底更糟，所以这里必须保持 undefined。
    expect(avatarPathToInput({ avatarPath: "store/whatever" })).toBeUndefined();
    expect(avatarPathToInput({ avatarPath: "photo_123" })).toBeUndefined();
  });

  it("an explicit mediaAssetId still wins over an assets/ path", () => {
    expect(avatarPathToInput({ avatarMediaAssetId: "m9", avatarVersion: 2, avatarPath: "assets/ma_x" }))
      .toEqual({ kind: "mediaId", id: "m9", version: 2 });
  });
});
