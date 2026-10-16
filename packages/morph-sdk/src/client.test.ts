// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMorph, MorphError, type MorphFetch } from "./index";

const BASE = "https://shop.example.com";

type Call = { url: string; init: RequestInit };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain" },
  });
}

function fakeFetch(answer: (url: URL) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch: MorphFetch = async (url, init) => {
    calls.push({ url, init });
    return answer(new URL(url));
  };
  return { fetch, calls };
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
  thumbnailUrl: "/api/store/assets/11111111-1111-1111-1111-111111111111",
  collectionId: null,
  collectionTitle: null,
  updatedAt: "2026-10-16T00:00:00.000Z",
};

const PRODUCT = {
  ...ITEM,
  assets: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      name: "front",
      url: "/api/store/assets/11111111-1111-1111-1111-111111111111",
    },
  ],
  options: [],
  variants: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createMorph", () => {
  it.each([
    ["not a URL", "shop.example.com"],
    ["a path", "https://shop.example.com/store"],
    ["a trailing slash", "https://shop.example.com/"],
    ["a query", "https://shop.example.com?x=1"],
    ["credentials", "https://user:secret@shop.example.com"],
    ["another scheme", "ftp://shop.example.com"],
    ["no value", undefined],
  ])("refuses a base URL with %s", (_label, baseUrl) => {
    let error: unknown;
    try {
      createMorph({ baseUrl: baseUrl as string });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(MorphError);
    expect(error).toMatchObject({
      code: "invalid_content_origin",
      resource: null,
    });
    // The address is not repeated back, credentials included.
    expect((error as Error).message).not.toContain("secret");
    expect((error as Error).message).not.toContain("shop.example.com");
  });

  it("uses the global fetch when none is given", async () => {
    const global = vi.fn(async () => json({ slots: {}, hiddenSlots: [] }));
    vi.stubGlobal("fetch", global);
    await createMorph({ baseUrl: BASE }).pages.get("/");
    expect(global).toHaveBeenCalledTimes(1);
  });
});

describe("pages.get", () => {
  it("reads the published content of one path", async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({
        slots: { hero: { heading: "Hello" }, story: { body: "Text" } },
        hiddenSlots: ["newsletter"],
      }),
    );
    const morph = createMorph({ baseUrl: BASE, fetch });

    const page = await morph.pages.get("/pages/about us");

    expect(page).toEqual({
      hero: { heading: "Hello" },
      story: { body: "Text" },
      _hidden: ["newsletter"],
    });
    expect(morph.pages.isHidden(page, "newsletter")).toBe(true);
    expect(morph.pages.isHidden(page, "hero")).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      BASE + "/_morph/content?path=%2Fpages%2Fabout%20us",
    );
    expect(calls[0]!.init).toMatchObject({
      method: "GET",
      credentials: "omit",
    });
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("makes published media absolute and leaves every other string alone", async () => {
    const { fetch } = fakeFetch(() =>
      json({
        slots: {
          hero: {
            image: "/_storefront-media/abc?version=assets%2Fx.png",
            gallery: ["/_storefront-media/def", "https://cdn.example/x.png"],
            link: { href: "/collections/all" },
            themeFile: "/images/local.png",
            heading: "/ is not a URL here",
          },
        },
        hiddenSlots: [],
      }),
    );

    const page = await createMorph({ baseUrl: BASE, fetch }).pages.get("/");

    expect(page.hero).toEqual({
      image: BASE + "/_storefront-media/abc?version=assets%2Fx.png",
      gallery: [BASE + "/_storefront-media/def", "https://cdn.example/x.png"],
      link: { href: "/collections/all" },
      themeFile: "/images/local.png",
      heading: "/ is not a URL here",
    });
  });

  it("answers a path with no document of its own as Morph does, with what the layout holds", async () => {
    // Current behaviour, not the target: the service cannot yet say whether
    // the path has a document, so neither can the SDK.
    const { fetch } = fakeFetch(() =>
      json({ slots: { header: { title: "Shop" } }, hiddenSlots: [] }),
    );
    expect(
      await createMorph({ baseUrl: BASE, fetch }).pages.get("/no-such-page"),
    ).toEqual({ header: { title: "Shop" }, _hidden: [] });
  });

  it("keeps a parsed __proto__ key a key", async () => {
    const { fetch } = fakeFetch(
      () =>
        new Response(
          '{"slots":{"hero":{"__proto__":{"polluted":true}}},"hiddenSlots":[]}',
          { status: 200 },
        ),
    );
    const page = await createMorph({ baseUrl: BASE, fetch }).pages.get("/");
    expect(Object.getPrototypeOf(page.hero)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each([
    ["no leading slash", "about"],
    ["over 500 characters", "/" + "a".repeat(500)],
    ["not a string", 42],
  ])("refuses a path with %s before sending anything", async (_label, path) => {
    const { fetch, calls } = fakeFetch(() => json({}));
    const error = await failure(
      createMorph({ baseUrl: BASE, fetch }).pages.get(path as string),
    );
    expect(error).toMatchObject({ code: "invalid_path", resource: "page" });
    expect(calls).toHaveLength(0);
  });

  it("refuses to read a page in a browser, before sending anything", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    const { fetch, calls } = fakeFetch(() =>
      json({ slots: {}, hiddenSlots: [] }),
    );
    const error = await failure(
      createMorph({ baseUrl: BASE, fetch }).pages.get("/"),
    );
    expect(error).toMatchObject({
      code: "invalid_content_origin",
      resource: "page",
    });
    expect(calls).toHaveLength(0);
  });

  it.each([
    [
      "a host with no published store",
      () => text('No storefront is attached to "shop.example.com".', 404),
      "content_not_found",
      404,
    ],
    [
      "a release whose build is unavailable",
      () => text("Active release has no served build artifact.", 503),
      "store_error",
      503,
    ],
    [
      "a refused path",
      () => text("Invalid content path.", 400),
      "store_error",
      400,
    ],
    [
      "a body that is not JSON",
      () => text("<html>", 200),
      "invalid_response",
      200,
    ],
    ["JSON null", () => json(null), "invalid_response", 200],
    [
      "slots that are an array",
      () => json({ slots: [], hiddenSlots: [] }),
      "invalid_response",
      200,
    ],
    [
      "a hidden list that is not strings",
      () => json({ slots: {}, hiddenSlots: [1] }),
      "invalid_response",
      200,
    ],
    ["no hidden list", () => json({ slots: {} }), "invalid_response", 200],
    [
      "a slot named _hidden",
      () => json({ slots: { _hidden: {} }, hiddenSlots: [] }),
      "reserved_slot",
      200,
    ],
  ])(
    "throws instead of answering with empty content for %s",
    async (_label, answer, code, status) => {
      const { fetch } = fakeFetch(answer);
      const error = await failure(
        createMorph({ baseUrl: BASE, fetch }).pages.get("/"),
      );
      expect(error).toMatchObject({ code, resource: "page", status });
    },
  );

  it("reports an unreachable service without the address or the cause", async () => {
    const fetch: MorphFetch = async () => {
      throw new TypeError(
        "fetch failed: connect ECONNREFUSED https://shop.example.com/_morph/content?path=%2Fsecret",
      );
    };
    const error = await failure(
      createMorph({ baseUrl: BASE, fetch }).pages.get("/secret"),
    );
    expect(error).toMatchObject({
      code: "store_unreachable",
      resource: "page",
      status: null,
    });
    expect(error.message).not.toMatch(/shop\.example\.com|secret|ECONNREFUSED/);
    expect(error.cause).toBeUndefined();
  });

  it("reports a body that breaks off as unreachable", async () => {
    const fetch: MorphFetch = async () =>
      ({
        status: 200,
        ok: true,
        text: async () => {
          throw new Error("terminated");
        },
      }) as unknown as Response;
    const error = await failure(
      createMorph({ baseUrl: BASE, fetch }).pages.get("/"),
    );
    expect(error).toMatchObject({ code: "store_unreachable", status: 200 });
  });

  it("never puts the response body in the error", async () => {
    const { fetch } = fakeFetch(() =>
      text("internal: token=abc123 at /srv/app.js:10", 500),
    );
    const error = await failure(
      createMorph({ baseUrl: BASE, fetch }).pages.get("/"),
    );
    expect(error.message).not.toMatch(/token|abc123|srv/);
  });
});

describe("products.list", () => {
  it("lists products with pagination and absolute image URLs", async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({
        products: [ITEM],
        context: CONTEXT,
        pagination: { page: 2, limit: 12, total: 25, totalPages: 3 },
      }),
    );

    const result = await createMorph({ baseUrl: BASE, fetch }).products.list({
      q: "  linen ",
      page: 2,
      limit: 12,
      order: "asc",
    });

    expect(calls[0]!.url).toBe(
      BASE + "/api/store/products?q=linen&page=2&limit=12&order=asc",
    );
    expect(result.pagination).toEqual({
      page: 2,
      limit: 12,
      total: 25,
      totalPages: 3,
    });
    expect(result.context).toEqual(CONTEXT);
    expect(result.products[0]!.thumbnailUrl).toBe(
      BASE + "/api/store/assets/11111111-1111-1111-1111-111111111111",
    );
  });

  it.each([
    [undefined, "/api/store/products"],
    [{}, "/api/store/products"],
    [{ q: "   " }, "/api/store/products"],
    [{ page: 1 }, "/api/store/products?page=1"],
    [{ limit: 100 }, "/api/store/products?limit=100"],
    [{ page: 10_000 }, "/api/store/products?page=10000"],
    [{ order: "desc" as const }, "/api/store/products?order=desc"],
    [{ q: "a".repeat(200) }, "/api/store/products?q=" + "a".repeat(200)],
  ])("sends only the parameters given: %j", async (params, path) => {
    const { fetch, calls } = fakeFetch(() =>
      json({
        products: [],
        context: CONTEXT,
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      }),
    );
    const result = await createMorph({ baseUrl: BASE, fetch }).products.list(
      params,
    );
    expect(calls[0]!.url).toBe(BASE + path);
    // No results is an answer, not an error.
    expect(result.products).toEqual([]);
  });

  it.each([
    ["page 0", { page: 0 }],
    ["page over 10000", { page: 10_001 }],
    ["a fractional page", { page: 1.5 }],
    ["a page given as text", { page: "2" }],
    ["limit 0", { limit: 0 }],
    ["limit over 100", { limit: 101 }],
    ["an unknown order", { order: "price" }],
    ["a query over 200 characters", { q: "a".repeat(201) }],
    ["a query that is not text", { q: 5 }],
    ["a filter the API does not have", { category: "shirts" }],
    ["parameters that are not an object", "page=2"],
  ])("refuses %s before sending anything", async (_label, params) => {
    const { fetch, calls } = fakeFetch(() => json({}));
    const error = await failure(
      createMorph({ baseUrl: BASE, fetch }).products.list(params as never),
    );
    expect(error).toMatchObject({
      code: "invalid_request",
      resource: "product",
    });
    expect(calls).toHaveLength(0);
  });

  it.each([
    [
      "the API's parameter refusal",
      () => json({ error: "INVALID_REQUEST", message: "x", details: {} }, 400),
      "invalid_request",
    ],
    [
      "a store context the API cannot resolve",
      () =>
        json(
          {
            error: "INVALID_STORE_CONTEXT",
            message: "A valid publishable key or storefront domain is required",
          },
          401,
        ),
      "invalid_store_context",
    ],
    [
      "a host with no published store",
      () => text("No storefront is attached.", 404),
      "content_not_found",
    ],
    [
      "an unavailable catalog",
      () => text("Catalog context unavailable", 503),
      "store_error",
    ],
    ["a server error", () => json({ error: "INTERNAL" }, 500), "store_error"],
    [
      "products that are not a list",
      () =>
        json({
          products: {},
          context: CONTEXT,
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        }),
      "invalid_response",
    ],
    [
      "a product without a handle",
      () =>
        json({
          products: [{ id: "x", title: "x" }],
          context: CONTEXT,
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        }),
      "invalid_response",
    ],
    [
      "no pagination",
      () => json({ products: [], context: CONTEXT }),
      "invalid_response",
    ],
    [
      "no store context",
      () =>
        json({
          products: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        }),
      "invalid_response",
    ],
  ])("throws for %s", async (_label, answer, code) => {
    const { fetch } = fakeFetch(answer);
    const error = await failure(
      createMorph({ baseUrl: BASE, fetch }).products.list(),
    );
    expect(error).toMatchObject({ code, resource: "product" });
  });
});

describe("products.get", () => {
  it("reads one product with absolute image URLs", async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({ product: PRODUCT, context: CONTEXT }),
    );
    const result = await createMorph({ baseUrl: BASE, fetch }).products.get(
      "linen-shirt",
    );
    expect(calls[0]!.url).toBe(BASE + "/api/store/products/linen-shirt");
    expect(result?.product.handle).toBe("linen-shirt");
    expect(result?.product.assets[0]!.url).toBe(
      BASE + "/api/store/assets/11111111-1111-1111-1111-111111111111",
    );
    expect(result?.context).toEqual(CONTEXT);
  });

  it("answers null only when the Store API says the product does not exist", async () => {
    const { fetch } = fakeFetch(() =>
      json({ error: "NOT_FOUND", message: "Product not found" }, 404),
    );
    expect(
      await createMorph({ baseUrl: BASE, fetch }).products.get("gone"),
    ).toBeNull();
  });

  it.each([
    [
      "a host with no published store (plain 404)",
      () => text('No storefront is attached to "shop.example.com".', 404),
      "content_not_found",
    ],
    [
      "another JSON 404",
      () => json({ error: "SOMETHING_ELSE" }, 404),
      "store_error",
    ],
    [
      "a store context the API cannot resolve",
      () => json({ error: "INVALID_STORE_CONTEXT" }, 401),
      "invalid_store_context",
    ],
    [
      "the API's handle refusal",
      () => json({ error: "INVALID_REQUEST" }, 400),
      "invalid_request",
    ],
    ["a server error", () => text("boom", 500), "store_error"],
    [
      "a product without variants",
      () => json({ product: ITEM, context: CONTEXT }),
      "invalid_response",
    ],
    ["no product", () => json({ context: CONTEXT }), "invalid_response"],
  ])("throws, not null, for %s", async (_label, answer, code) => {
    const { fetch } = fakeFetch(answer);
    const error = await failure(
      createMorph({ baseUrl: BASE, fetch }).products.get("linen-shirt"),
    );
    expect(error).toMatchObject({ code, resource: "product" });
  });

  it("throws, not null, when the service cannot be reached", async () => {
    const fetch: MorphFetch = async () => {
      throw new TypeError("network");
    };
    const error = await failure(
      createMorph({ baseUrl: BASE, fetch }).products.get("linen-shirt"),
    );
    expect(error.code).toBe("store_unreachable");
  });

  it.each([
    ["upper case", "Linen"],
    ["a slash", "a/b"],
    ["spaces", " linen "],
    ["a leading hyphen", "-linen"],
    ["an empty handle", ""],
    ["over 255 characters", "a".repeat(256)],
  ])(
    "refuses a handle with %s before sending anything",
    async (_label, handle) => {
      const { fetch, calls } = fakeFetch(() => json({}));
      const error = await failure(
        createMorph({ baseUrl: BASE, fetch }).products.get(handle),
      );
      expect(error).toMatchObject({
        code: "invalid_request",
        resource: "product",
      });
      expect(calls).toHaveLength(0);
    },
  );
});

describe("concurrent readers", () => {
  it("keeps two readers for different stores apart while both are in flight", async () => {
    // One fetch for both, the way a server process has one global fetch.
    // Store A's answer is held until store B has been answered and read, so
    // anything one reader kept from its request would be what the other sees.
    let releaseA!: () => void;
    const aHeld = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const seen: Record<string, string[]> = { a: [], b: [] };
    const fetch: MorphFetch = async (input) => {
      const url = new URL(input);
      const store = url.hostname.split(".")[0]!;
      seen[store]!.push(url.pathname + url.search);
      if (store === "a") await aHeld;
      const path = url.searchParams.get("path");
      return url.pathname === "/_morph/content"
        ? json({
            slots: {
              hero: {
                heading: `${store}:${path}`,
                image: "/_storefront-media/" + store,
              },
            },
            hiddenSlots: [],
          })
        : json({
            products: [{ ...ITEM, id: store, handle: store }],
            context: { ...CONTEXT, storeId: store },
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
          });
    };
    const a = createMorph({ baseUrl: "https://a.example.com", fetch });
    const b = createMorph({ baseUrl: "https://b.example.com", fetch });

    const pageA = a.pages.get("/a-only");
    const listA = a.products.list();
    const pageB = await b.pages.get("/b-only");
    const listB = await b.products.list();
    releaseA();

    expect(pageB.hero).toEqual({
      heading: "b:/b-only",
      image: "https://b.example.com/_storefront-media/b",
    });
    expect(listB.context.storeId).toBe("b");
    expect((await pageA).hero).toEqual({
      heading: "a:/a-only",
      image: "https://a.example.com/_storefront-media/a",
    });
    expect((await listA).products[0]!.thumbnailUrl).toBe(
      "https://a.example.com/api/store/assets/11111111-1111-1111-1111-111111111111",
    );
    expect(seen).toEqual({
      a: ["/_morph/content?path=%2Fa-only", "/api/store/products"],
      b: ["/_morph/content?path=%2Fb-only", "/api/store/products"],
    });
  });
});
