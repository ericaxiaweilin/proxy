// FacetClient — R15.25 FACET object list (Phase 1 = list only).
//
// 设计原则：
//  - 后端是 anonymous GET /v1/facet/objects，不需要 auth，不需要
//    command envelope。这是项目里第一个 anonymous GET client，单独成
//    一个文件避免污染 command-mode 范本（LocalNetClient / SceneClient
//    都走 POST /v1/commands/{type}）。
//  - 后端 wire shape 跟 packages/contracts/src/facet.ts
//    ListFacetObjectsPayloadSchema 严格对齐，parse 失败立刻抛错
//    （fail-closed），UI 必须 catch。
//  - Phase 1 NOT-IN-SCOPE：LIBRARY / OBJECTS list / OBJECT DETAIL /
//    OBJECT PREVIEW / 关系规则引擎 / 真实持久化。
//  - R15.43：副空间 CRUD（add/remove/list/catalog）也走匿名 transport。
//    限制：add/remove 仅对 CREATOR_COLLAB 关系有效（server 端校验）。
//    设计目的：副空间是"用户主动运营"，不是"用户之间互动"，所以
//    走匿名没问题；Phase 2 加 auth 也只是补 server header。

import type {
  ListFacetObjectsPayload,
  ListSideSpaceCatalogPayload,
  ListSideSpacePostsPayload,
  ListSideSpaceSuggestionsPayload,
  FacetSideSpacePost,
  FacetConfig,
  UpdateFacetConfigPayload
} from "@proxy/contracts";
import {
  parseListFacetObjectsPayload,
  parseListSideSpacePostsPayload,
  parseListSideSpaceCatalogPayload,
  parseFacetSideSpacePost,
  parseFacetConfig,
  parseListSideSpaceSuggestionsPayload
} from "@proxy/contracts";
import type { TransportResponse, TransportRequest } from "./auth-client";

/**
 * PublicRequester 是匿名 transport 的最小接口。
 * 跟 SessionAuthClient.requestPublic 形状完全一致，支持 GET / POST /
 * DELETE / body JSON。
 */
export type PublicRequester = {
  requestPublic(path: string, init: { method: TransportRequest["method"]; body?: unknown }): Promise<TransportResponse>;
};

export type FacetClientOptions = {
  requester: PublicRequester;
  baseUrl: string;
};

export class FacetProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "FacetProtocolError";
  }
}

export class FacetClient {
  public constructor(private readonly input: FacetClientOptions) {}

  /**
   * 列出当前用户的所有 FACET 对象（R15.25 Phase 1）。
   * 后端 hardcode 返回 3 个 mock 对象 (Ken / Linh / ABC Spa)；
   * avatarUrl 永远 = ""（Phase 1 不做图片，UI 显示 placeholder）。
   *
   * R15.41 起：每个对象附带 recommendedKind / reasoningConfidence /
   * sideSpaceGap / sideSpaceKind。
   * R15.43 起：CREATOR_COLLAB 关系附带 sideSpacePosts 列表。
   *
   * 失败原因 (UI 必须 catch)：
   *  - FacetProtocolError "non_2xx": HTTP status 4xx/5xx
   *  - ZodError: 响应字段不匹配 contract（schema 漂移，立刻崩）
   */
  public async listObjects(): Promise<ListFacetObjectsPayload> {
    const path = "/v1/facet/objects";
    const response = await this.input.requester.requestPublic(path, { method: "GET" });
    if (response.status < 200 || response.status >= 300) {
      throw new FacetProtocolError(`facet listObjects unexpected status: ${response.status}`);
    }
    const raw = await response.json();
    return parseListFacetObjectsPayload(raw);
  }

  // ---------- R15.43 副空间 CRUD ----------

  /**
   * 列出某个对象的副空间内容（R15.43）。
   * 返回的 posts 已按 AddedAt 倒序（最新在前）。
   */
  public async listSideSpacePosts(objectId: string): Promise<ListSideSpacePostsPayload> {
    const path = `/v1/facet/objects/${encodeURIComponent(objectId)}/side-space/posts`;
    const response = await this.input.requester.requestPublic(path, { method: "GET" });
    if (response.status < 200 || response.status >= 300) {
      throw new FacetProtocolError(`facet listSideSpacePosts unexpected status: ${response.status}`);
    }
    const raw = await response.json();
    return parseListSideSpacePostsPayload(raw);
  }

  /**
   * 把全局 catalog 里的某个 post 加入到某个对象的副空间。
   * 仅对 CREATOR_COLLAB 关系有效。
   * 失败：
   *   - 400 object_not_creator_collab: 对象不是合作方
   *   - 404 post_not_in_catalog: postId 不在 catalog
   *   - 404 object_not_found: 对象不存在
   *   - 409 already_added: 已经在副空间
   *   - 400 invalid_kind: post kind 不在副空间白名单
   */
  public async addSideSpacePost(objectId: string, postId: string): Promise<FacetSideSpacePost> {
    const path = `/v1/facet/objects/${encodeURIComponent(objectId)}/side-space/posts`;
    const response = await this.input.requester.requestPublic(path, {
      method: "POST",
      body: { postId }
    });
    if (response.status < 200 || response.status >= 300) {
      throw new FacetProtocolError(`facet addSideSpacePost unexpected status: ${response.status} body=${JSON.stringify(response).slice(0, 200)}`);
    }
    const raw = await response.json();
    return parseFacetSideSpacePost(raw);
  }

  /**
   * 从某个对象的副空间移除一条 post。
   * 失败：404 not_in_sidespace
   */
  public async removeSideSpacePost(objectId: string, postId: string): Promise<void> {
    const path = `/v1/facet/objects/${encodeURIComponent(objectId)}/side-space/posts/${encodeURIComponent(postId)}`;
    const response = await this.input.requester.requestPublic(path, { method: "DELETE" });
    if (response.status < 200 || response.status >= 300) {
      throw new FacetProtocolError(`facet removeSideSpacePost unexpected status: ${response.status}`);
    }
  }

  /**
   * 列出全局副空间 catalog（Phase 1.5 = 5 个 mock post）。
   * UI 用这个渲染"添加副空间"选择器。
   */
  public async listSideSpaceCatalog(): Promise<ListSideSpaceCatalogPayload> {
    const path = "/v1/facet/side-space/catalog";
    const response = await this.input.requester.requestPublic(path, { method: "GET" });
    if (response.status < 200 || response.status >= 300) {
      throw new FacetProtocolError(`facet listSideSpaceCatalog unexpected status: ${response.status}`);
    }
    const raw = await response.json();
    return parseListSideSpaceCatalogPayload(raw);
  }

  /**
   * R15.51 — 拉取当前运营阈值 (FacetConfig).
   * 匿名可读 (跟 ListFacetObjects 同策略) — OPS 页面加载时拉取展示 + 编辑.
   */
  public async listFacetConfig(): Promise<FacetConfig> {
    const path = "/v1/facet/config";
    const response = await this.input.requester.requestPublic(path, { method: "GET" });
    if (response.status < 200 || response.status >= 300) {
      throw new FacetProtocolError(`facet listFacetConfig unexpected status: ${response.status}`);
    }
    const raw = await response.json();
    return parseFacetConfig(raw);
  }

  /**
   * R15.51 — 提交阈值更新 (乐观锁 expectedVersion).
   * 成功 → 新 config (Version+1); version mismatch → 409 (throw FacetProtocolError).
   */
  public async updateFacetConfig(payload: UpdateFacetConfigPayload): Promise<FacetConfig> {
    const path = "/v1/facet/config";
    const response = await this.input.requester.requestPublic(path, {
      method: "POST",
      body: payload
    });
    if (response.status === 409) {
      throw new FacetProtocolError("facet config version mismatch (refresh and retry)");
    }
    if (response.status === 400) {
      throw new FacetProtocolError("facet config invalid value or updated_by missing");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new FacetProtocolError(`facet updateFacetConfig unexpected status: ${response.status}`);
    }
    const raw = await response.json();
    return parseFacetConfig(raw);
  }

  /**
   * R15.52 — 拉取 server 推送的副空间推荐.
   * 返 { suggestions: { [objectId]: SideSpaceSuggestions } } — 未满足的对象 key 不存在
   * 或 posts 为空 (UI 跳过).
   * limit 默认 3 (server cap 10).
   */
  public async listSideSpaceSuggestions(limit: number = 3): Promise<ListSideSpaceSuggestionsPayload> {
    const path = `/v1/facet/side-space/suggestions?limit=${limit}`;
    const response = await this.input.requester.requestPublic(path, { method: "GET" });
    if (response.status < 200 || response.status >= 300) {
      throw new FacetProtocolError(`facet listSideSpaceSuggestions unexpected status: ${response.status}`);
    }
    const raw = await response.json();
    return parseListSideSpaceSuggestionsPayload(raw);
  }
}
