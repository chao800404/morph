import { env } from "cloudflare:workers";
import { z } from "zod";
import { storeCatalogDal } from "../dal/store-catalog.dal";
import type { StoreCatalogContextDTO } from "../dto/store-context.dto";
import {
  productHandleSchema,
  storeProductListParamsSchema,
} from "@/lib/validations/store-api";
const jsonHeaders = {
  "access-control-allow-headers":
    "content-type, x-publishable-api-key, x-storefront-host",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
  "content-type": "application/json; charset=utf-8",
  vary: "x-publishable-api-key, x-storefront-host",
};

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

const privateResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...jsonHeaders, "cache-control": "private, no-store" },
  });

function decodeHandle(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
/** The same read-only catalog handler is used on platform and merchant hosts. */
export async function handleStoreCatalogGet(
  request: Request,
  context: StoreCatalogContextDTO,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/store\/?/, "").replace(/\/$/, "");
  if (request.method !== "GET")
    return privateResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (path.startsWith("assets/")) {
    const assetId = z.uuid().safeParse(path.slice("assets/".length));
    if (!assetId.success)
      return privateResponse(
        { error: "INVALID_REQUEST", message: "Invalid asset ID" },
        400,
      );
    const asset = await storeCatalogDal.findPublishedAsset(
      assetId.data,
      context.salesChannelId,
    );
    if (!asset)
      return response({ error: "NOT_FOUND", message: "Asset not found" }, 404);
    const rawKey = asset.url.replace(/^\/+/, "");
    const object = await env.R2_BUCKET.get(
      rawKey.startsWith("assets/") ? rawKey : `assets/${rawKey}`,
    );
    if (!object)
      return response(
        { error: "NOT_FOUND", message: "Asset file not found" },
        404,
      );
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    if (headers.get("content-type") === "image/svg+xml") {
      const isValidatedSvg = object.customMetadata?.svgValidated === "true";
      headers.set(
        "content-disposition",
        isValidatedSvg ? "inline" : "attachment",
      );
      headers.set(
        "content-security-policy",
        "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
      );
    }
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "public, max-age=3600");
    headers.set("x-content-type-options", "nosniff");
    return new Response(object.body, { headers });
  }

  if (path === "products") {
    const params = storeProductListParamsSchema.safeParse({
      q: url.searchParams.get("q") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      order: url.searchParams.get("order") ?? undefined,
    });
    if (!params.success)
      return response(
        {
          error: "INVALID_REQUEST",
          message: "Invalid product list parameters",
          details: params.error.flatten().fieldErrors,
        },
        400,
      );
    const result = await storeCatalogDal.listProducts({
      salesChannelId: context.salesChannelId,
      query: params.data.q,
      page: params.data.page,
      limit: params.data.limit,
      sortOrder: params.data.order,
    });
    return response({
      products: result.products,
      context,
      pagination: {
        page: params.data.page,
        limit: params.data.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / params.data.limit),
      },
    });
  }

  if (path.startsWith("products/")) {
    const parsed = productHandleSchema.safeParse(
      decodeHandle(path.slice("products/".length)),
    );
    if (!parsed.success)
      return response(
        { error: "INVALID_REQUEST", message: "Invalid product handle" },
        400,
      );
    const product = await storeCatalogDal.findProductByHandle(
      parsed.data,
      context.salesChannelId,
      context.currencyCode,
      context.regionId,
    );
    return product
      ? response({ product, context })
      : response({ error: "NOT_FOUND", message: "Product not found" }, 404);
  }

  return null;
}
