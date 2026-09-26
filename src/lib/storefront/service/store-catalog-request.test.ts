import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreContextDTO } from "../dto/store-context.dto";
const mocks = vi.hoisted(() => ({
  listProducts: vi.fn(),
  findProductByHandle: vi.fn(),
  findPublishedAsset: vi.fn(),
  get: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({
  env: { R2_BUCKET: { get: mocks.get } },
}));
vi.mock("../dal/store-catalog.dal", () => ({ storeCatalogDal: mocks }));
import { handleStoreCatalogGet } from "./store-catalog-request";
const context: StoreContextDTO = {
  storeId: "store",
  storefrontId: "sf",
  salesChannelId: "allowed-channel",
  regionId: "region",
  currencyCode: "usd",
  automaticTaxes: false,
  isTaxInclusive: false,
  countryCode: null,
  localeCode: null,
};
const request = (path: string, method = "GET") =>
  new Request("https://shop.example/api/store/" + path, { method });
describe("shared storefront catalog reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listProducts.mockResolvedValue({ products: [], total: 25 });
    mocks.findProductByHandle.mockResolvedValue(null);
  });
  it("uses only server-resolved scope and bounds pages", async () => {
    const result = await handleStoreCatalogGet(
      request("products?page=2&limit=12&salesChannelId=other"),
      context,
    );
    expect(mocks.listProducts).toHaveBeenCalledWith({
      salesChannelId: "allowed-channel",
      query: undefined,
      page: 2,
      limit: 12,
      sortOrder: "desc",
    });
    expect(await result?.json()).toMatchObject({
      products: [],
      pagination: { total: 25, totalPages: 3, page: 2 },
    });
  });
  it.each([
    "products?limit=101",
    "products?page=-1",
    "products?page=10001",
    "products/%E0%A4%A",
    "products/a%2Fb",
    "products/a/b",
  ])("rejects malformed request %s before DAL access", async (path) => {
    expect((await handleStoreCatalogGet(request(path), context))?.status).toBe(
      400,
    );
    expect(mocks.listProducts).not.toHaveBeenCalled();
    expect(mocks.findProductByHandle).not.toHaveBeenCalled();
  });
  it("does not distinguish unavailable products from missing products", async () => {
    expect(
      (await handleStoreCatalogGet(request("products/hidden"), context))
        ?.status,
    ).toBe(404);
    expect(mocks.findProductByHandle).toHaveBeenCalledWith(
      "hidden",
      "allowed-channel",
      "usd",
      "region",
    );
  });
  it("never reads R2 for an asset outside the public channel", async () => {
    mocks.findPublishedAsset.mockResolvedValue(null);
    expect(
      (
        await handleStoreCatalogGet(
          request("assets/6550fe95-9fb0-4008-b837-962da1b449d7"),
          context,
        )
      )?.status,
    ).toBe(404);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("is read-only and does not route admin endpoints", async () => {
    expect(
      (await handleStoreCatalogGet(request("products", "POST"), context))
        ?.status,
    ).toBe(405);
    expect(
      await handleStoreCatalogGet(request("admin/users"), context),
    ).toBeNull();
    expect(mocks.listProducts).not.toHaveBeenCalled();
  });

  it("shows an SVG inline only when it passed the current rules, and isolates it either way", async () => {
    const assetId = "6550fe95-9fb0-4008-b837-962da1b449d7";
    mocks.findPublishedAsset.mockResolvedValue({
      id: assetId,
      url: `/assets/${assetId}.svg`,
    });
    const svgObject = (customMetadata: Record<string, string>) => ({
      body: "<svg/>",
      httpEtag: '"e"',
      customMetadata,
      writeHttpMetadata: (headers: Headers) =>
        headers.set("content-type", "image/svg+xml"),
    });

    const serve = async (customMetadata: Record<string, string>) => {
      mocks.get.mockResolvedValue(svgObject(customMetadata));
      return (await handleStoreCatalogGet(
        request(`assets/${assetId}`),
        context,
      ))!;
    };

    const current = await serve({ svgValidatorVersion: "1" });
    expect(current.headers.get("content-disposition")).toBe("inline");
    expect(current.headers.get("content-security-policy")).toContain("sandbox");

    // Checked by the string rules before the parser: a download until re-checked.
    const legacy = await serve({ svgValidated: "true" });
    expect(legacy.headers.get("content-disposition")).toBe("attachment");
    expect(legacy.headers.get("content-security-policy")).toContain("sandbox");
    expect(legacy.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
