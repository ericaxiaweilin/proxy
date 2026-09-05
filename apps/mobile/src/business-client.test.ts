import { describe, it, expect } from "vitest";
import { BusinessClient } from "./business-client";
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
      refreshExpiresAt: "2099-10-25T00:00:00Z",
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
            accounts: [{ id: "biz_1", name: "Bonsaidon", status: "ACTIVE" }],
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

  it("rejects session with serverSession: false", async () => {
    const store = makeStore();
    await writeSession(store, { serverSession: false });
    const client = new BusinessClient({
      secureSessionStore: store,
      authClient: { request: async () => ({ status: 200, json: async () => ({}) }) },
    });
    await expect(client.listMyAccounts()).rejects.toThrow(/real sign-in/);
  });
});
