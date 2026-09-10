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
