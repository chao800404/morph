// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createMorphReader } from "./client";
import { createMorph, MorphError, type MorphFetch } from "./index";
import type { MorphMediaUrls } from "./urls";

/**
 * The two media URL modes, on the one reader every entry builds on.
 *
 * `createMorph` (the external entry) is `"absolute"`; `@morph/sdk/start` (the
 * hosted entry) is `"relative"` (start/index.test.ts checks that end). Each
 * mode is part of its entry's contract (README.md, "Media URL mode").
 */
const BASE = "https://content.example.com";
const MEDIA = "/_storefront-media/abc?version=assets%2Fx.png";
const ASSET = "/api/store/assets/11111111-1111-1111-1111-111111111111";
const ASSET_2 = "/api/store/assets/22222222-2222-2222-2222-222222222222";

const CONTEXT = {
  storeId: "store_1",
  storefrontId: "sf_1",
  salesChannelId: "sc_1",
  regionId: null,
  currencyCode: null,
  automaticTaxes: false,
  isTaxInclusive: false,
  countryCode: null,
  localeCode: null,
};

const ITEM = {
  id: "prod_1",
  title: "Linen shirt",
  handle: "linen-shirt",
  subtitle: null,
  description: null,
  thumbnailUrl: ASSET,
  collectionId: null,
  collectionTitle: null,
  updatedAt: "2026-10-16T00:00:00.000Z",
};

const PRODUCT = {
  ...ITEM,
  assets: [{ id: "a1", name: "front", url: ASSET }],
  options: [],
  variants: [
    {
      id: "v1",
      title: "S",
      sku: null,
      allowBackorder: false,
      availableQuantity: 3,
      optionValueIds: [],
      assets: [{ id: "a2", name: "back", url: ASSET_2 }],
      price: null,
    },
  ],
};

/** Slots with media at every depth the reader walks, and strings it must not touch. */
const SLOTS = {
  hero: {
    image: MEDIA,
    gallery: [MEDIA, "https://cdn.example/x.png", { src: ASSET }],
    nested: { deeper: [{ poster: "/_storefront-media/def" }] },
    link: { href: "/collections/all" },
    themeFile: "/images/local.png",
    heading: "/ is not a URL here",
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const service: MorphFetch = async (input) => {
  const url = new URL(input);
  if (url.pathname === "/_morph/content") {
    return json({ slots: SLOTS, hiddenSlots: ["footer"] });
  }
  if (url.pathname === "/api/store/products") {
    return json({
      products: [ITEM],
      context: CONTEXT,
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
  }
  return json({ product: PRODUCT, context: CONTEXT });
};

async function readAll(mediaUrls: MorphMediaUrls) {
  const reader = createMorphReader(
    { baseUrl: BASE, fetch: service },
    { mediaUrls },
  );
  return {
    page: await reader.pages.get("/"),
    list: await reader.products.list(),
    one: await reader.products.get("linen-shirt"),
  };
}

describe("media URL modes", () => {
  it('"absolute" makes both Morph prefixes absolute against the content origin, at every depth', async () => {
    const { page, list, one } = await readAll("absolute");
    expect(page.hero).toEqual({
      image: BASE + MEDIA,
      gallery: [
        BASE + MEDIA,
        "https://cdn.example/x.png",
        { src: BASE + ASSET },
      ],
      nested: { deeper: [{ poster: BASE + "/_storefront-media/def" }] },
      link: { href: "/collections/all" },
      themeFile: "/images/local.png",
      heading: "/ is not a URL here",
    });
    expect(page._hidden).toEqual(["footer"]);
    expect(list.products[0]!.thumbnailUrl).toBe(BASE + ASSET);
    expect(one?.product.thumbnailUrl).toBe(BASE + ASSET);
    expect(one?.product.assets[0]!.url).toBe(BASE + ASSET);
    expect(one?.product.variants[0]!.assets[0]!.url).toBe(BASE + ASSET_2);
  });

  it('"relative" leaves every value exactly as Morph sent it, at every depth', async () => {
    const { page, list, one } = await readAll("relative");
    expect(page).toEqual({ ...SLOTS, _hidden: ["footer"] });
    expect(list.products).toEqual([ITEM]);
    expect(one?.product).toEqual(PRODUCT);
    // Nothing of the content origin reaches a value.
    expect(JSON.stringify([page, list, one])).not.toContain(BASE);
  });

  it("createMorph is the absolute mode, unchanged", async () => {
    const reader = createMorph({ baseUrl: BASE, fetch: service });
    const absolute = await readAll("absolute");
    expect(await reader.pages.get("/")).toEqual(absolute.page);
    expect(await reader.products.list()).toEqual(absolute.list);
    expect(await reader.products.get("linen-shirt")).toEqual(absolute.one);
  });

  it("only the URL step differs: both modes refuse and check the same way", async () => {
    for (const mediaUrls of ["absolute", "relative"] as const) {
      const reader = (fetch: MorphFetch) =>
        createMorphReader({ baseUrl: BASE, fetch }, { mediaUrls });
      await expect(
        reader(async () =>
          json({ slots: { _hidden: {} }, hiddenSlots: [] }),
        ).pages.get("/"),
        mediaUrls,
      ).rejects.toMatchObject({ code: "reserved_slot" });
      await expect(
        reader(async () => json({ slots: [] })).pages.get("/"),
        mediaUrls,
      ).rejects.toMatchObject({ code: "invalid_response" });
      await expect(
        reader(
          async () => new Response("Not Found", { status: 404 }),
        ).products.list(),
        mediaUrls,
      ).rejects.toMatchObject({ code: "content_not_found" });
      expect(() =>
        createMorphReader({ baseUrl: "not a url" }, { mediaUrls }),
      ).toThrow(MorphError);
      // A parsed `__proto__` key stays a key in either mode.
      const page = await reader(
        async () =>
          new Response(
            '{"slots":{"hero":{"__proto__":{"polluted":true}}},"hiddenSlots":[]}',
          ),
      ).pages.get("/");
      expect(Object.getPrototypeOf(page.hero)).toBe(Object.prototype);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    }
  });

  it("refuses a mode no entry defines", () => {
    expect(() =>
      createMorphReader(
        { baseUrl: BASE },
        { mediaUrls: "public" as MorphMediaUrls },
      ),
    ).toThrow(TypeError);
  });
});
