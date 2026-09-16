import { describe, it, expect } from "vitest";
import { BusinessClient, merchantAvatarUri } from "./business-client";
import { InMemorySecureStorageDriver, OfflineFallbackSessionError, SecureSessionStore } from "./secure-session";

function makeStore(): SecureSessionStore {
  return new SecureSessionStore(new InMemorySecureStorageDriver());
}

async function writeSession(store: SecureSessionStore, overrides: Record<string, unknown> = {}): Promise<void> {
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
    ...overrides,
  });
}

function envelope(commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    commandId: "cmd_test",
    commandType,
    commandVersion: 1,
    actor: { type: "USER", id: "user_owner" },
    principal: { type: "PERSON", id: "principal_user_owner" },
    target,
    idempotencyKey: "idem_test",
    authContext: { sessionId: "sess_owner" },
    purpose: "business",
    correlationId: "corr_test",
    requestedAt: "2026-09-05T00:00:00Z",
    outcome: "ACCEPTED",
    operationRef: JSON.stringify(payload),
    eventRefs: [],
  };
}

describe("BusinessClient", () => {
  // R18.x: STORE-PHOTO-001 mobile half.
  // Merchant '相册 48 张' tile in me.tsx was a non-clickable View before
  // this commit. The mobile client now round-trips real photos through
  // ListMyAccounts + ListBusinessStores + ListStorePhotos, then a press
  // on '+ 上传照片' calls AddStorePhoto. The tripwire confirms the
  // full chain unwraps the server JSON envelope and exposes the
  // photoId / assetPath / uploadedBy the surface needs to render.
  it("lists accounts, stores, and photos in chain", async () => {
    const store = makeStore();
    await writeSession(store);
    const client = new BusinessClient({
      secureSessionStore: store,
      authClient: { request: async (path) => {
        if (path.endsWith("/ListMyBusinessAccounts")) {
          return { status: 200, json: async () => envelope("ListMyBusinessAccounts", { type: "BusinessAccount", id: "mine" }, {
            accounts: [{ id: "biz_1", name: "Bonsaidon", status: "ACTIVE", avatarPath: "assets/ma_avatar1" }],
          }) };
        }
        if (path.endsWith("/ListBusinessStores")) {
          return { status: 200, json: async () => envelope("ListBusinessStores", { type: "BusinessAccount", id: "biz_1" }, {
            stores: [{ id: "store_1", businessId: "biz_1", name: "West Lake", address: "Tay Ho", status: "ACTIVE" }],
          }) };
        }
        if (path.endsWith("/ListStorePhotos")) {
          return { status: 200, json: async () => envelope("ListStorePhotos", { type: "Store", id: "store_1" }, {
            photos: [{ id: "photo_1", storeId: "store_1", businessId: "biz_1", uploadedBy: "user_owner", assetPath: "store/westlake-1.jpg", caption: "front", sortOrder: 1, createdAt: "2026-09-05T10:00:00Z" }],
            count: 1,
          }) };
        }
        return { status: 500, json: async () => ({ error: "unexpected" }) };
      } },
    });
    const accounts = await client.listMyAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.name).toBe("Bonsaidon");
    // MERCHANT-ACCOUNT-AVATAR-001: 店主头像指针必须透传（缺席/空串归一成缺席）。
    expect(accounts[0]?.avatarPath).toBe("assets/ma_avatar1");
    const stores = await client.listStores("biz_1");
    expect(stores).toHaveLength(1);
    expect(stores[0]?.name).toBe("West Lake");
    const photos = await client.listStorePhotos("store_1");
    expect(photos).toHaveLength(1);
    expect(photos[0]?.uploadedBy).toBe("user_owner");
    expect(photos[0]?.assetPath).toBe("store/westlake-1.jpg");
  });

  // R18.x: STORE-PHOTO-001 mobile upload.
  // The '+ 上传照片' button uses AddStorePhoto, with the asset_path
  // already constrained to the 'store/' prefix on the client side
  // (see retainStorePhoto in expo-composer-draft-store). The client
  // throws if the server response is malformed so the surface can
  // surface a real error.
  it("addStorePhoto round-trips a real photo", async () => {
    const store = makeStore();
    await writeSession(store);
    const client = new BusinessClient({
      secureSessionStore: store,
      authClient: { request: async (path) => {
        if (path.endsWith("/AddStorePhoto")) {
          return { status: 200, json: async () => envelope("AddStorePhoto", { type: "Store", id: "store_1" }, {
            photo: { id: "photo_99", storeId: "store_1", businessId: "biz_1", uploadedBy: "user_owner", assetPath: "store/sp_99.jpg", caption: "", sortOrder: 7, createdAt: "2026-09-05T10:05:00Z" },
          }) };
        }
        return { status: 500, json: async () => ({ error: "unexpected" }) };
      } },
    });
    const photo = await client.addStorePhoto({ storeId: "store_1", assetPath: "store/sp_99.jpg", sortOrder: 7 });
    expect(photo.id).toBe("photo_99");
    expect(photo.uploadedBy).toBe("user_owner");
    expect(photo.sortOrder).toBe(7);
  });

  // R18.x: STORE-LINES-001 mobile half.
  // '店铺信息' tile in me.tsx was a non-clickable View; now the
  // surface calls getStoreLines on mount and upsertStoreLines on save.
  it("upsertStoreLines and getStoreLines round-trip", async () => {
    const store = makeStore();
    await writeSession(store);
    const client = new BusinessClient({
      secureSessionStore: store,
      authClient: { request: async (path) => {
        if (path.endsWith("/UpsertStoreLines")) {
          return { status: 200, json: async () => envelope("UpsertStoreLines", { type: "Store", id: "store_1" }, {
            lines: { storeId: "store_1", logoAssetPath: "assets/bonsaidon-logo.png", description: "海鲜自助", hoursJson: "{\"mon\":\"10-22\"}", contactPhone: "+84 24 0000 1111", contactEmail: "hi@bonsaidon.vn", updatedAt: "2026-09-05T10:10:00Z" },
          }) };
        }
        if (path.endsWith("/GetStoreLines")) {
          return { status: 200, json: async () => envelope("GetStoreLines", { type: "Store", id: "store_1" }, {
            lines: { storeId: "store_1", logoAssetPath: "assets/bonsaidon-logo.png", description: "海鲜自助", hoursJson: "{\"mon\":\"10-22\"}", contactPhone: "+84 24 0000 1111", contactEmail: "hi@bonsaidon.vn", updatedAt: "2026-09-05T10:10:00Z" },
          }) };
        }
        return { status: 500, json: async () => ({ error: "unexpected" }) };
      } },
    });
    const upserted = await client.upsertStoreLines({ storeId: "store_1", logoAssetPath: "assets/bonsaidon-logo.png", description: "海鲜自助", hoursJson: "{\"mon\":\"10-22\"}", contactPhone: "+84 24 0000 1111", contactEmail: "hi@bonsaidon.vn" });
    expect(upserted.logoAssetPath).toBe("assets/bonsaidon-logo.png");
    const read = await client.getStoreLines("store_1");
    expect(read.description).toBe("海鲜自助");
  });

  it("rejects signed-out session with OfflineFallbackSessionError", async () => {
    const store = makeStore();
    await writeSession(store, { signedOut: true });
    const client = new BusinessClient({
      secureSessionStore: store,
      authClient: { request: async () => ({ status: 200, json: async () => ({}) }) },
    });
    await expect(client.listMyAccounts()).rejects.toBeInstanceOf(OfflineFallbackSessionError);
  });

  it("reads a conservative merchant operating-home decision", async () => {
    const store = makeStore();
    await writeSession(store);
    const client = new BusinessClient({
      secureSessionStore: store,
      authClient: { request: async () => ({ status: 200, json: async () => envelope("GetMerchantOperatingHome", { type: "BusinessAccount", id: "biz_1" }, {
        home: {
          businessId: "biz_1", generatedAt: "2026-09-06T00:00:00Z",
          outcome: { windowDays: 7, orderCount: 3, grossMinor: 450000000, newCustomers: 1, returningCustomers: 2 },
          operatingPulse: { state: "ACTIVE", storeCount: 1, memberCount: 1, freshness: "ROLLING_7_DAYS" },
          demandSupply: { state: "INSUFFICIENT_SIGNAL", confidence: 0, privacyThresholdPassed: false, reason: "signals unavailable" },
          forecast: { status: "UNAVAILABLE", confidence: 0, version: 0, assumptions: [] },
          bestNextDecision: { kind: "NO_ACTION", title: "暂不主动加流量", reason: "信号不足", requiresApproval: false },
        },
      }) }) },
    });
    const home = await client.getMerchantOperatingHome("biz_1");
    expect(home.outcome.orderCount).toBe(3);
    expect(home.demandSupply.confidence).toBe(0);
    expect(home.forecast.status).toBe("UNAVAILABLE");
    expect(home.bestNextDecision.kind).toBe("NO_ACTION");
  });

  it("rejects session with serverSession: false", async () => {
    const store = makeStore();
    await writeSession(store, { serverSession: false });
    const client = new BusinessClient({
      secureSessionStore: store,
      authClient: { request: async () => ({ status: 200, json: async () => ({}) }) },
    });
    await expect(client.listMyAccounts()).rejects.toThrow(/real sign-in/);
  });

  // PRODUCT-001 mobile half: 店铺菜单 / 价格表经 BusinessClient 走真命令，
  // 创建/列表/更新/上下架 round-trip，不走本地假菜单。
  it("creates, lists, updates, and toggles store products", async () => {
    const store = makeStore();
    await writeSession(store);
    const product = {
      id: "prod_1", storeId: "store_1", businessId: "biz_1", name: "Ca Phe Sua",
      description: "condensed milk", priceMinor: 29000, currency: "VND",
      photoAssetPath: "", available: true, sortOrder: 0,
      createdAt: "2026-09-06T00:00:00Z", updatedAt: "2026-09-06T00:00:00Z",
    };
    const client = new BusinessClient({
      secureSessionStore: store,
      authClient: { request: async (path) => {
        if (path.endsWith("/CreateStoreProduct")) {
          return { status: 200, json: async () => envelope("CreateStoreProduct", { type: "Store", id: "store_1" }, {
            productId: "prod_1", product,
          }) };
        }
        if (path.endsWith("/ListStoreProducts")) {
          return { status: 200, json: async () => envelope("ListStoreProducts", { type: "Store", id: "store_1" }, {
            products: [product],
          }) };
        }
        if (path.endsWith("/UpdateStoreProduct")) {
          return { status: 200, json: async () => envelope("UpdateStoreProduct", { type: "StoreProduct", id: "prod_1" }, {
            product: { ...product, name: "Ca Phe Sua Da", priceMinor: 32000 },
          }) };
        }
        if (path.endsWith("/SetProductAvailability")) {
          return { status: 200, json: async () => envelope("SetProductAvailability", { type: "StoreProduct", id: "prod_1" }, {
            product: { ...product, available: false },
          }) };
        }
        return { status: 500, json: async () => ({ error: "unexpected" }) };
      } },
    });
    const made = await client.createProduct({ storeId: "store_1", name: "Ca Phe Sua", priceMinor: 29000 });
    expect(made.productId).toBe("prod_1");
    const listed = await client.listProducts("store_1");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.priceMinor).toBe(29000);
    const renamed = await client.updateProduct({ productId: "prod_1", storeId: "store_1", name: "Ca Phe Sua Da", priceMinor: 32000 });
    expect(renamed.product.name).toBe("Ca Phe Sua Da");
    const hidden = await client.setProductAvailability("prod_1", "store_1", false);
    expect(hidden.product.available).toBe(false);
  });

  // PHOTO-001 mobile half: 相册/菜单照片带 mediaAssetId 走真命令，
  // surface 才能拼出远端 thumb URL（不再只存本地路径）。
  it("round-trips mediaAssetId on photos and products", async () => {
    const store = makeStore();
    await writeSession(store);
    const client = new BusinessClient({
      secureSessionStore: store,
      authClient: { request: async (path) => {
        if (path.endsWith("/AddStorePhoto")) {
          return { status: 200, json: async () => envelope("AddStorePhoto", { type: "Store", id: "store_1" }, {
            photo: { id: "photo_1", storeId: "store_1", businessId: "biz_1", uploadedBy: "user_owner", assetPath: "store/sp_1.jpg", caption: "", sortOrder: 0, mediaAssetId: "ma_photo_1", createdAt: "2026-09-06T00:00:00Z" },
          }) };
        }
        if (path.endsWith("/CreateStoreProduct")) {
          return { status: 200, json: async () => envelope("CreateStoreProduct", { type: "Store", id: "store_1" }, {
            productId: "prod_9",
            product: { id: "prod_9", storeId: "store_1", businessId: "biz_1", name: "Banh Mi", description: "", priceMinor: 25000, currency: "VND", photoAssetPath: "", mediaAssetId: "ma_dish_9", available: true, sortOrder: 0, createdAt: "2026-09-06T00:00:00Z", updatedAt: "2026-09-06T00:00:00Z" },
          }) };
        }
        return { status: 500, json: async () => ({ error: "unexpected" }) };
      } },
    });
    const photo = await client.addStorePhoto({ storeId: "store_1", assetPath: "store/sp_1.jpg", mediaAssetId: "ma_photo_1" });
    expect(photo.mediaAssetId).toBe("ma_photo_1");
    const made = await client.createProduct({ storeId: "store_1", name: "Banh Mi", priceMinor: 25000, mediaAssetId: "ma_dish_9" });
    expect(made.product.mediaAssetId).toBe("ma_dish_9");
  });
});

describe("MERCHANT-ACCOUNT-AVATAR-001 merchantAvatarUri", () => {
  const base = "http://mac.local:4100";
  it("resolves the remote pointer to the same thumb as the personal page", () => {
    expect(merchantAvatarUri("assets/ma_74ad", base)).toBe(`${base}/v1/media/thumb/ma_74ad`);
  });
  it("passes server paths and http(s) through, rejects everything else", () => {
    expect(merchantAvatarUri("/v1/media/thumb/x", base)).toBe(`${base}/v1/media/thumb/x`);
    expect(merchantAvatarUri("https://cdn.example/a.png", base)).toBe("https://cdn.example/a.png");
    expect(merchantAvatarUri("avatar-123.jpg", base)).toBeUndefined();
    expect(merchantAvatarUri("assets/", base)).toBeUndefined();
    expect(merchantAvatarUri("", base)).toBeUndefined();
    expect(merchantAvatarUri(undefined, base)).toBeUndefined();
  });
});
