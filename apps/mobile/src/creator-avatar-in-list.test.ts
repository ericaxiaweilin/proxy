import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// CREATOR-AVATAR-001（2026-10-01，用户「creator中心 creator list 不能只是文本list
// 要有头像啊」）
//
// 同一个 SupplierCandidate 数据（photos: string[]）在两个面里画法不一样：
// merchant-creator-recommendations 的横滑卡画头像；merchant-me-r21 的 Creator 经营
// 列表只把 photos.length 印成「到店 N 媒体」四个字 —— 商家挑 Creator 靠的是脸，
// 少了头像那一列就只是一份通讯录。
describe("CREATOR-AVATAR-001 Creator 列表要画头像，不能只有文字", () => {
  const me = readFileSync(fileURLToPath(new URL("./surfaces/merchant-me-r21-replacement.tsx", import.meta.url)), "utf8");
  const rail = readFileSync(fileURLToPath(new URL("./surfaces/merchant-creator-recommendations.tsx", import.meta.url)), "utf8");

  it("列表每一行都画照片", () => {
    // 出现在 visibleCreators.map 那一支里，而不是文件别处 —— 否则「文件里出现过
    // <Image>」这种恒真断言又会混进来。
    const listBranch = me.slice(me.indexOf('visibleCreators.map((creator) =>'));
    expect(listBranch).toContain("source={{ uri: avatarUri }}");
    expect(listBranch).toContain("styles.creatorAvatar");
  });

  it("没照片的人显示「待完善照片」，不拿图标或首字母假装有头像", () => {
    const listBranch = me.slice(me.indexOf('visibleCreators.map((creator) =>'));
    expect(listBranch).toContain("creatorAvatarMissing");
    expect(listBranch).toContain("待完善照片");
  });

  it("两个面共用同一个照片解析器，不各写一份", () => {
    // 各写一份的话，"为什么这边有图那边没有"会变成没法回答的问题。
    expect(rail).toContain("export function resolveCreatorPhoto");
    expect(me).toContain('import { MerchantCreatorRecommendations, resolveCreatorPhoto } from "./merchant-creator-recommendations";');
    expect(me).not.toMatch(/function resolveCreatorPhoto/);
  });

  it("用的是 photos[0]，且 photos 仍是这份数据的真实字段", () => {
    const listBranch = me.slice(me.indexOf('visibleCreators.map((creator) =>'));
    expect(listBranch).toContain("resolveCreatorPhoto(creator.photos[0])");
    // 数字还留着（那是"到店 N 媒体"），但不再**只**有数字。
    expect(listBranch).toContain("creator.photos.length");
  });

  it("头像用 expo-image，与横滑卡一致的缓存与过渡", () => {
    // react-native 的 Image 没有 cachePolicy / transition / recyclingKey ——
    // 写成那样 tsc 会报，也是"图标能显示但每次都重下"的原因。
    expect(me).toContain('import { Image } from "expo-image";');
    const listBranch = me.slice(me.indexOf('visibleCreators.map((creator) =>'));
    expect(listBranch).toContain('cachePolicy="memory-disk"');
    expect(listBranch).toContain("recyclingKey={`merchant-me-creator:${creator.agentId}`}");
  });
});
