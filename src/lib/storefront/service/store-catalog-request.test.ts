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
});
