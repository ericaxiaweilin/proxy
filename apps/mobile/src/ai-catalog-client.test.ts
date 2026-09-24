import { describe, expect, it } from "vitest";
import { fetchAiCatalog, parseAiCatalog, sortCatalogVendors } from "./ai-catalog-client";

// AI-MANAGE-007：AI 目录从服务端读，坏条目丢掉不猜，一个厂商都没有就算失败。
const svg = '<svg viewBox="0 0 24 24"></svg>';
const raw = {
  version: "v1",
  imageBilling: { payer: "user", freeImagesPerMonth: 10, freeVendor: "platform_default", priceNotice: "自费" },
  chatBilling: { payer: "platform", pricePer1kTokens: null },
  vendors: [
    { id: "platform_default", name: "平台默认", desc: "", logoSvg: svg, logoBg: "#1a1a1a", pinned: true, recommend: true, rank: {}, models: [] },
    { id: "openai", name: "OpenAI", desc: "", logoSvg: svg, logoBg: "#10a37f", rank: { quality: 9.3, price: 0.011, popular: 10 },
      models: [{ name: "GPT-Image-1", price: { label: "$0.04-0.17/张", currency: "USD", min: 0.04, max: 0.17, unit: "image" }, tag: "NEW" }, { name: "坏的" }] },
    { id: "google", name: "Google", desc: "", logoSvg: svg, logoBg: "#fff", rank: { quality: 9.6, price: 0.02, popular: 9.2 }, models: [] },
    { id: "", name: "没 id" },
    { id: "nologo", name: "没 logo", logoSvg: "" },
  ],
};

describe("AI catalog client (AI-MANAGE-007)", () => {
  it("parses prices, logos and the free quota, dropping malformed entries", () => {
    const catalog = parseAiCatalog(raw);
    expect(catalog.vendors.map((v) => v.id)).toEqual(["platform_default", "openai", "google"]);
    expect(catalog.vendors[1]!.models).toEqual([{ name: "GPT-Image-1", price: { label: "$0.04-0.17/张", currency: "USD", min: 0.04, max: 0.17, unit: "image" }, tag: "NEW" }]);
    expect(catalog.imageBilling.freeImagesPerMonth).toBe(10);
    expect(() => parseAiCatalog({ version: "v", vendors: [] })).toThrow();
  });

  it("keeps the pinned platform default first and sorts the rest", () => {
    const catalog = parseAiCatalog(raw);
    expect(sortCatalogVendors(catalog.vendors, "quality").map((v) => v.id)).toEqual(["platform_default", "google", "openai"]);
    expect(sortCatalogVendors(catalog.vendors, "price").map((v) => v.id)).toEqual(["platform_default", "openai", "google"]);
    expect(sortCatalogVendors(catalog.vendors, "popular").map((v) => v.id)).toEqual(["platform_default", "openai", "google"]);
  });

  it("reads GET /v1/ai/catalog and fails loudly on a non-200", async () => {
    const ok = await fetchAiCatalog({ request: async (path) => ({ status: path === "/v1/ai/catalog" ? 200 : 404, json: async () => raw }) });
    expect(ok.version).toBe("v1");
    await expect(fetchAiCatalog({ request: async () => ({ status: 503, json: async () => ({}) }) })).rejects.toThrow();
  });
});
