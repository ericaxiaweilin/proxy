import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./reality-scene-map.tsx", import.meta.url)), "utf8");

describe("SCENE-ACTION-MATERIALIZATION-001", () => {
  it("keeps the three scene exits on independent domain commands", () => {
    expect(source).toContain('"CreateInvitation"');
    expect(source).toContain('"PublishMarketOpportunity"');
    expect(source).toContain('"PublishActivity"');
    expect(source).toContain("对方接受后生成订单");
    expect(source).toContain("budgetMinor: inviteAmount");
    expect(source).toContain("给真人小美的报酬（VND）");
    expect(source).toContain('currency: "VND"');
    expect(source).toContain("等待真人候选报名");
    expect(source).toContain('price: "150,000₫"');
    expect(source).not.toContain('price: "150K"');
    expect(source).toContain("已进入“我的活动”");
  });

  it("reports scene action failures in human words and never orphans a scene silently", () => {
    // sendSceneCommand 抛的是服务端 messageKey；直接展示用户看不懂。
    // DIRECT_INVITE 两步走，第二步挂了场景已落库，必须明说。
    expect(source).toContain("sceneActionErrorMessage");
    expect(source).toContain("只有场景房主可以发邀请");
    expect(source).toContain("场景已创建但邀请未发出");
    expect(source).toContain("createdSceneId");
  });

  it("renders R27 scene media from the read model instead of placeholders", () => {
    expect(source).toContain("detail.heroImageUrl");
    expect(source).toContain("human.avatarUrl");
    expect(source).toContain("item.imageUrl");
    expect(source).toContain('cachePolicy="memory-disk"');
    expect(source).toContain('"这个 Scene 喝什么"');
    expect(source).toContain("detail.fullMenu");
    expect(source).toContain('"为什么"');
    expect(source).toContain("Reality Evidence · Scene Memory");
    expect(source).toContain("不生成到访、订单或履约证明");
  });

  it("carries the selected scene SKU into every real-world action", () => {
    expect(source).toContain("setSelectedMenuId(value.menu[0]?.id)");
    expect(source).toContain("menuItemId: menuItem?.id");
    expect(source).toContain("menuItemId: selectedMenuItem?.id");
    expect(source.match(/menuItemId: selectedMenuItem\?\.id/g)).toHaveLength(2);
  });
});
