import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";
import { commandErrorMessage } from "./command-error-message";

export interface MerchantOperatingHome {
  businessId: string;
  generatedAt: string;
  outcome: { windowDays: number; orderCount: number; grossMinor: number; newCustomers: number; returningCustomers: number };
  operatingPulse: { state: "EMPTY" | "ACTIVE"; storeCount: number; memberCount: number; freshness: string };
  demandSupply: { state: "INSUFFICIENT_SIGNAL" | "SUPPLY_EXCESS" | "BALANCED" | "DEMAND_RISING" | "CAPACITY_TIGHT" | "OVER_CAPACITY_RISK"; confidence: number; privacyThresholdPassed: boolean; reason: string };
  forecast: { status: "UNAVAILABLE" | "AVAILABLE"; confidence: number; version: number; assumptions: string[] };
  bestNextDecision: { kind: "NO_ACTION" | "LOW_PEAK_FILL" | "STOP_TRAFFIC" | "SCENE_ADJUSTMENT" | "MENU_ADJUSTMENT" | "BENEFIT" | "CREATOR" | "ACTIVITY" | "PARTNER_COLLAB" | "RECOVERY"; title: string; reason: string; requiresApproval: boolean };
  // source: MERCHANT-SIGNAL-SEED-001 —— MEASURED=实测，SEED_TEST=种入的测试数据。
  // 页面据此打「测试数据」标记，不让测试数字冒充算出来的经营信号。
  aggregatedDemand?: { totalMatchingDemand: number; confirmedArrivals: number; highProbabilityArrivals: number; confidence: number; recordedAt: string; source?: string };
  sceneSupply?: { storeId: string; sceneId: string; currentCapacityPct: number; forecastCapacityPct: number; acceptingTraffic: boolean; confidence: number; recordedAt: string; source?: string };
}

// STORE-PHOTO-CAT-001：category environment（环境）| menu（菜品）。
export interface StorePhoto {
  id: string;
  storeId: string;
  businessId: string;
  uploadedBy: string;
  assetPath: string;
  caption: string;
  sortOrder: number;
  mediaAssetId: string;
  category?: string | undefined;
  createdAt: string;
}
export interface StoreProduct {
  id: string;
  storeId: string;
  businessId: string;
  name: string;
  description: string;
  priceMinor: number;
  currency: string;
  category: string;
  scene: string;
  photoAssetPath: string;
  mediaAssetId: string;
  available: boolean;
  // MENU-HOT-001：商家亲手标的 HOT（默认 false）。
  isHot: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// MERCHANT-ACCOUNT-AVATAR-001: 店主头像指针 → 可渲染 URI。identity.profiles
// 落库值是远端指针（如 assets/<mediaId>），与个人主页同一张图；只认远端指针、
// 服务端路径、http(s) 三种形状，其他一律回 undefined 走渐变 fallback ——
// 拼一半的坏 URL 不许进 Image。纯函数放这里（不放 tsx）就是为了能直测。
export function merchantAvatarUri(pointer: string | undefined, baseUrl: string): string | undefined {
  const id = (pointer ?? "").trim();
  if (!id) return undefined;
  if (id.startsWith("assets/")) {
    const mediaId = id.slice("assets/".length).trim();
    return mediaId ? `${baseUrl}/v1/media/thumb/${encodeURIComponent(mediaId)}` : undefined;
  }
  if (id.startsWith("/")) return `${baseUrl}${id}`;
  if (/^https?:\/\//.test(id)) return id;
  return undefined;
}

export type StoreAmenities = {
  wifi?: string;
  smoking?: string;
  acTempC?: number;
  power?: string;
  quiet?: string;
  seating?: string;
};

export type StoreLinesWire = {
  storeId: string;
  logoAssetPath: string;
  description: string;
  hoursJson: string;
  contactPhone: string;
  contactEmail: string;
  // STORE-STATS-001：对接人姓名（跟电话配对，空 = 没填）。
  contactName?: string;
  // STORE-EDIT-V2-001：店铺公告与社媒。服务端一直发这两个字段（migration 159），
  // 契约里却没有 —— 于是 UI 只能靠本地复制一份窄类型去读它，写回去时又漏了 payload。
  announcement?: string;
  socials?: Record<string, string>;
  updatedAt: string;
} & StoreAmenities;

export type BusinessStoreWire = {
  id: string;
  businessId: string;
  name: string;
  address: string;
  // STORE-STATS-001：店铺品类（店主自填，空 = 没填）。
  category?: string;
  status: string;
  // 入驻时间（建店行创建时间）。
  createdAt?: string;
};

export class BusinessClient {
  private sequence = 0;
  public constructor(
    private readonly input: {
      authClient: { request(path: string, init: { method: "POST"; body: unknown }): Promise<TransportResponse> };
      secureSessionStore: SecureSessionStore;
      now?: () => Date;
    },
  ) {}

  public async createAccount(name: string): Promise<{ businessId: string }> {
    const body = this.body(await this.command("CreateBusinessAccount", { type: "BusinessAccount", id: "new" }, { name }));
    return { businessId: requiredString(body, "businessId") };
  }

  public async listMyAccounts(): Promise<Array<{ id: string; name: string; status: string; avatarPath?: string }>> {
    const body = this.body(await this.command("ListMyBusinessAccounts", { type: "BusinessAccount", id: "mine" }, {}));
    if (!Array.isArray(body.accounts)) throw new Error("business accounts malformed");
    // MERCHANT-ACCOUNT-AVATAR-001: avatarPath 是店主 identity profile 的落库指针
    // （如 assets/<mediaId>），服务端 LEFT JOIN 带出；缺席/空串一律归一成
    // undefined，调用方画 fallback。只认字符串，别把非字符串透传给 Image。
    return (body.accounts as Array<{ id: string; name: string; status: string; avatarPath?: unknown }>).map((account) => ({
      id: account.id,
      name: account.name,
      status: account.status,
      ...(typeof account.avatarPath === "string" && account.avatarPath ? { avatarPath: account.avatarPath } : {}),
    }));
  }

  public async addMember(businessId: string, userId: string, role?: string): Promise<void> {
    await this.command("AddBusinessMember", { type: "BusinessAccount", id: businessId }, { businessId, userId, role });
  }

  public async createStore(businessId: string, name: string, address: string): Promise<{ storeId: string }> {
    const body = this.body(await this.command("CreateBusinessStore", { type: "Store", id: "new" }, { businessId, name, address }));
    return { storeId: requiredString(body, "storeId") };
  }

  public async listStores(businessId: string): Promise<BusinessStoreWire[]> {
    const body = this.body(await this.command("ListBusinessStores", { type: "BusinessAccount", id: businessId }, { businessId }));
    if (!Array.isArray(body.stores)) throw new Error("business stores malformed");
    return body.stores as BusinessStoreWire[];
  }

  public async getStore(storeId: string): Promise<BusinessStoreWire> {
    const body = this.body(await this.command("GetBusinessStore", { type: "Store", id: storeId }, { storeId }));
    const store = body.store as BusinessStoreWire;
    if (!store?.id) throw new Error("business store not found");
    return store;
  }

  // STORE-STATS-001：改店铺品类（店主自填，空 = 清除）。
  public async setStoreCategory(storeId: string, category: string): Promise<BusinessStoreWire> {
    const body = this.body(await this.command("SetStoreCategory", { type: "Store", id: storeId }, { storeId, category }));
    const store = body.store as BusinessStoreWire;
    if (!store?.id) throw new Error("business store category update malformed");
    return store;
  }

  public async addStorePhoto(input: {
    storeId: string;
    assetPath: string;
    caption?: string;
    sortOrder?: number;
    mediaAssetId?: string;
    // STORE-PHOTO-CAT-001：environment（环境）| menu（菜品），不传按 environment。
    category?: string;
  }): Promise<StorePhoto> {
    const body = this.body(await this.command("AddStorePhoto", { type: "Store", id: input.storeId }, {
      storeId: input.storeId,
      assetPath: input.assetPath,
      caption: input.caption ?? "",
        sortOrder: input.sortOrder ?? 0,
        mediaAssetId: input.mediaAssetId ?? "",
        category: input.category ?? "environment",
    }));
    const photo = body.photo as StorePhoto | undefined;
    if (!photo?.id) throw new Error("store photo create response malformed");
    return photo;
  }

  public async listStorePhotos(storeId: string): Promise<StorePhoto[]> {
    const body = this.body(await this.command("ListStorePhotos", { type: "Store", id: storeId }, { storeId }));
    if (!Array.isArray(body.photos)) throw new Error("store photos malformed");
    return body.photos as StorePhoto[];
  }

  public async deleteStorePhoto(storeId: string, photoId: string): Promise<void> {
    await this.command("DeleteStorePhoto", { type: "Store", id: storeId }, { storeId, photoId });
  }

  // STORE-AMENITIES-001: 门店设施属性（商家自填）。与服务端 StoreLines 对齐：
  // 空=没填；wifi/smoking/power/quiet/seating 走封闭词表，acTempC 是整数温度
  // （0=没填）。读出来缺字段的老数据按没填处理，不编默认值。
  public async upsertStoreLines(input: {
    storeId: string;
    logoAssetPath?: string;
    description?: string;
    hoursJson?: string;
    contactPhone?: string;
    contactEmail?: string;
    // STORE-STATS-001：对接人姓名。
    contactName?: string;
    wifi?: string;
    smoking?: string;
    acTempC?: number;
    power?: string;
    quiet?: string;
    seating?: string;
    // STORE-EDIT-V2-001：公告 + 店铺社媒。
    announcement?: string;
    socials?: Record<string, string>;
  }): Promise<StoreLinesWire> {
    const body = this.body(await this.command("UpsertStoreLines", { type: "Store", id: input.storeId }, {
      storeId: input.storeId,
      logoAssetPath: input.logoAssetPath ?? "",
      description: input.description ?? "",
      hoursJson: input.hoursJson ?? "{}",
      contactPhone: input.contactPhone ?? "",
      contactEmail: input.contactEmail ?? "",
      contactName: input.contactName ?? "",
      wifi: input.wifi ?? "",
      smoking: input.smoking ?? "",
      acTempC: input.acTempC ?? 0,
      power: input.power ?? "",
      quiet: input.quiet ?? "",
      seating: input.seating ?? "",
      // STORE-EDIT-V2-001：公告与店铺社媒。这两个字段一度只在 input 类型里声明、
      // 没进 payload —— 类型对得上、UI 也传了，服务端却永远收到空值，而 Go 测试
      // 直连 service、移动端测试只 grep 源码，两边都绿（见 STORE-EDIT-V2-WIRE-001）。
      announcement: input.announcement ?? "",
      socials: input.socials ?? {},
    }));
    const lines = body.lines as StoreLinesWire;
    if (!lines?.storeId) throw new Error("store lines upsert response malformed");
    return lines;
  }

  public async getStoreLines(storeId: string): Promise<StoreLinesWire> {
    const body = this.body(await this.command("GetStoreLines", { type: "Store", id: storeId }, { storeId }));
    return body.lines as StoreLinesWire;
  }

  public async createProduct(input: {
    storeId: string;
    name: string;
    priceMinor: number;
    description?: string;
    category?: string;
    scene?: string;
    photoAssetPath?: string;
    mediaAssetId?: string;
    sortOrder?: number;
    isHot?: boolean;
  }): Promise<{ productId: string; product: StoreProduct }> {
    const body = this.body(await this.command("CreateStoreProduct", { type: "Store", id: input.storeId }, {
      storeId: input.storeId,
      name: input.name,
      priceMinor: input.priceMinor,
      description: input.description ?? "",
      category: input.category ?? "",
      scene: input.scene ?? "",
      photoAssetPath: input.photoAssetPath ?? "",
      mediaAssetId: input.mediaAssetId ?? "",
      sortOrder: input.sortOrder ?? 0,
    }));
    const product = body.product as StoreProduct | undefined;
    if (!product?.id) throw new Error("store product create response malformed");
    return { productId: requiredString(body, "productId"), product };
  }

  public async updateProduct(input: {
    productId: string;
    storeId: string;
    name: string;
    priceMinor: number;
    description?: string;
    category?: string;
    scene?: string;
    photoAssetPath?: string;
    mediaAssetId?: string;
    sortOrder?: number;
    isHot?: boolean;
  }): Promise<{ product: StoreProduct }> {
    const body = this.body(await this.command("UpdateStoreProduct", { type: "StoreProduct", id: input.productId }, {
      productId: input.productId,
      storeId: input.storeId,
      name: input.name,
      priceMinor: input.priceMinor,
      description: input.description ?? "",
      category: input.category ?? "",
      scene: input.scene ?? "",
      photoAssetPath: input.photoAssetPath ?? "",
      mediaAssetId: input.mediaAssetId ?? "",
      sortOrder: input.sortOrder ?? 0,
    }));
    const product = body.product as StoreProduct | undefined;
    if (!product?.id) throw new Error("store product update response malformed");
    return { product };
  }

  public async listProducts(storeId: string): Promise<StoreProduct[]> {
    const body = this.body(await this.command("ListStoreProducts", { type: "Store", id: storeId }, { storeId }));
    if (!Array.isArray(body.products)) throw new Error("store products malformed");
    return body.products as StoreProduct[];
  }

  // MENU-HOT-001：一键打标/摘标（只改标记）。
  public async setProductHot(productId: string, storeId: string, isHot: boolean): Promise<{ product: StoreProduct }> {
    const body = this.body(await this.command("SetProductHot", { type: "StoreProduct", id: productId }, {
      productId,
      storeId,
      isHot,
    }));
    const product = body.product as StoreProduct | undefined;
    if (!product?.id) throw new Error("store product hot response malformed");
    return { product };
  }

  public async setProductAvailability(productId: string, storeId: string, available: boolean): Promise<{ product: StoreProduct }> {
    const body = this.body(await this.command("SetProductAvailability", { type: "StoreProduct", id: productId }, {
      productId,
      storeId,
      available,
    }));
    const product = body.product as StoreProduct | undefined;
    if (!product?.id) throw new Error("store product availability response malformed");
    return { product };
  }

  public async listMemberDirectory(businessId: string): Promise<Array<{ businessId: string; userId: string; displayName: string; role: string; status: string; joinedAt: string }>> {
    const body = this.body(await this.command("ListMemberDirectory", { type: "BusinessAccount", id: businessId }, { businessId }));
    if (!Array.isArray(body.members)) throw new Error("member directory malformed");
    return body.members as Array<{ businessId: string; userId: string; displayName: string; role: string; status: string; joinedAt: string }>;
  }

  public async upsertMemberDirectory(input: {
    businessId: string;
    userId: string;
    displayName: string;
    role: string;
    status?: string;
  }): Promise<void> {
    await this.command("UpsertMemberDirectory", { type: "BusinessAccount", id: input.businessId }, {
      businessId: input.businessId,
      userId: input.userId,
      displayName: input.displayName,
      role: input.role,
      status: input.status ?? "ACTIVE",
    });
  }

  public async listSpendDaily(input: { businessId: string; sinceDays?: number }): Promise<{
    days: Array<{ businessId: string; bucketDate: string; orderCount: number; grossMinor: number; newCustomerCount: number; returningCustomerCount: number }>;
    totalGrossMinor: number;
    totalOrders: number;
    sinceDays: number;
  }> {
    const body = this.body(await this.command("ListSpendDaily", { type: "BusinessAccount", id: input.businessId }, {
      businessId: input.businessId,
      sinceDays: input.sinceDays ?? 30,
    }));
    return {
      days: (body.days as Array<{ businessId: string; bucketDate: string; orderCount: number; grossMinor: number; newCustomerCount: number; returningCustomerCount: number }>) ?? [],
      totalGrossMinor: (body.totalGrossMinor as number) ?? 0,
      totalOrders: (body.totalOrders as number) ?? 0,
      sinceDays: (body.sinceDays as number) ?? 30,
    };
  }

  public async getMerchantOperatingHome(businessId: string): Promise<MerchantOperatingHome> {
    const body = this.body(await this.command("GetMerchantOperatingHome", { type: "BusinessAccount", id: businessId }, { businessId }));
    const home = body.home as MerchantOperatingHome | undefined;
    if (!home?.businessId || !home.outcome || !home.operatingPulse || !home.demandSupply || !home.forecast || !home.bestNextDecision) {
      throw new Error("merchant operating home malformed");
    }
    return home;
  }

  public async upsertSpendDaily(input: {
    businessId: string;
    bucketDate: string;
    orderCount: number;
    grossMinor: number;
    newCustomerCount: number;
    returningCustomerCount: number;
  }): Promise<void> {
    await this.command("UpsertSpendDaily", { type: "BusinessAccount", id: input.businessId }, {
      businessId: input.businessId,
      bucketDate: input.bucketDate,
      orderCount: input.orderCount,
      grossMinor: input.grossMinor,
      newCustomerCount: input.newCustomerCount,
      returningCustomerCount: input.returningCustomerCount,
    });
  }

  private async command(commandType: string, target: { type: string; id: string }, payload: Record<string, unknown>): Promise<CommandResult> {
    const session = await this.requireSession();
    const next = (prefix: string) => `mobile_biz_${prefix}_${Date.now().toString(36)}_${(++this.sequence).toString(36)}`;
    const envelope = {
      commandId: next("command"),
      commandType,
      commandVersion: 1,
      actor: { type: "USER", id: session.userAccountId },
      principal: session.principal,
      target,
      idempotencyKey: next("idempotency"),
      authContext: { sessionId: session.auth.sessionId },
      purpose: "business",
      correlationId: next("correlation"),
      requestedAt: (this.input.now ?? (() => new Date()))().toISOString(),
      payload,
    };
    const response = await this.input.authClient.request(`/v1/commands/${commandType}`, { method: "POST", body: envelope });
    const result = parseCommandResult(await response.json());
    if (!result) throw new Error("business command malformed");
    if (result.outcome === "REJECTED") throw new Error(commandErrorMessage(result.error, "business rejected"));
    if (response.status < 200 || response.status >= 300) throw new Error(`unexpected business status: ${response.status}`);
    return result;
  }

  private async requireSession(): Promise<StoredSession & { principal: NonNullable<StoredSession["principal"]> }> {
    const session = await this.input.secureSessionStore.read();
    if (!session?.principal) throw new Error("authenticated principal required");
    if (session.serverSession === false) throw new Error("business actions require a real sign-in (offline session cannot act)");
    if (session.signedOut === true) throw new OfflineFallbackSessionError();
    return session as StoredSession & { principal: NonNullable<StoredSession["principal"]> };
  }

  private body(result: CommandResult): Record<string, unknown> {
    if (!result.operationRef) return {};
    const value = JSON.parse(result.operationRef) as unknown;
    if (!value || typeof value !== "object") throw new Error("business payload malformed");
    return value as Record<string, unknown>;
  }
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value === "") throw new Error(`business payload missing ${key}`);
  return value;
}
