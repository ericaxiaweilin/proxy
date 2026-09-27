import { describe, it, expect } from "vitest";
import { loadStoreOptions } from "./my-store-options";
import type { BusinessClient } from "./business-client";

type FakeAccount = { id: string; name: string; status: string };
type FakeStore = { id: string; name: string };

function fakeBusiness(input: {
  accounts?: FakeAccount[];
  accountsThrow?: boolean;
  storesByAccount?: Record<string, FakeStore[]>;
  failingAccounts?: string[];
}): BusinessClient {
  return {
    listMyAccounts: async () => {
      if (input.accountsThrow) throw new Error("accounts unavailable");
      return input.accounts ?? [];
    },
    listStores: async (businessId: string) => {
      if ((input.failingAccounts ?? []).includes(businessId)) throw new Error("stores unavailable");
      return input.storesByAccount?.[businessId] ?? [];
    },
  } as unknown as BusinessClient;
}

describe("loadStoreOptions", () => {
  it("only lists stores belonging to ACTIVE accounts", async () => {
    const business = fakeBusiness({
      accounts: [
        { id: "biz_a", name: "A", status: "ACTIVE" },
        { id: "biz_b", name: "B", status: "SUSPENDED" },
      ],
      storesByAccount: { biz_a: [{ id: "store_a", name: "甲店" }], biz_b: [{ id: "store_b", name: "乙店" }] },
    });
    const result = await loadStoreOptions(business);
    expect(result.rows).toEqual([{ id: "store_a", name: "甲店" }]);
    expect(result.failed).toBe(false);
  });

  it("flattens stores across several active accounts, in account order", async () => {
    const business = fakeBusiness({
      accounts: [
        { id: "biz_a", name: "A", status: "ACTIVE" },
        { id: "biz_b", name: "B", status: "ACTIVE" },
      ],
      storesByAccount: {
        biz_a: [{ id: "store_a1", name: "甲一" }, { id: "store_a2", name: "甲二" }],
        biz_b: [{ id: "store_b1", name: "乙一" }],
      },
    });
    const result = await loadStoreOptions(business);
    expect(result.rows.map((row) => row.id)).toEqual(["store_a1", "store_a2", "store_b1"]);
    expect(result.failed).toBe(false);
  });

  // 关键：一个账号读失败不许把别的账号的店一起丢掉。丢店比报错更糟 ——
  // 用户会以为自己的店没了，然后去重复建店。
  it("keeps the stores it could read when one account fails, and flags the failure", async () => {
    const business = fakeBusiness({
      accounts: [
        { id: "biz_a", name: "A", status: "ACTIVE" },
        { id: "biz_b", name: "B", status: "ACTIVE" },
      ],
      storesByAccount: { biz_a: [{ id: "store_a1", name: "甲一" }], biz_b: [{ id: "store_b1", name: "乙一" }] },
      failingAccounts: ["biz_a"],
    });
    const result = await loadStoreOptions(business);
    expect(result.rows.map((row) => row.id)).toEqual(["store_b1"]);
    expect(result.failed).toBe(true);
  });

  // 「读不出来」和「你确实没有店」必须分得开 —— 这两条断言就是那条纪律。
  it("reports failed when the account list itself cannot be read", async () => {
    const result = await loadStoreOptions(fakeBusiness({ accountsThrow: true }));
    expect(result.rows).toEqual([]);
    expect(result.failed).toBe(true);
  });

  it("reports success with no rows when the person genuinely has no stores", async () => {
    const result = await loadStoreOptions(fakeBusiness({ accounts: [{ id: "biz_a", name: "A", status: "ACTIVE" }] }));
    expect(result.rows).toEqual([]);
    expect(result.failed).toBe(false);
  });
});
