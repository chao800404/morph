import { parse } from "@babel/parser";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderSafeThemeRoute } from "@/components/storefront/safe-theme-route-renderer";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { buildThemeRouteRegistry } from "./compiler/theme-route-registry";
import type { StoreProductDetailDTO } from "./dto/store-catalog.dto";
import { STARTER_THEME_FILES } from "./starter-theme-files";
import { STARTER_THEME_CATALOG_FILES } from "./starter-theme-catalog-files";

function source(path: string) {
  const file = STARTER_THEME_CATALOG_FILES.find((file) => file.path === path);
  if (!file) throw new Error(`Missing source: ${path}`);
  return file.content;
}

const product: StoreProductDetailDTO = {
  id: "p1",
  title: "Cup",
  handle: "cup /茶?",
  subtitle: null,
  description: "A cup",
  thumbnailUrl: null,
  collectionId: null,
  collectionTitle: null,
  updatedAt: "2026-09-06T00:00:00Z",
  assets: [{ id: "a1", name: "Cup", url: "/media/cup.jpg" }],
  options: [
    { id: "o1", title: "Size", values: [{ id: "ov1", value: "Small" }] },
  ],
  variants: [
    {
      id: "v1",
      title: "Small cup",
      sku: null,
      allowBackorder: false,
      availableQuantity: 2,
      optionValueIds: ["ov1"],
      assets: [],
      price: {
        currencyCode: "USD",
        amount: 1250,
        originalAmount: 1250,
        priceListType: null,
      },
    },
  ],
};
const list = {
  products: [product],
  pagination: { page: 2, limit: 12, total: 25, totalPages: 3 },
  context: { salesChannelId: "public" },
};

type CatalogModule = {
  loadProducts(page?: number): Promise<{
    products: Array<{ thumbnailUrl: string | null }>;
    pagination: typeof list.pagination;
  }>;
  loadProduct(slug: string): Promise<{
    product: {
      assets: unknown[];
      variants: Array<{ formattedPrice: string | null }>;
    } | null;
  }>;
};

function runtime(
  side: "client" | "server",
  origin: string | null = "https://store.example",
) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(list)));
  const exports = {};
  const compiled = ts.transpileModule(source("src/morph/catalog.ts"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  runInNewContext(compiled.outputText, {
    exports,
    URL,
    AbortSignal,
    fetch,
    require: (id: string) => {
      if (id === "@tanstack/react-start/server")
        return {
          getRequest: () => ({
            headers: new Headers({
              ...(origin ? { "x-morph-content-origin": origin } : {}),
              cookie: "private",
              authorization: "private",
            }),
          }),
        };
      if (id === "@tanstack/react-start")
        return {
          createIsomorphicFn: () => ({
            client: (client: unknown) => ({
              server: (server: unknown) =>
                side === "client" ? client : server,
            }),
          }),
        };
      throw new Error(`Unexpected import ${id}`);
    },
  });
  return { api: exports as CatalogModule, fetch };
}

describe("starter catalog source", () => {
  it("renders actual catalog source with trusted loader data in Design preview", () => {
    const files = [...STARTER_THEME_FILES, ...STARTER_THEME_CATALOG_FILES];
    const listResult = renderSafeThemeRoute({
      files,
      pathname: "/products",
      document: { version: 1, sections: [] },
      loaderData: list,
    });
    expect(listResult.success, listResult.diagnostics.join(";")).toBe(true);
    const html = renderToStaticMarkup(
      createElement("div", null, listResult.node),
    );
    expect(html).toContain("Cup");
    expect(html).toContain("page=3");
    expect(html).toContain("cup%20%2F%E8%8C%B6%3F");
    const detailResult = renderSafeThemeRoute({
      files,
      pathname: "/products/cup",
      document: { version: 1, sections: [] },
      loaderData: {
        product: {
          ...product,
          variants: product.variants.map((variant) => ({
            ...variant,
            formattedPrice: "$12.50",
          })),
        },
      },
    });
    expect(detailResult.success, detailResult.diagnostics.join(";")).toBe(true);
    expect(
      renderToStaticMarkup(createElement("div", null, detailResult.node)),
    ).toContain("$12.50");
    const missing = renderSafeThemeRoute({
      files,
      pathname: "/products/missing",
      document: { version: 1, sections: [] },
      loaderData: { product: null },
    });
    expect(missing.success, missing.diagnostics.join(";")).toBe(true);
    expect(
      renderToStaticMarkup(createElement("div", null, missing.node)),
    ).toContain("Product not found");
  });
  it("parses every independent TS/TSX source and has unique source markers", () => {
    expect(STARTER_THEME_CATALOG_FILES).toHaveLength(5);
    for (const file of STARTER_THEME_CATALOG_FILES) {
      expect(() =>
        parse(file.content, {
          sourceType: "module",
          plugins: ["typescript", "jsx"],
        }),
      ).not.toThrow();
      const markers = [
        ...file.content.matchAll(/data-morph-node="([^"]+)"/g),
      ].map((match) => match[1]);
      expect(new Set(markers).size).toBe(markers.length);
      expect(file.content).not.toMatch(/@\/|\.\.\/.*(?:lib|server|db)\//);
      expect(file.content).not.toMatch(
        /dangerouslySetInnerHTML|localStorage|sessionStorage|process\.env|import\.meta\.env/,
      );
    }
  });

  it("registers both routes alongside the existing starter without conflicts", () => {
    const registry = buildThemeRouteRegistry([
      ...STARTER_THEME_FILES,
      ...STARTER_THEME_CATALOG_FILES,
    ]);
    expect(registry.diagnostics).toEqual([]);
    expect(registry.valid).toBe(true);
    expect(registry.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fullPath: "/products/",
          componentName: "ProductsRoute",
        }),
        expect.objectContaining({
          path: "/products/$slug",
          componentName: "ProductRoute",
        }),
      ]),
    );
  });

  it("uses loader props, ordinary encoded links, and explicit missing/error states", () => {
    const index = source("src/routes/products.index.tsx");
    const detail = source("src/routes/products.$slug.tsx");
    expect(index).toContain("Route.useLoaderData()");
    expect(index).toContain("validateSearch:");
    expect(index).toContain(
      "loaderDeps: ({ search }) => ({ page: search.page })",
    );
    expect(index).toContain("loadProducts(deps.page)");
    expect(index).toContain("pagination={data.pagination}");
    expect(detail).toContain("loadProduct(params.slug)");
    expect(detail).toContain("if (!result.product) throw notFound()");
    expect(detail).toContain("Route.useLoaderData()");
    expect(detail).toContain("return { product: result.product }");
    for (const route of [index, detail])
      expect(route).toContain("errorComponent:");
    expect(source("src/components/ProductList.tsx")).toContain(
      '"/products/" + encodeURIComponent(product.handle)',
    );
    expect(source("src/components/ProductList.tsx")).toContain(
      '"/products?page="',
    );
    for (const name of ["ProductList", "ProductDetail"]) {
      const component = source(`src/components/${name}.tsx`);
      expect(component).toContain("No ");
      expect(component).not.toMatch(
        /fetch\(|loadProducts\(|loadProduct\(|Intl\./,
      );
    }
  });

  for (const side of ["client", "server"] as const) {
    it(`${side} requests only the public API and strips non-display fields`, async () => {
      const { api, fetch } = runtime(side);
      const result = await api.loadProducts(2);
      expect(result).toEqual({
        products: [
          {
            id: product.id,
            title: product.title,
            handle: product.handle,
            subtitle: null,
            description: product.description,
            thumbnailUrl: null,
          },
        ],
        pagination: list.pagination,
      });
      expect(fetch).toHaveBeenLastCalledWith(
        (side === "server" ? "https://store.example" : "") +
          "/api/store/products?page=2&limit=12",
        {
          headers: { accept: "application/json" },
          credentials: "omit",
          redirect: "error",
          signal: expect.any(AbortSignal),
        },
      );
      fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ product, context: {} })),
      );
      expect((await api.loadProduct(product.handle)).product?.assets).toEqual(
        product.assets,
      );
      expect(fetch.mock.lastCall?.[0]).toBe(
        (side === "server" ? "https://store.example" : "") +
          "/api/store/products/" +
          encodeURIComponent(product.handle),
      );
    });
  }

  it.each([
    null,
    "ftp://store.example",
    "https://user:pass@store.example",
    "https://store.example/path",
    "https://store.example?x=1",
    "https://store.example#x",
    "//store.example",
    "https://store.example/",
    "null",
  ])("rejects invalid origin %s before fetching", async (origin) => {
    const { api, fetch } = runtime("server", origin);
    await expect(api.loadProducts()).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps detail 404/null to missing but preserves list and transport failures", async () => {
    const { api, fetch } = runtime("client");
    fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(api.loadProduct("missing")).resolves.toEqual({
      product: null,
    });
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ product: null })),
    );
    await expect(api.loadProduct("missing")).resolves.toEqual({
      product: null,
    });
    for (const status of [404, 500, 302]) {
      fetch.mockResolvedValueOnce(new Response(null, { status }));
      await expect(api.loadProducts()).rejects.toThrow(
        "temporarily unavailable",
      );
    }
    fetch.mockRejectedValueOnce(new DOMException("Timed out", "TimeoutError"));
    await expect(api.loadProducts()).rejects.toThrow("Timed out");
  });

  it.each([
    {},
    null,
    { ...list, products: [null] },
    { ...list, pagination: { ...list.pagination, limit: 0 } },
    { ...list, pagination: { ...list.pagination, total: "25" } },
    { ...list, products: [{ ...product, title: 1 }] },
  ])("rejects malformed payload %#", async (payload) => {
    const { api, fetch } = runtime("client");
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(payload)));
    await expect(api.loadProducts()).rejects.toThrow(
      "Invalid catalog response",
    );
  });

  it("validates detail assets and safely discards unsafe image URLs", async () => {
    const { api, fetch } = runtime("client");
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ product: { ...product, assets: null } })),
    );
    await expect(api.loadProduct("cup")).rejects.toThrow(
      "Invalid catalog response",
    );
    for (const thumbnailUrl of [
      "javascript:alert(1)",
      "//evil.example/image",
      "/\\evil.example/image",
      "data:text/html,hello",
    ]) {
      fetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ...list, products: [{ ...product, thumbnailUrl }] }),
        ),
      );
      expect((await api.loadProducts()).products[0].thumbnailUrl).toBeNull();
    }
  });

  it("rejects invalid query input without a request", async () => {
    const { api, fetch } = runtime("client");
    for (const page of [0, -1, 1.5, Infinity, NaN, 10_001])
      await expect(api.loadProducts(page)).rejects.toThrow();
    for (const slug of [" ", ".", ".."])
      await expect(api.loadProduct(slug)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
