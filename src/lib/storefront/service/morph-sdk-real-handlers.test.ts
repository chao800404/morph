// @vitest-environment node
/**
 * The SDK reading Morph's own handlers, in process.
 *
 * The SDK's unit tests use answers written by hand; these use the answers
 * Morph actually produces. Each read goes through `createMorph`'s `fetch` into
 * `StorefrontProductionService.handleRequest`, the merchant-host entry, which
 * resolves the host, then serves `/_morph/content` itself or hands
 * `/api/store/products` to the real `handleStoreCatalogGet`.
 *
 * Stand-ins, and only these: the host resolver's data ports, the content
 * ports and the catalog DAL return fixed rows, as the existing tests of each
 * handler do; the store context is fixed where `src/server.ts` resolves it
 * from the database. No network is used.
 *
 * Node, not jsdom: the SDK refuses to read pages where `window` and
 * `document` exist, and these are server-side reads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMorph,
  MorphError,
  type MorphProduct,
  type MorphProductListItem,
  type MorphStoreContext,
} from "../../../../packages/morph-sdk/src/index";
import type {
  StoreProductDetailDTO,
  StoreProductListItemDTO,
} from "../dto/store-catalog.dto";
import type { StoreCatalogContextDTO } from "../dto/store-context.dto";

const mocks = vi.hoisted(() => ({
  listProducts: vi.fn(),
  findProductByHandle: vi.fn(),
  findPublishedAsset: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: { R2_BUCKET: { get: vi.fn() } } }));
vi.mock("../dal/store-catalog.dal", () => ({ storeCatalogDal: mocks }));

import { handleStoreCatalogGet } from "./store-catalog-request";
import type { StorefrontHostResolverDeps } from "./storefront-host-resolver";
import { StorefrontProductionService } from "./storefront-production.service";

const HOST = "shop.example.com";
const BASE = `https://${HOST}`;
const ASSET_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

const context: StoreCatalogContextDTO = {
  storeId: "store_1",
  storefrontId: "sf_1",
  salesChannelId: "sc_1",
  regionId: "region_1",
  currencyCode: "usd",
  automaticTaxes: false,
  isTaxInclusive: false,
  countryCode: null,
  localeCode: null,
};

const listItem: StoreProductListItemDTO = {
  id: "prod_1",
  title: "Linen shirt",
  handle: "linen-shirt",
  subtitle: null,
  description: "Washed linen.",
  thumbnailUrl: `/api/store/assets/${ASSET_ID}`,
  collectionId: null,
  collectionTitle: null,
  updatedAt: "2026-10-16T00:00:00.000Z",
};

const detail: StoreProductDetailDTO = {
  ...listItem,
  assets: [
    { id: ASSET_ID, name: "front", url: `/api/store/assets/${ASSET_ID}` },
  ],
  options: [],
  variants: [
    {
      id: "var_1",
      title: "M",
      sku: null,
      allowBackorder: false,
      availableQuantity: 3,
      optionValueIds: [],
      assets: [],
      price: {
        currencyCode: "usd",
        amount: 4800,
        originalAmount: 4800,
        priceListType: null,
      },
    },
  ],
};

function resolverDeps(release: "active" | "none"): StorefrontHostResolverDeps {
  return {
    domainDal: {
      findByHostname: async () => ({
        id: "dom_1",
        storefrontId: "sf_1",
        hostname: HOST,
        status: "active",
      }),
    },
    storefrontDalRef: {
      findActive: async () => ({ id: "sf_1", status: "published" }),
    },
    releaseDal: {
      getActive: async () =>
        release === "none"
          ? null
          : {
              id: "rel_1",
              themeId: "th_1",
              sourceRevisionId: "rev_1",
              themeBuildId: "bld_1",
              contentPublicationId: "pub_1",
            },
    },
    buildDal: {
      getBuildById: async () => ({
        id: "bld_1",
        storefrontId: "sf_1",
        themeId: "th_1",
        status: "succeeded",
        artifactPrefix: "themes/th_1/builds/bld_1",
        manifestJson: { artifactEntry: "preview/index.html", files: [] },
      }),
    },
  } as unknown as StorefrontHostResolverDeps;
}

const contentPorts = {
  getPublishedDocument: vi.fn(
    async ({ templateType }: { templateType: string }) =>
      templateType === "layout"
        ? {
            sections: [
              { id: "site-header", enabled: true, props: { title: "Shop" } },
            ],
          }
        : templateType === "index"
          ? {
              sections: [
                {
                  id: "hero",
                  enabled: true,
                  props: {
                    heading: "Published",
                    image: {
                      source: "asset",
                      mediaType: "image",
                      assetId: ASSET_ID,
                      url: "assets/hero.png",
                    },
                  },
                },
                { id: "newsletter", enabled: false, props: { title: "x" } },
              ],
            }
          : null,
  ),
};

function morphFor(release: "active" | "none") {
  const service = new StorefrontProductionService({
    runtime: { kind: "local-direct", handle: vi.fn() } as never,
    resolverDeps: resolverDeps(release),
    contentPorts: contentPorts as never,
    catalogHandler: (request) => handleStoreCatalogGet(request, context),
  });
  const requests: string[] = [];
  const morph = createMorph({
    baseUrl: BASE,
    fetch: async (input, init) => {
      requests.push(input);
      return service.handleRequest(new Request(input, init));
    },
  });
  return { morph, requests };
}

async function failure(promise: Promise<unknown>): Promise<MorphError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(MorphError);
    return error as MorphError;
  }
  throw new Error("expected a MorphError");
}

/** Compile-time only: the server's value must be assignable to the SDK's type. */
function fits<T>(_value: T): void {}

describe("the SDK reads what Morph's handlers actually send", () => {
  beforeEach(() => {
    mocks.listProducts.mockReset();
    mocks.findProductByHandle.mockReset();
  });

  it("the server's DTOs fit the SDK's types", () => {
    fits<MorphProductListItem>(listItem);
    fits<MorphProduct>(detail);
    fits<MorphStoreContext>(context);
  });

  it("reads a published page from /_morph/content, with hidden sections named and media made absolute", async () => {
    const { morph, requests } = morphFor("active");

    const page = await morph.pages.get("/");

    expect(page).toEqual({
      "site-header": { title: "Shop" },
      hero: {
        heading: "Published",
        image: `${BASE}/_storefront-media/${ASSET_ID}?version=assets%2Fhero.png`,
      },
      _hidden: ["newsletter"],
    });
    expect(morph.pages.isHidden(page, "newsletter")).toBe(true);
    expect(requests).toEqual([`${BASE}/_morph/content?path=%2F`]);
  });

  it("gets the layout alone for a path with no document, as the service answers today", async () => {
    // Current behaviour, labelled as such: neither the service nor the SDK
    // can yet tell this from a page whose document is empty.
    const { morph } = morphFor("active");
    expect(await morph.pages.get("/no-document-here")).toEqual({
      "site-header": { title: "Shop" },
      _hidden: [],
    });
  });

  it("throws content_not_found when the host has no active release", async () => {
    const { morph } = morphFor("none");
    const error = await failure(morph.pages.get("/"));
    expect(error).toMatchObject({
      code: "content_not_found",
      resource: "page",
      status: 404,
    });
    expect(error.message).not.toContain(HOST);
  });

  it("lists products from the Store API with its pagination and absolute images", async () => {
    mocks.listProducts.mockResolvedValue({ products: [listItem], total: 25 });
    const { morph, requests } = morphFor("active");

    const result = await morph.products.list({
      q: "linen",
      page: 2,
      limit: 12,
      order: "asc",
    });

    expect(mocks.listProducts).toHaveBeenCalledWith({
      salesChannelId: "sc_1",
      query: "linen",
      page: 2,
      limit: 12,
      sortOrder: "asc",
    });
    expect(result.pagination).toEqual({
      page: 2,
      limit: 12,
      total: 25,
      totalPages: 3,
    });
    expect(result.context).toEqual(context);
    expect(result.products).toEqual([
      { ...listItem, thumbnailUrl: `${BASE}/api/store/assets/${ASSET_ID}` },
    ]);
    expect(requests).toEqual([
      `${BASE}/api/store/products?q=linen&page=2&limit=12&order=asc`,
    ]);
  });

  it("gets one product, and null for one the store does not have", async () => {
    mocks.findProductByHandle.mockImplementation(async (handle: string) =>
      handle === "linen-shirt" ? detail : null,
    );
    const { morph } = morphFor("active");

    const found = await morph.products.get("linen-shirt");
    expect(found?.product.variants[0]!.price?.amount).toBe(4800);
    expect(found?.product.assets[0]!.url).toBe(
      `${BASE}/api/store/assets/${ASSET_ID}`,
    );
    expect(await morph.products.get("not-sold-here")).toBeNull();
  });

  it("throws, not null, for a product read on a host with no active release", async () => {
    // The host lookup answers 404 too. Reading that as "no such product"
    // would hide that the store is not there at all.
    mocks.findProductByHandle.mockResolvedValue(detail);
    const { morph } = morphFor("none");
    const error = await failure(morph.products.get("linen-shirt"));
    expect(error).toMatchObject({
      code: "content_not_found",
      resource: "product",
      status: 404,
    });
    expect(mocks.findProductByHandle).not.toHaveBeenCalled();
  });
});
