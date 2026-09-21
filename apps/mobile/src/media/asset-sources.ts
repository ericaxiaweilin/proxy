// asset-sources.ts — 统一媒体资产解析层 (MEDIA-PIPELINE-001).
//
// 全 App 唯一的 "展示字符串 → 可渲染 source" 翻译点。之前每个 surface
// 各写一套：AI 照片 require 表、localApiBaseUrl 拼接、media thumb URL、
// 本地 file 锚定……同一种 avatarPath 在不同页面能渲染出不同结果
// （动态 AI 帖直接没有头像）。此后新增资产种类只加这里 + 注册表，
// 调用方一律走 resolveAssetSource；门禁脚本 check-media-pipeline.mjs
// 负责拦住新的散装实现。

// Expo <Image> 与 RN <Image> 都接受的最小 source 形态（不引 RN 运行时）。
export type AssetImageSource = number | { uri: string };

export type AssetSourceInput =
  | { kind: "bundled"; key: string }
  | { kind: "mediaId"; id: string; version?: number }
  | { kind: "serverPath"; path: string }
  | { kind: "remote"; url: string }
  | { kind: "file"; uri: string };

export type AssetResolverOptions = {
  /** API 根（如 localApiBaseUrl），用于 serverPath / mediaId 拼装。 */
  baseUrl: string;
  /** 测试/调用域覆盖的打包注册表（缺省走内置 AI 人像表）。 */
  bundledRegistry?: Record<string, AssetImageSource | undefined> | undefined;
};

/**
 * 解析一条资产输入为可渲染 source。拿不到返回 undefined（调用方走首字
 * fallback），绝不抛错、绝不返回拼一半的坏 URL。
 */
export function resolveAssetSource(
  input: AssetSourceInput,
  opts: AssetResolverOptions
): AssetImageSource | undefined {
  const baseUrl = (opts.baseUrl ?? "").replace(/\/+$/, "");
  switch (input.kind) {
    case "bundled": {
      if (opts.bundledRegistry) return opts.bundledRegistry[input.key];
      return getBundledPhoto(input.key);
    }
    case "mediaId": {
      const id = input.id.trim();
      if (id === "" || baseUrl === "") return undefined;
      const version = input.version ?? 1;
      return { uri: `${baseUrl}/v1/media/thumb/${encodeURIComponent(id)}?v=${version}` };
    }
    case "serverPath": {
      const path = input.path.trim();
      if (path === "" || baseUrl === "") return undefined;
      if (/^https?:\/\//.test(path)) return { uri: path };
      return { uri: `${baseUrl}${path.startsWith("/") ? path : `/${path}`}` };
    }
    case "remote": {
      const url = input.url.trim();
      return /^https?:\/\//.test(url) ? { uri: url } : undefined;
    }
    case "file": {
      const uri = input.uri.trim();
      return uri === "" ? undefined : { uri };
    }
  }
}

/**
 * 服务端/账号下发的 avatarPath 字符串归一化为解析输入。
 * 优先级：服务端媒体资产 > 绝对 URL > / 开头服务端路径 > assets/ 资产指针 > 打包注册表。
 * 注意：不以 / 开头的相对路径（如 ai-personas/…）是打包 key 材料，
 * 按旧行为走注册表，绝不拼成服务端 URL（会 404）。
 */
export function avatarPathToInput(input: {
  avatarMediaAssetId?: string | undefined;
  avatarVersion?: number | undefined;
  avatarPath: string;
  personaId?: string | undefined;
}): AssetSourceInput | undefined {
  const mediaId = (input.avatarMediaAssetId ?? "").trim();
  if (mediaId !== "") return { kind: "mediaId", id: mediaId, version: input.avatarVersion ?? 1 };
  const path = (input.avatarPath ?? "").trim();
  if (path !== "") {
    if (/^https?:\/\//.test(path)) return { kind: "remote", url: path };
    if (path.startsWith("/")) return { kind: "serverPath", path };
    // AVATAR-OTHER-HUMAN-002 (2026-09-21): identity.profiles.avatar_path 的**真实**
    // 存储格式是 `assets/<mediaAssetId>` —— 见 migrations/039_profile.sql:18 的 CHECK
    // （`avatar_path ~ '^ai-personas/|^assets/|^store/|^photo_'`）。
    // 旧实现只认 mediaId / http(s) / 前导 `/`，所以这个格式会掉到下面的 personaId
    // 分支再落到 undefined —— 也就是说**即使把真实 profile 塞进来，这个函数也转不出
    // URL**。feed.tsx 的 thumbOf()（本人头像路径）一直是对的，这里补上同一套解析。
    // 其余两个合法前缀 store/ 与 photo_ 目前没有任何消费方，语义未知 ——
    // 不猜、不拼 URL，保持落回 fallback（拼一个必 404 的图比首字更糟）。
    if (path.startsWith("assets/")) {
      const id = path.slice("assets/".length).trim();
      if (id !== "") return { kind: "mediaId", id, version: input.avatarVersion ?? 1 };
    }
  }
  if (input.personaId) {
    return { kind: "bundled", key: input.personaId };
  }
  return undefined;
}

// Project-bound assets generated for the five Proxy AI accounts. The visible
// AI badge is rendered by surfaces rather than embedded into a photographic
// portrait, so it stays readable in every crop and accessibility context.
//
// NOTE: Metro bundler requires static require() — keep the table literal
// inside the switch below (still statically analyzable). Lazy + try/catch:
// unit tests run in plain node where bundled images do not exist, and a
// missing asset must degrade to a fallback, never crash a surface.
// New bundled assets go here; check-media-pipeline.mjs forbids asset
// require() tables anywhere else.
// MEDIA-PIPELINE-001: 新代码统一从这里 require 打包 logo，不再在各个
// surface 里各开一行——check-media-pipeline.mjs 只放行存量（HEAD 已有的
// 行），新增的裸 require() 会被拦。跟 getBundledPhoto 一样包 try/catch：
// 这俩现在被 asset-sources.test.ts 传递 import 到，单测跑在纯 node 环境，
// 裸的顶层 require(png) 在这里会被测试环境的转译器当成语法错误炸掉整个
// 测试文件（之前 me-profile-components.tsx 里的同款裸 require 从没被任何
// 测试 import 到，所以这个坑一直没露出来）。
function loadOtterLogo(): AssetImageSource | undefined {
  try {
    return require("../../assets/otter-logo.png") as AssetImageSource;
  } catch {
    return undefined;
  }
}
export const OTTER_LOGO = loadOtterLogo();

// FACET-LOGO-001: 参考稿 docs/design/references/Proxy_COMPLETE_FiveRoot_FACET_v11.html
// 的 .facetEntryLogo（黄黑对半分、中间白圆+四角星的正牌 FACET 标）——之前
// me.tsx 的 FACET 行用的是通用 "spark" 图标，跟原始设计的专属标不是一个东西。
function loadFacetLogo(): AssetImageSource | undefined {
  try {
    return require("../../assets/facet-logo.png") as AssetImageSource;
  } catch {
    return undefined;
  }
}
export const FACET_LOGO = loadFacetLogo();

function getBundledPhoto(key: string): AssetImageSource | undefined {
  try {
    switch (key) {
      case "ai_001": return require("../../assets/ai-personas/photos/ai_001.png") as AssetImageSource;
      case "ai_002": return require("../../assets/ai-personas/photos/ai_002.png") as AssetImageSource;
      case "ai_003": return require("../../assets/ai-personas/photos/ai_003.png") as AssetImageSource;
      case "ai_004": return require("../../assets/ai-personas/photos/ai_004.png") as AssetImageSource;
      case "ai_005": return require("../../assets/ai-personas/photos/ai_005.png") as AssetImageSource;
      default: return undefined;
    }
  } catch {
    return undefined;
  }
}

export function aiPersonaBundledPhoto(personaId: string): AssetImageSource | undefined {
  return getBundledPhoto(personaId) ?? getBundledPhoto("ai_001");
}
