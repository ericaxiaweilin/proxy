import { describe, expect, it } from "vitest";
import { MarketOpportunitySchema } from "@proxy/contracts";

// PUBLIC-NO-001：需求 / 邀约的编号来自服务端；契约必须声明它，否则 zod 会静默剥掉。
describe("PUBLIC-NO-001 server-issued opportunity number reaches the client", () => {
  const wire = {
    id: "opp_1", title: "周六城市同行", shortTitle: "同行", theme: "城市同行", date: "周六", time: "10:00", location: "西湖",
    price: "2,000,000₫", moneyFlow: "EARN", priceLabel: "完成后你可获得", owner: "你", ownerType: "PERSON", match: "", responses: 0,
    posted: "刚刚", skills: "中文", signal: "", signalClass: "", countdown: "", travel: 20, lens: ["NEARBY"], verified: false,
  };
  it("keeps the all-digit number and rejects a client-style PX code", () => {
    const parsed = MarketOpportunitySchema.safeParse({ ...wire, number: "2609290000001236" });
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
    expect(parsed.data.number).toBe("2609290000001236");
    expect(MarketOpportunitySchema.safeParse({ ...wire, number: "PX-N-260929-AB12" }).success).toBe(false);
  });
});
