import { describe, expect, it } from "vitest";

import { resolveActiveMerchant, sortMenuForHome } from "./active-merchant";

// MERCHANT-ACTIVE-ACCOUNT-001（2026-10-04，用户：「商家-home 首页的招牌在售为什么还是空白，明明我的
// 测试账户完善了菜单与 hot 标志」）：两个商家账号，菜单加在 Three Beans（Cầu Giấy），首页却各自
// 默认列表第一个停在 Bắc Ninh。现在商家端共用一个当前账号，且首页读这个账号所有门店的菜单。
describe("MERCHANT-ACTIVE-ACCOUNT-001 当前商家账号", () => {
  it("记住的那家还在就用它，否则列表第一个", () => {
    expect(resolveActiveMerchant(["biz_bn", "biz_cg"], "biz_cg")).toBe("biz_cg");
    expect(resolveActiveMerchant(["biz_bn", "biz_cg"], "biz_gone")).toBe("biz_bn");
    expect(resolveActiveMerchant(["biz_bn"], undefined)).toBe("biz_bn");
    expect(resolveActiveMerchant([], "biz_cg")).toBeUndefined();
  });
});

describe("MERCHANT-ACTIVE-ACCOUNT-001 招牌与在售", () => {
  it("只要在售的，HOT 在前，其余保持店主排的顺序", () => {
    const items = [
      { id: "a", available: true, isHot: false },
      { id: "b", available: false, isHot: true },
      { id: "c", available: true, isHot: true },
      { id: "d", available: true },
    ];
    expect(sortMenuForHome(items).map((i) => i.id)).toEqual(["c", "a", "d"]);
  });
});
