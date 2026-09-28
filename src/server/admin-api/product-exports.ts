import {
  productExportFiltersSchema,
  type ProductExportFilters,
} from "@/lib/product/dto/product-export.dto";
import type { ProductExportService } from "@/lib/product/service/product-export.service";
import type { AdminApiAccess } from "./orders";
import { z } from "zod";

export interface AdminProductExportsApiDependencies {
  authorize(request: Request): Promise<AdminApiAccess>;
  service: ProductExportService;
}

const privateJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });

const routeError = (error: string, message: string, status: number) =>
  privateJson({ error, message }, status);

const methodNotAllowed = (allow: string) =>
  new Response(null, {
    status: 405,
    headers: { allow, "cache-control": "private, no-store" },
  });

const allowedFilters = new Set([
  "q",
  "status",
  "created_within",
  "updated_within",
  "collection_id",
  "category_id",
  "option_id",
  "sales_channel_id",
  "order",
]);

const orderSchema = z.enum([
  "title",
  "-title",
  "created_at",
  "-created_at",
  "updated_at",
  "-updated_at",
]);

const parseFilters = (params: URLSearchParams) => {
  const values = new Map<string, string>();
  for (const [key, value] of params.entries()) {
    if (!allowedFilters.has(key) || values.has(key)) return null;
    values.set(key, value);
  }
  const parsedOrder = orderSchema.safeParse(
    values.get("order") ?? "-created_at",
  );
  if (!parsedOrder.success) return null;
  const order = parsedOrder.data;
  const sortBy = order.replace(/^-/, "");
  const raw = {
    ...(values.has("q") ? { query: values.get("q") } : {}),
    ...(values.has("status") ? { status: values.get("status") } : {}),
    ...(values.has("created_within")
      ? { createdWithin: values.get("created_within") }
      : {}),
    ...(values.has("updated_within")
      ? { updatedWithin: values.get("updated_within") }
      : {}),
    ...(values.has("collection_id")
      ? { collectionId: values.get("collection_id") }
      : {}),
    ...(values.has("category_id")
      ? { categoryId: values.get("category_id") }
      : {}),
    ...(values.has("option_id") ? { optionId: values.get("option_id") } : {}),
    ...(values.has("sales_channel_id")
      ? { salesChannelId: values.get("sales_channel_id") }
      : {}),
    sortBy:
      sortBy === "title"
        ? "title"
        : sortBy === "updated_at"
          ? "updatedAt"
          : "createdAt",
    sortOrder: order.startsWith("-") ? "desc" : "asc",
  };
  const parsed = productExportFiltersSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

const statusToApi = (
  execution: Awaited<
    ReturnType<AdminProductExportsApiDependencies["service"]["getForOwner"]>
  >,
) => {
  if (!execution) return null;
  const expired =
    execution.expiresAt !== null &&
    Date.parse(execution.expiresAt) <= Date.now();
  const downloadUrl =
    execution.status === "succeeded" && execution.fileKey && !expired
      ? `/api/admin/products/export/${execution.id}`
      : null;
  return {
    workflow_execution: {
      id: execution.id,
      transaction_id: execution.id,
      workflow_id: "export-products",
      status: expired ? "expired" : execution.status,
      created_at: execution.createdAt,
      updated_at: execution.updatedAt,
      filters: {
        q: execution.filters.query ?? null,
        status: execution.filters.status ?? null,
        created_within: execution.filters.createdWithin ?? null,
        updated_within: execution.filters.updatedWithin ?? null,
      },
      result: downloadUrl ? { download_url: downloadUrl } : null,
      progress: {
        processed_items: execution.processedItems,
        total_items: execution.totalItems,
      },
      errors: execution.error
        ? [{ message: execution.error }]
        : expired
          ? [{ message: "This export has expired" }]
          : [],
    },
  };
};

/** Medusa-shaped asynchronous product CSV export endpoints. */
export async function handleAdminProductExportsRequest(
  request: Request,
  dependencies: AdminProductExportsApiDependencies,
): Promise<Response> {
  let access: AdminApiAccess;
  try {
    access = await dependencies.authorize(request);
  } catch {
    access = {
      allowed: false,
      status: 401,
      error: "UNAUTHORIZED",
      message: "A signed-in commerce user is required",
    };
  }
  if (!access.allowed) {
    return routeError(access.error, access.message, access.status);
  }
  if (!access.userId || access.role !== "admin") {
    return routeError("FORBIDDEN", "Administrator access is required", 403);
  }

  const path = new URL(request.url).pathname
    .replace(/^\/api\/admin\/?/, "")
    .replace(/\/$/, "");

  if (path === "products/export") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const filters = parseFilters(new URL(request.url).searchParams);
    if (!filters) {
      return routeError(
        "INVALID_REQUEST",
        "Invalid product export filters",
        400,
      );
    }
    try {
      const execution = await dependencies.service.start({
        ownerId: access.userId,
        filters,
      });
      return privateJson({ transaction_id: execution.id }, 202);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "PRODUCT_EXPORT_QUEUE_UNAVAILABLE" ||
          error.message === "PRODUCT_EXPORT_STORAGE_UNAVAILABLE" ||
          error.message === "PRODUCT_EXPORT_QUEUE_SEND_FAILED" ||
          error.message === "COMMERCE_EXPORT_STORAGE_UNAVAILABLE")
      ) {
        return routeError(
          "SERVICE_UNAVAILABLE",
          "Product exports are not configured",
          503,
        );
      }
      return routeError(
        "INTERNAL_ERROR",
        "Product export could not be started",
        500,
      );
    }
  }

  const executionMatch =
    /^workflows-executions\/export-products\/([0-9a-f-]{36})$/i.exec(path);
  if (executionMatch) {
    if (request.method !== "GET") return methodNotAllowed("GET");
    try {
      const execution = await dependencies.service.getForOwner(
        executionMatch[1]!,
        access.userId,
      );
      const response = statusToApi(execution);
      return response
        ? privateJson(response)
        : routeError("NOT_FOUND", "Product export was not found", 404);
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Product export status could not be loaded",
        500,
      );
    }
  }

  const downloadMatch = /^products\/export\/([0-9a-f-]{36})$/i.exec(path);
  if (downloadMatch) {
    if (request.method !== "GET") return methodNotAllowed("GET");
    try {
      const result = await dependencies.service.getFileForOwner(
        downloadMatch[1]!,
        access.userId,
      );
      if (!result) {
        return routeError(
          "NOT_FOUND",
          "Product export file is not available",
          404,
        );
      }
      return new Response(result.file.body, {
        headers: {
          "cache-control": "private, no-store",
          "content-disposition": `attachment; filename="products-${result.execution.id}.csv"`,
          "content-length": String(result.file.size),
          "content-type": "text/csv; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Product export file could not be loaded",
        500,
      );
    }
  }

  return routeError("NOT_FOUND", "Product export endpoint was not found", 404);
}

export type ProductExportFilterInput = ProductExportFilters;
