// author-avatar.ts — 帖文作者头像映射 (MEDIA-PIPELINE-001).
//
// 之前动态只认本人头像，其余一律首字 fallback —— AI 账号明明有照片资产
// 也显示字母。映射规则收归此处，渲染只消费结果：
//   本人(+真头像) → 本人头像；AGENT → 账号照片；AI_NATIVE → 人像注册表；
//   其余 → 首字。图片 source 一律经 asset-sources 解析。

import { aiPersonaBundledPhoto, avatarPathToInput, resolveAssetSource, type AssetImageSource } from "./asset-sources";

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
  const letter = (opts.displayName.trim().charAt(0) || "?").toUpperCase();
  return { kind: "initial", letter };
}
