// author-avatar.ts — 帖文作者头像映射 (MEDIA-PIPELINE-001).
//
// 之前动态只认本人头像，其余一律首字 fallback —— AI 账号明明有照片资产
// 也显示字母。映射规则收归此处，渲染只消费结果：
//   本人(+真头像) → 本人头像；AGENT → 账号照片；AI_NATIVE → 人像注册表；
//   mock creator 真人账号 → 该账号头像资产；其余 → 首字。
//   图片 source 一律经 asset-sources 解析。

import { aiPersonaBundledPhoto, avatarPathToInput, resolveAssetSource, type AssetImageSource } from "./asset-sources";

// AVATAR-OTHER-HUMAN-001（2026-09-20，P0）：Linh 在首页「真人推荐」显示真头像，
// 在动态里却是黑底首字——首页读的是这批 mock creator 账号在服务端真实存在的
// 头像资产（identity.profiles.avatar_path，见 IDENTITY-ID-001 / mockidentity
// 包），动态这条管线完全没查过它，任何非本人/非 AI 的作者一律落到首字兜底。
//
// 这份表是 apps/api-go/internal/mockidentity/identity.go 里
// CreatorFacetKeys/AccountIDForFacetKey/AvatarAssetIDForFacetKey 三个函数的
// 客户端镜像（服务端目前没有把作者头像放进 FeedPostSchema，这是短期在客户端
// 补的对照表，长期应该是服务端直接把 authorAvatar 下发，不用客户端猜）。
// recommend-fixtures.ts 的 ACCOUNT_AVATAR_ASSET 是同一份数据的另一份镜像
// （用首页 fixture id `u_linh` 当 key，覆盖的人也少两个）——真正的账号 id
// 前缀是 `user_mockcreator_`，跟这里保持一致才能覆盖"这人在动态里发帖"这条路。
const MOCK_CREATOR_ACCOUNT_PREFIX = "user_mockcreator_";
const MOCK_CREATOR_FACET_KEYS = new Set(["linh", "mai", "an", "thao", "yen", "minh", "trang", "hana", "nam"]);

function mockCreatorAvatarAssetId(authorId: string): string | undefined {
  if (!authorId.startsWith(MOCK_CREATOR_ACCOUNT_PREFIX)) return undefined;
  const key = authorId.slice(MOCK_CREATOR_ACCOUNT_PREFIX.length);
  if (!MOCK_CREATOR_FACET_KEYS.has(key)) return undefined;
  return `ma_creator_${key}_portrait_v1`;
}

export type AvatarAuthor = {
  authorType: string;
  authorId: string;
};

export type AvatarAccount = {
  accountId: string;
  personaId: string;
  avatarPath: string;
  avatarMediaAssetId?: string | undefined;
  avatarVersion?: number | undefined;
};

// AVATAR-OTHER-HUMAN-002 (2026-09-21): 其他**真人**作者的真实账号。
//
// 为什么不能复用 AvatarAccount：那个类型的 personaId 是必填的（AI 账号靠它取
// 打包人像），真人没有 personaId，塞一个空串当哨兵会让「AI 账号」这个语义糊掉。
//
// 数据来自 ProfileClient.getProfile(accountId)（identity.profiles.avatar_path，
// 真实格式 `assets/<mediaAssetId>`）。服务端契约 FeedPostSchema 没有头像字段，
// 所以只能客户端按 accountId 补查 —— 长期方向是服务端直接把 authorAvatar 下发。
// 不重复存 accountId：Map 的 key 就是账号 id。
export type AvatarHumanAccount = {
  avatarPath: string;
  avatarVersion?: number | undefined;
};

export type AuthorAvatar =
  | { kind: "image"; source: AssetImageSource }
  | { kind: "initial"; letter: string };

export type AuthorAvatarOptions = {
  baseUrl: string;
  viewerAccountId?: string | undefined;
  viewerAvatarUri?: string | undefined;
  /** 本人帖子直接传入的头像 source（优先级高于 profileStore 解析），确保与个人主页一致。 */
  avatarSource?: number | { uri: string } | undefined;
  /** AI 账号表（accountId → 账号），动态按需加载后传入。 */
  aiAccountsById?: ReadonlyMap<string, AvatarAccount> | undefined;
  /** 真人作者表（accountId → 账号），动态按需加载后传入。优先级高于写死的 mock creator 表。 */
  humanAvatarsById?: ReadonlyMap<string, AvatarHumanAccount> | undefined;
  /** 首字 fallback 用名（已解析的展示名）。 */
  displayName: string;
};

export function resolveAuthorAvatar(author: AvatarAuthor, opts: AuthorAvatarOptions): AuthorAvatar {
  if (opts.viewerAccountId && author.authorId === opts.viewerAccountId && (opts.viewerAvatarUri || opts.avatarSource)) {
    const source = opts.avatarSource ?? (opts.viewerAvatarUri ? { uri: opts.viewerAvatarUri } : undefined);
    if (source !== undefined) return { kind: "image", source };
  }
  if (author.authorType === "AGENT" && opts.aiAccountsById) {
    const account = opts.aiAccountsById.get(author.authorId);
    if (account) {
      const input = avatarPathToInput(account);
      if (input) {
        const source = resolveAssetSource(input, { baseUrl: opts.baseUrl });
        if (source !== undefined) return { kind: "image", source };
      }
      const bundled = aiPersonaBundledPhoto(account.personaId);
      if (bundled !== undefined) return { kind: "image", source: bundled };
    }
  }
  if (author.authorType === "AI_NATIVE") {
    const bundled = aiPersonaBundledPhoto(author.authorId);
    if (bundled !== undefined) return { kind: "image", source: bundled };
  }
  // AVATAR-OTHER-HUMAN-002: 其他真人作者的真实头像（identity.profiles.avatar_path）。
  // 放在写死的 mock creator 表**之前** —— 服务端数据比客户端猜的准，而且那张表
  // 已经漂移过一次（客户端有 `trang`，服务端没有这一行 profile）。
  if (opts.humanAvatarsById) {
    const human = opts.humanAvatarsById.get(author.authorId);
    if (human) {
      const input = avatarPathToInput({ avatarPath: human.avatarPath, avatarVersion: human.avatarVersion });
      if (input) {
        const source = resolveAssetSource(input, { baseUrl: opts.baseUrl });
        if (source !== undefined) return { kind: "image", source };
      }
    }
  }
  // AVATAR-OTHER-HUMAN-001: mock creator 真人账号（Linh 等）发的帖，用该账号
  // 在服务端真实存在的头像资产——不是本人、不是 AI，但也不该落到首字兜底。
  const mockCreatorAssetId = mockCreatorAvatarAssetId(author.authorId);
  if (mockCreatorAssetId) {
    const source = resolveAssetSource({ kind: "mediaId", id: mockCreatorAssetId }, { baseUrl: opts.baseUrl });
    if (source !== undefined) return { kind: "image", source };
  }
  const letter = (opts.displayName.trim().charAt(0) || "?").toUpperCase();
  return { kind: "initial", letter };
}
