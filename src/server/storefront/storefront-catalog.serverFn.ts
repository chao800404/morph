import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";
import { fail, failure, ok, parseInput } from "@/lib/db/server-result";
import { storeContextDal } from "@/lib/storefront/dal/store-context.dal";
import { storeCatalogDal } from "@/lib/storefront/dal/store-catalog.dal";
import { assetDal } from "@/lib/asset/dal/asset.dal";
import { productHandleSchema } from "@/lib/validations/store-api";
import { findCurrency, formatMoney } from "@/lib/currency/catalog";

const inputSchema = z.object({
  storefrontId: z.uuid(),
  themeId: z.uuid(),
  page: z.number().int().min(1).max(10000).default(1),
  handle: productHandleSchema.optional(),
  sampleDetail: z.boolean().optional(),
});

const PREVIEW_ASSET_MIME_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_PREVIEW_ASSET_BYTES = 3 * 1024 * 1024;
const MAX_PREVIEW_ASSET_TOTAL_BYTES = 8 * 1024 * 1024;

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/**
 * Gives the isolated iframe bounded, inert image bytes without giving Theme
 * code an authenticated Morph URL or an R2 capability. Production continues
 * to use the public channel-scoped asset endpoint; this is preview-only.
 */
async function previewAssetDataUrls(
  assets: Awaited<ReturnType<typeof assetDal.findByIds>>,
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (!env.R2_BUCKET) return urls;
  let totalBytes = 0;
  for (const asset of assets) {
    const mimeType = asset.mimeType?.toLowerCase() ?? "";
    if (
      !PREVIEW_ASSET_MIME_TYPES.has(mimeType) ||
      asset.size <= 0 ||
      asset.size > MAX_PREVIEW_ASSET_BYTES ||
      totalBytes + asset.size > MAX_PREVIEW_ASSET_TOTAL_BYTES
    ) {
      continue;
    }
    const key = asset.url.replace(/^\/+/, "");
    const object = await env.R2_BUCKET.get(
      key.startsWith("assets/") ? key : `assets/${key}`,
    );
    if (!object || object.size > MAX_PREVIEW_ASSET_BYTES) continue;
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (totalBytes + bytes.byteLength > MAX_PREVIEW_ASSET_TOTAL_BYTES) continue;
    totalBytes += bytes.byteLength;
    urls.set(
      `/api/store/assets/${asset.id}`,
      `data:${mimeType};base64,${encodeBase64(bytes)}`,
    );
  }
  return urls;
}

// The authenticated editor bridge returns public catalog DTOs to the isolated
// real-React preview. No admin entity or credential is handed to Theme source.
export const getStorefrontPreviewCatalog = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(inputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const context = await storeContextDal.resolveForTheme(
        input.data.storefrontId,
        input.data.themeId,
      );
      if (!context)
        return fail("Storefront catalog context unavailable", {
          error: "NOT_FOUND",
        });
      const data = input.data;
      const sample = data.sampleDetail
        ? await storeCatalogDal.listProducts({
            salesChannelId: context.salesChannelId,
            page: 1,
            limit: 1,
            sortOrder: "desc",
          })
        : null;
      const handle = data.handle ?? sample?.products[0]?.handle;
      const result =
        handle || data.sampleDetail
          ? {
              product: handle
                ? await storeCatalogDal.findProductByHandle(
                    handle,
                    context.salesChannelId,
                    context.currencyCode,
                    context.regionId,
                  )
                : null,
            }
          : await (async () => {
              const page = await storeCatalogDal.listProducts({
                salesChannelId: context.salesChannelId,
                page: data.page,
                limit: 12,
                sortOrder: "desc",
              });
              return {
                products: page.products,
                pagination: {
                  page: data.page,
                  limit: 12,
                  total: page.total,
                  totalPages: Math.ceil(page.total / 12),
                },
              };
            })();
      // Resolve only asset IDs already present in channel-scoped public DTOs.
      const displayedProducts =
        "products" in result
          ? result.products
          : result.product
            ? [result.product]
            : [];
      const paths = [
        ...displayedProducts.map((product) => product.thumbnailUrl),
        ...("product" in result && result.product
          ? result.product.assets.map((asset) => asset.url)
          : []),
      ];
      const ids = [
        ...new Set(
          paths.flatMap((path) => {
            const match =
              path && /^\/api\/store\/assets\/([a-f0-9-]{36})$/.exec(path);
            return match ? [match[1]!] : [];
          }),
        ),
      ];
      const assets = ids.length ? await assetDal.findByIds(ids) : [];
      const urls = await previewAssetDataUrls(assets);
      if ("products" in result)
        return ok("Preview catalog loaded", {
          ...result,
          products: result.products.map((product) => ({
            ...product,
            thumbnailUrl: product.thumbnailUrl
              ? (urls.get(product.thumbnailUrl) ?? null)
              : null,
          })),
        });
      const product = result.product;
      return ok("Preview catalog loaded", {
        product: product
          ? {
              ...product,
              thumbnailUrl: product.thumbnailUrl
                ? (urls.get(product.thumbnailUrl) ?? null)
                : null,
              assets: product.assets.flatMap((asset) => {
                const url = urls.get(asset.url);
                return url ? [{ ...asset, url }] : [];
              }),
              variants: product.variants.map((variant) => {
                const currency = variant.price
                  ? findCurrency(variant.price.currencyCode)
                  : undefined;
                return {
                  ...variant,
                  formattedPrice:
                    variant.price && currency
                      ? formatMoney(variant.price.amount, currency, "en")
                      : null,
                };
              }),
            }
          : null,
      });
    } catch (error) {
      return failure(
        "Preview catalog error",
        error,
        "READ_FAILED",
        "Failed to load storefront products",
      );
    }
  });
