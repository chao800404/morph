/** Bootstrap copies for an independent Theme; wiring/provisioning lives elsewhere. */
export const STARTER_THEME_CATALOG_FILES: Array<{
  path: string;
  content: string;
  mimeType: string;
}> = [
  {
    path: "src/morph/catalog.ts",
    mimeType: "text/typescript",
    content: `import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

// Public structural display subset, independent of Morph Core.
export type CatalogProduct = {
  id: string;
  title: string;
  handle: string;
  subtitle: string | null;
  description: string | null;
  thumbnailUrl: string | null;
};
export type CatalogDetail = CatalogProduct & {
  assets: Array<{ id: string; name: string; url: string }>;
  options: Array<{ id: string; title: string; values: Array<{ id: string; value: string }> }>;
  variants: Array<{
    id: string; title: string; allowBackorder: boolean; availableQuantity: number;
    price: { currencyCode: string; amount: number } | null;
    formattedPrice: string | null;
  }>;
};
export type CatalogList = { products: CatalogProduct[]; pagination: { total: number; page: number; limit: number; totalPages: number } };
export type CatalogResult = CatalogList | { product: CatalogDetail | null };
export type CatalogQuery = { page: number; handle?: never } | { handle: string; page?: never };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid catalog response.");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid catalog response.");
  return value;
}
function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}
function imageUrl(value: unknown): string | null {
  const url = nullableText(value);
  if (!url) return null;
  // Permit only same-origin absolute paths or HTTP(S) images.
  if (/^\\/(?![\\/\\\\])/.test(url) && !/[\\\\\\u0000-\\u0020]/.test(url)) return url;
  try {
    const parsed = new URL(url);
    if ((parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password) return parsed.href;
  } catch { /* Unsupported media is displayed as missing. */ }
  return null;
}
function product(value: unknown): CatalogProduct {
  const item = record(value);
  return { id: text(item.id), title: text(item.title), handle: text(item.handle),
    subtitle: nullableText(item.subtitle), description: nullableText(item.description), thumbnailUrl: imageUrl(item.thumbnailUrl) };
}
function integer(value: unknown, minimum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new Error("Invalid catalog response.");
  return value;
}
function variant(value: unknown): CatalogDetail["variants"][number] {
  const item = record(value);
  if (typeof item.allowBackorder !== "boolean") throw new Error("Invalid catalog response.");
  let price: { currencyCode: string; amount: number } | null = null;
  let formattedPrice: string | null = null;
  if (item.price !== null) {
    const rawPrice = record(item.price);
    const currencyCode = text(rawPrice.currencyCode);
    if (!/^[A-Za-z]{3}$/.test(currencyCode)) throw new Error("Invalid catalog currency.");
    const amount = integer(rawPrice.amount, 0);
    const formatter = new Intl.NumberFormat("en", { style: "currency", currency: currencyCode });
    const fractionDigits = formatter.resolvedOptions().maximumFractionDigits;
    if (fractionDigits === undefined) throw new Error("Invalid catalog currency.");
    price = { currencyCode, amount };
    formattedPrice = formatter.format(amount / 10 ** fractionDigits);
  }
  return { id: text(item.id), title: text(item.title), allowBackorder: item.allowBackorder,
    availableQuantity: integer(item.availableQuantity, 0), price, formattedPrice };
}
function validate(value: unknown, detail: boolean): CatalogResult {
  const payload = record(value);
  if (detail) {
    if (payload.product === null) return { product: null };
    const item = record(payload.product);
    if (!Array.isArray(item.assets)) throw new Error("Invalid catalog response.");
    const assets: CatalogDetail["assets"] = [];
    for (const value of item.assets) {
      const asset = record(value);
      const id = text(asset.id);
      const name = text(asset.name);
      const url = imageUrl(asset.url);
      if (url) assets.push({ id, name, url });
    }
    if (!Array.isArray(item.options) || !Array.isArray(item.variants)) throw new Error("Invalid catalog response.");
    const options = item.options.map((value: unknown) => {
      const option = record(value);
      if (!Array.isArray(option.values)) throw new Error("Invalid catalog response.");
      return { id: text(option.id), title: text(option.title), values: option.values.map((value: unknown) => {
        const entry = record(value);
        return { id: text(entry.id), value: text(entry.value) };
      }) };
    });
    return { product: { ...product(item), assets, options, variants: item.variants.map(variant) } };
  }
  if (!Array.isArray(payload.products)) throw new Error("Invalid catalog response.");
  const pagination = record(payload.pagination);
  return { products: payload.products.map(product), pagination: { total: integer(pagination.total, 0),
    page: integer(pagination.page, 1), limit: integer(pagination.limit, 1), totalPages: integer(pagination.totalPages, 0) } };
}
function catalogPath(query: CatalogQuery): string {
  if (typeof query.handle === "string") {
    if (!query.handle.trim() || query.handle === "." || query.handle === "..") throw new Error("Invalid product handle.");
    return "/api/store/products/" + encodeURIComponent(query.handle);
  }
  const page = integer(query.page, 1);
  if (page > 10_000) throw new Error("Invalid catalog page.");
  return "/api/store/products?page=" + page + "&limit=12";
}
async function requestCatalog(url: string, detail: boolean): Promise<CatalogResult> {
  const response = await fetch(url, {
    headers: { accept: "application/json" }, credentials: "omit", redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (detail && response.status === 404) return { product: null };
  if (!response.ok) throw new Error("The catalog is temporarily unavailable.");
  const payload: unknown = await response.json();
  return validate(payload, detail);
}
const loadCatalog = createIsomorphicFn()
  .client(async (query: CatalogQuery): Promise<CatalogResult> => {
    return requestCatalog(catalogPath(query), typeof query.handle === "string");
  })
  .server(async (query: CatalogQuery): Promise<CatalogResult> => {
    // The runtime supplies this trusted origin; never forward incoming headers.
    const origin = getRequest().headers.get("x-morph-content-origin");
    if (!origin) throw new Error("Catalog origin is unavailable.");
    const url = new URL(origin);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.origin !== origin
      || url.username || url.password) throw new Error("Invalid catalog origin.");
    return requestCatalog(url.origin + catalogPath(query), typeof query.handle === "string");
  });

export async function loadProducts(page: number = 1): Promise<CatalogList> {
  const result = await loadCatalog({ page });
  if (!("products" in result)) throw new Error("Invalid catalog response.");
  return result;
}
export async function loadProduct(slug: string): Promise<{ product: CatalogDetail | null }> {
  const result = await loadCatalog({ handle: slug });
  if (!("product" in result)) throw new Error("Invalid catalog response.");
  return result;
}
`,
  },
  {
    path: "src/routes/products.index.tsx",
    mimeType: "text/tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { loadProducts } from "../morph/catalog";
import ProductList from "../components/ProductList";

export const Route = createFileRoute("/products/")({
  validateSearch: (search: Record<string, unknown>) => {
    const page = Number(search.page ?? 1);
    return { page: Number.isSafeInteger(page) && page > 0 && page <= 10_000 ? page : 1 };
  },
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: ({ deps }) => loadProducts(deps.page),
  component: ProductsRoute,
  pendingComponent: () => <p className="px-6 py-20 text-stone-600" role="status">Loading products…</p>,
  errorComponent: () => <p className="px-6 py-20 text-stone-600" role="alert">Products are temporarily unavailable. Please try again later.</p>,
});
function ProductsRoute() {
  const data = Route.useLoaderData();
  return <ProductList products={data.products} pagination={data.pagination} />;
}
`,
  },
  {
    path: "src/routes/products.$slug.tsx",
    mimeType: "text/tsx",
    content: `import { createFileRoute, notFound } from "@tanstack/react-router";
import { loadProduct } from "../morph/catalog";
import ProductDetail from "../components/ProductDetail";

export const Route = createFileRoute("/products/$slug")({
  loader: async ({ params }) => {
    const result = await loadProduct(params.slug);
    if (!result.product) throw notFound();
    return { product: result.product };
  },
  component: ProductRoute,
  pendingComponent: () => <p className="px-6 py-20 text-stone-600" role="status">Loading product…</p>,
  errorComponent: () => <p className="px-6 py-20 text-stone-600" role="alert">This product is temporarily unavailable. Please try again later.</p>,
  notFoundComponent: () => <div className="px-6 py-20 text-stone-600"><h1 className="font-serif text-3xl">Product not found</h1><a className="mt-6 inline-block underline" href="/products">Browse products</a></div>,
});
function ProductRoute() {
  const data = Route.useLoaderData();
  return data.product ? <ProductDetail product={data.product} /> : <main className="px-6 py-20"><h1>Product not found</h1><a href="/products">Browse products</a></main>;
}
`,
  },
  {
    path: "src/components/ProductList.tsx",
    mimeType: "text/tsx",
    content: `import type { CatalogList } from "../morph/catalog";

export default function ProductList({ products, pagination }: CatalogList) {
  return (
    <section data-morph-node="product-list" className="bg-stone-50 px-6 py-16 text-stone-950 md:px-12 lg:px-20">
      <h1 data-morph-node="product-list-title" className="font-serif text-5xl tracking-tight md:text-7xl">Our collection</h1>
      <p data-morph-node="product-list-count" className="mt-5 text-sm text-stone-600">{pagination.total} products</p>
      {products.length === 0 ? <p data-morph-node="product-list-empty" className="py-16 text-stone-600">No products on this page.</p> : null}
      <div data-morph-node="product-list-grid" className="mt-10 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <a key={product.id} data-morph-node="product-card" href={"/products/" + encodeURIComponent(product.handle)} className="group block min-w-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-stone-900">
            <div data-morph-node="product-card-media" className="flex aspect-square items-center justify-center overflow-hidden bg-stone-200">
              {product.thumbnailUrl ? <img data-morph-node="product-card-image" src={product.thumbnailUrl} alt={product.title} loading="lazy" className="h-full w-full object-cover" /> : <span data-morph-node="product-card-placeholder" className="text-sm text-stone-600">No image available</span>}
            </div>
            <h2 data-morph-node="product-card-title" className="mt-5 break-words font-serif text-2xl group-hover:underline">{product.title}</h2>
            {product.subtitle ? <p data-morph-node="product-card-subtitle" className="mt-2 text-sm text-stone-600">{product.subtitle}</p> : null}
          </a>
        ))}
      </div>
      <nav data-morph-node="product-pagination" aria-label="Product pages" className="mt-14 flex items-center justify-between gap-6 border-t border-stone-300 pt-6 text-sm">
        {pagination.page > 1 ? <a data-morph-node="product-previous" href={"/products?page=" + (pagination.page - 1)} className="underline">Previous</a> : <span />}
        <span data-morph-node="product-page">Page {pagination.page}</span>
        {pagination.page < pagination.totalPages ? <a data-morph-node="product-next" href={"/products?page=" + (pagination.page + 1)} className="underline">Next</a> : <span />}
      </nav>
    </section>
  );
}
`,
  },
  {
    path: "src/components/ProductDetail.tsx",
    mimeType: "text/tsx",
    content: `import type { CatalogDetail } from "../morph/catalog";

export default function ProductDetail({ product }: { product: CatalogDetail }) {
  return (
    <section data-morph-node="product-detail" className="bg-stone-50 px-6 py-16 text-stone-950 md:px-12 lg:px-20">
      <a data-morph-node="product-back" href="/products" className="text-sm text-stone-600 underline">All products</a>
      <div data-morph-node="product-detail-grid" className="mt-10 grid gap-12 lg:grid-cols-2">
        <div data-morph-node="product-gallery" className="space-y-6">
          {product.thumbnailUrl ? <img data-morph-node="product-image" src={product.thumbnailUrl} alt={product.title} className="aspect-square w-full bg-stone-200 object-cover" /> : <div data-morph-node="product-placeholder" className="flex aspect-square items-center justify-center bg-stone-200 text-sm text-stone-600">No cover image available</div>}
          {product.assets.map((asset) => <img key={asset.id} data-morph-node="product-asset" src={asset.url} alt={asset.name} loading="lazy" className="w-full bg-stone-200 object-cover" />)}
        </div>
        <div data-morph-node="product-information" className="min-w-0 py-4">
          <h1 data-morph-node="product-title" className="break-words font-serif text-5xl tracking-tight md:text-6xl">{product.title}</h1>
          {product.subtitle ? <p data-morph-node="product-subtitle" className="mt-5 text-lg text-stone-600">{product.subtitle}</p> : null}
          {product.description ? <p data-morph-node="product-description" className="mt-8 whitespace-pre-line break-words leading-7 text-stone-600">{product.description}</p> : <p data-morph-node="product-description-empty" className="mt-8 text-stone-600">Details coming soon.</p>}
          <div data-morph-node="product-options" className="mt-8 space-y-5">
            {product.options.map((option) => <div key={option.id} data-morph-node="product-option">
              <h2 data-morph-node="product-option-title" className="text-sm font-medium">{option.title}</h2>
              <ul data-morph-node="product-option-values" className="mt-2 flex flex-wrap gap-3 text-sm text-stone-600">
                {option.values.map((value) => <li key={value.id} data-morph-node="product-option-value" className="border border-stone-300 px-3 py-2">{value.value}</li>)}
              </ul>
            </div>)}
          </div>
          <ul data-morph-node="product-variants" className="mt-8 divide-y divide-stone-300 border-y border-stone-300">
            {product.variants.map((variant) => <li key={variant.id} data-morph-node="product-variant" className="flex flex-wrap items-start justify-between gap-4 py-5">
              <div data-morph-node="product-variant-info">
                <h2 data-morph-node="product-variant-title" className="text-sm font-medium">{variant.title}</h2>
                <p data-morph-node="product-variant-availability" className="mt-2 text-sm text-stone-600">{variant.availableQuantity > 0 ? "In stock" : variant.allowBackorder ? "Available to backorder" : "Out of stock"}</p>
              </div>
              <p data-morph-node="product-variant-price" className="text-sm">{variant.formattedPrice ? variant.formattedPrice : "Price unavailable"}</p>
            </li>)}
          </ul>
        </div>
      </div>
    </section>
  );
}
`,
  },
];
