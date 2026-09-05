import { describe, expect, it } from "vitest";
import { merchantMarketIdFromStores } from "./business-client";

describe("merchant Creator market source", () => {
  it("MERCHANT-CREATOR-LIVE-002 derives market from the merchant store address", () => {
    expect(merchantMarketIdFromStores([{ address: "Quận 1, Hồ Chí Minh" }])).toBe("hcm");
    expect(merchantMarketIdFromStores([{ address: "Tây Hồ, Hà Nội" }])).toBe("hn");
    expect(merchantMarketIdFromStores([{ address: "Bắc Ninh" }])).toBe("bn");
  });

  it("uses the explicit current Bonsaidon Hanoi fallback when no canonical market exists", () => {
    expect(merchantMarketIdFromStores([])).toBe("hn");
  });
});
