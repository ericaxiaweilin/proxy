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
//  - R15.43：副空间 CRUD。读（list/catalog）走匿名 transport；
//    写（add/remove/updateConfig）FACET-AUTH-001 起必须走 authedRequester
//    （带 session token），server 无 token 拒 401 + IP/principal 双限流。
//    副空间是"用户主动运营"，写必须归属到人；匿名写已关闭。

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
 * 可选的 request 是认证通道（SessionAuthClient.request 形状）：当传入的
 * requester 自带它（如 sessionAuthClient），写操作自动走它，不用改调用方。
 */
export type PublicRequester = {
  requestPublic(path: string, init: { method: TransportRequest["method"]; body?: unknown }): Promise<TransportResponse>;
  request?(path: string, init: { method: TransportRequest["method"]; body?: unknown }): Promise<TransportResponse>;
};

/**
 * AuthedRequester 是认证 transport 的最小接口。
 * 跟 SessionAuthClient.request 形状一致：自动带 bearer token，
 * 401 时尝试 refresh，refresh 失败抛 SessionExpiredError。
 * FACET-AUTH-001 起：所有 facet 写操作必须走这个通道，匿名写 server 拒 401。
 */
export type AuthedRequester = {
  request(path: string, init: { method: TransportRequest["method"]; body?: unknown }): Promise<TransportResponse>;
};

export type FacetClientOptions = {
  requester: PublicRequester;
  baseUrl: string;
  /**
   * 写操作（add/remove/updateConfig）用的认证通道。不传则回退到
   * requester（旧行为，仅测试/过渡用）——生产调用方必须传
   * sessionAuthClient，否则 server 返 401。
   */
  authedRequester?: AuthedRequester;
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
   * 写通道：显式 authedRequester 优先；其次用 requester 自带的 request
   *（sessionAuthClient 同时实现 requestPublic + request，调用方如 me.tsx
   * 无需改动即自动带 token）；最后回退匿名 requestPublic（旧行为，仅测
   * 试/过渡用——生产无 token 写 server 返 401）。
   * Server 对写路径无 token 返 401，这里把 401 翻译成明确错误，
   * 不让 UI 误报成"网络问题"。
   */
  private write(path: string, init: { method: TransportRequest["method"]; body?: unknown }): Promise<TransportResponse> {
    const explicit = this.input.authedRequester;
    if (explicit) return explicit.request(path, init);
    const embedded = this.input.requester.request;
    if (typeof embedded === "function") return embedded.call(this.input.requester, path, init);
    return this.input.requester.requestPublic(path, init);
  }

  private static throwIfWriteRejected(response: TransportResponse, op: string): void {
    if (response.status === 401) {
      throw new FacetProtocolError(`facet ${op} requires sign-in (401): 请登录后重试`);
    }
    if (response.status === 429) {
      throw new FacetProtocolError(`facet ${op} rate limited (429): 操作太频繁，请稍后重试`);
    }
  }
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
   * FACET-AUTH-001: 必须经 authedRequester（带 token），匿名调 server 拒 401。
   * 失败：
   *   - 401: 未登录（请登录后重试）
   *   - 429: 操作太频繁
   *   - 400 object_not_creator_collab: 对象不是合作方
   *   - 404 post_not_in_catalog: postId 不在 catalog
   *   - 404 object_not_found: 对象不存在
   *   - 409 already_added: 已经在副空间
   *   - 400 invalid_kind: post kind 不在副空间白名单
   */
  public async addSideSpacePost(objectId: string, postId: string): Promise<FacetSideSpacePost> {
    const path = `/v1/facet/objects/${encodeURIComponent(objectId)}/side-space/posts`;
    const response = await this.write(path, {
      method: "POST",
      body: { postId }
    });
    FacetClient.throwIfWriteRejected(response, "addSideSpacePost");
    if (response.status < 200 || response.status >= 300) {
      throw new FacetProtocolError(`facet addSideSpacePost unexpected status: ${response.status} body=${JSON.stringify(response).slice(0, 200)}`);
    }
    const raw = await response.json();
    return parseFacetSideSpacePost(raw);
  }

  /**
   * 从某个对象的副空间移除一条 post。
   * FACET-AUTH-001: 必须经 authedRequester。失败：401 未登录 / 429 限流 / 404 not_in_sidespace
   */
  public async removeSideSpacePost(objectId: string, postId: string): Promise<void> {
    const path = `/v1/facet/objects/${encodeURIComponent(objectId)}/side-space/posts/${encodeURIComponent(postId)}`;
    const response = await this.write(path, { method: "DELETE" });
    FacetClient.throwIfWriteRejected(response, "removeSideSpacePost");
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
   * FACET-AUTH-001: 必须经 authedRequester；updatedBy 由 server 按 principal
   * 回填，客户端传什么都会被覆盖（填占位即可）。
   * 成功 → 新 config (Version+1); version mismatch → 409 (throw FacetProtocolError).
   */
  public async updateFacetConfig(payload: UpdateFacetConfigPayload): Promise<FacetConfig> {
    const path = "/v1/facet/config";
    const response = await this.write(path, {
      method: "POST",
      body: payload
    });
    FacetClient.throwIfWriteRejected(response, "updateFacetConfig");
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
