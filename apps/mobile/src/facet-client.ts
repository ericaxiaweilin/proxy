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

import type { ListFacetObjectsPayload } from "@proxy/contracts";
import { parseListFacetObjectsPayload } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";

/**
 * PublicRequester 是匿名 GET 调用的最小 transport 接口。
 * 跟 SessionAuthClient.requestPublic 形状完全一致。
 */
export type PublicRequester = {
  requestPublic(path: string, init: { method: "GET" }): Promise<TransportResponse>;
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
}
