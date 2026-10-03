import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { BusinessClient } from "./business-client";
import { InMemorySecureStorageDriver, SecureSessionStore } from "./secure-session";

// STORE-PHOTO-CAT-001（用户「照片上传没有区分店铺环境 / 菜单 / 店铺 logo」）：
// 相册上传必须带 category（environment | menu），店铺 logo 走 logoAssetPath、
// 菜品图走 product.mediaAssetId，本来就和相册是三条线。这里锁移动端一半：
function makeStore(): SecureSessionStore {
  return new SecureSessionStore(new InMemorySecureStorageDriver());
}

async function writeSession(store: SecureSessionStore): Promise<void> {
  await store.write({
    userAccountId: "user_owner",
    principal: { type: "INDIVIDUAL", id: "principal_user_owner" },
    auth: {
      sessionId: "sess_owner",
      userAccountId: "user_owner",
      principal: { type: "INDIVIDUAL", id: "principal_user_owner" },
      accessToken: "access",
      refreshToken: "refresh",
      accessExpiresAt: "2026-09-25T00:00:00Z",
      refreshExpiresAt: new Date(Date.now() + 2592000000).toISOString(),
      rotation: 1,
    },
  });
}

describe("STORE-PHOTO-CAT-001 相册上传带分类", () => {
  it("不传 category 默认按 environment 送", async () => {
    const store = makeStore();
    await writeSession(store);
    const captured: Array<Record<string, unknown>> = [];
    const photoWire = {
      id: "photo_1",
      storeId: "store_1",
      businessId: "biz_1",
      uploadedBy: "user_owner",
      assetPath: "store/sp_1.jpg",
      caption: "",
      sortOrder: 1,
      mediaAssetId: "ma_1",
      createdAt: "2026-10-03T00:00:00Z",
    };
    const client = new BusinessClient({
      secureSessionStore: store,
      authClient: {
        request: async (_path: string, init: { method: "POST"; body: unknown }) => {
          captured.push((init.body as { payload: Record<string, unknown> }).payload);
          return {
            status: 200,
            json: async () => ({
              commandId: "cmd_test",
              commandType: "AddStorePhoto",
              commandVersion: 1,
              actor: { type: "USER", id: "user_owner" },
              principal: { type: "PERSON", id: "principal_user_owner" },
              target: { type: "Store", id: "store_1" },
              idempotencyKey: "idem_test",
              authContext: { sessionId: "sess_owner" },
              purpose: "business",
              correlationId: "corr_test",
              requestedAt: "2026-10-03T00:00:00Z",
              outcome: "ACCEPTED",
              operationRef: JSON.stringify({ photo: photoWire }),
              eventRefs: [],
            }),
          };
        },
      },
    });
    await client.addStorePhoto({ storeId: "store_1", assetPath: "store/sp_1.jpg" });
    expect(captured[0]?.["category"]).toBe("environment");
    await client.addStorePhoto({ storeId: "store_1", assetPath: "store/sp_2.jpg", category: "menu" });
    expect(captured[1]?.["category"]).toBe("menu");
  });

  it("表单有环境/菜品选择器，列表行展示分类", () => {
    const ui = readFileSync(fileURLToPath(new URL("./surfaces/merchant-storefront.tsx", import.meta.url)), "utf8");
    expect(ui).toContain("photoCatByStore");
    expect(ui).toContain("店铺环境");
    expect(ui).toContain("菜单菜品");
    expect(ui).toContain("pickAndUploadPhoto(s.id, photoCatByStore[s.id]");
  });
});
