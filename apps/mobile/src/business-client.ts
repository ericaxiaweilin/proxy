import type { CommandResult } from "@proxy/contracts";
import type { TransportResponse } from "./auth-client";
import { parseCommandResult } from "./login-client";
import type { SecureSessionStore, StoredSession } from "./secure-session";
import { OfflineFallbackSessionError } from "./secure-session";

export interface MerchantOperatingHome {
  businessId: string;
  generatedAt: string;
  outcome: { windowDays: number; orderCount: number; grossMinor: number; newCustomers: number; returningCustomers: number };
  operatingPulse: { state: "EMPTY" | "ACTIVE"; storeCount: number; memberCount: number; freshness: string };
  demandSupply: { state: "INSUFFICIENT_SIGNAL" | "SUPPLY_EXCESS" | "BALANCED" | "DEMAND_RISING" | "CAPACITY_TIGHT" | "OVER_CAPACITY_RISK"; confidence: number; privacyThresholdPassed: boolean; reason: string };
  forecast: { status: "UNAVAILABLE" | "AVAILABLE"; confidence: number; version: number; assumptions: string[] };
  bestNextDecision: { kind: "NO_ACTION" | "LOW_PEAK_FILL" | "STOP_TRAFFIC" | "SCENE_ADJUSTMENT" | "MENU_ADJUSTMENT" | "BENEFIT" | "CREATOR" | "ACTIVITY" | "PARTNER_COLLAB" | "RECOVERY"; title: string; reason: string; requiresApproval: boolean };
  aggregatedDemand?: { totalMatchingDemand: number; confirmedArrivals: number; highProbabilityArrivals: number; confidence: number; recordedAt: string };
  sceneSupply?: { storeId: string; sceneId: string; currentCapacityPct: number; forecastCapacityPct: number; acceptingTraffic: boolean; confidence: number; recordedAt: string };
}

export interface StorePhoto {
  id: string;
  storeId: string;
  businessId: string;
  uploadedBy: string;
  assetPath: string;
  caption: string;
  sortOrder: number;
  mediaAssetId: string;
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
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

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

  public async listMyAccounts(): Promise<Array<{ id: string; name: string; status: string }>> {
    const body = this.body(await this.command("ListMyBusinessAccounts", { type: "BusinessAccount", id: "mine" }, {}));
    if (!Array.isArray(body.accounts)) throw new Error("business accounts malformed");
    return body.accounts as Array<{ id: string; name: string; status: string }>;
  }

  public async addMember(businessId: string, userId: string, role?: string): Promise<void> {
    await this.command("AddBusinessMember", { type: "BusinessAccount", id: businessId }, { businessId, userId, role });
  }

  public async createStore(businessId: string, name: string, address: string): Promise<{ storeId: string }> {
    const body = this.body(await this.command("CreateBusinessStore", { type: "Store", id: "new" }, { businessId, name, address }));
    return { storeId: requiredString(body, "storeId") };
  }

  public async listStores(businessId: string): Promise<Array<{ id: string; businessId: string; name: string; address: string; status: string }>> {
    const body = this.body(await this.command("ListBusinessStores", { type: "BusinessAccount", id: businessId }, { businessId }));
    if (!Array.isArray(body.stores)) throw new Error("business stores malformed");
    return body.stores as Array<{ id: string; businessId: string; name: string; address: string; status: string }>;
  }

  public async getStore(storeId: string): Promise<{ id: string; businessId: string; name: string; address: string; status: string }> {
    const body = this.body(await this.command("GetBusinessStore", { type: "Store", id: storeId }, { storeId }));
    const store = body.store as { id: string; businessId: string; name: string; address: string; status: string };
    if (!store?.id) throw new Error("business store not found");
    return store;
  }

  public async addStorePhoto(input: {
    storeId: string;
    assetPath: string;
    caption?: string;
    sortOrder?: number;
    mediaAssetId?: string;
  }): Promise<StorePhoto> {
    const body = this.body(await this.command("AddStorePhoto", { type: "Store", id: input.storeId }, {
      storeId: input.storeId,
      assetPath: input.assetPath,
      caption: input.caption ?? "",
      sortOrder: input.sortOrder ?? 0,
      mediaAssetId: input.mediaAssetId ?? "",
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

  public async upsertStoreLines(input: {
    storeId: string;
    logoAssetPath?: string;
    description?: string;
    hoursJson?: string;
    contactPhone?: string;
    contactEmail?: string;
  }): Promise<{ storeId: string; logoAssetPath: string; description: string; hoursJson: string; contactPhone: string; contactEmail: string; updatedAt: string }> {
    const body = this.body(await this.command("UpsertStoreLines", { type: "Store", id: input.storeId }, {
      storeId: input.storeId,
      logoAssetPath: input.logoAssetPath ?? "",
      description: input.description ?? "",
      hoursJson: input.hoursJson ?? "{}",
      contactPhone: input.contactPhone ?? "",
      contactEmail: input.contactEmail ?? "",
    }));
    const lines = body.lines as { storeId: string; logoAssetPath: string; description: string; hoursJson: string; contactPhone: string; contactEmail: string; updatedAt: string };
    if (!lines?.storeId) throw new Error("store lines upsert response malformed");
    return lines;
  }

  public async getStoreLines(storeId: string): Promise<{ storeId: string; logoAssetPath: string; description: string; hoursJson: string; contactPhone: string; contactEmail: string; updatedAt: string }> {
    const body = this.body(await this.command("GetStoreLines", { type: "Store", id: storeId }, { storeId }));
    return body.lines as { storeId: string; logoAssetPath: string; description: string; hoursJson: string; contactPhone: string; contactEmail: string; updatedAt: string };
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
    if (result.outcome === "REJECTED") throw new Error(result.error?.messageKey ?? result.error?.errorCode ?? "business rejected");
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
