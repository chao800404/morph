import {
  orderExportFiltersSchema,
  type OrderExportFilters,
} from "@/lib/order/export/order-export.service";
import type { OrderExportService } from "@/lib/order/export/order-export.service";
import type { AdminApiAccess } from "./orders";
import { z } from "zod";

export interface AdminOrderExportsApiDependencies {
  authorize(request: Request): Promise<AdminApiAccess>;
  service: OrderExportService;
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

const orderSchema = z.enum([
  "created_at",
  "-created_at",
  "updated_at",
  "-updated_at",
]);

const parseFilters = (params: URLSearchParams): OrderExportFilters | null => {
  const values = new Map<string, string>();
  for (const [key, value] of params.entries()) {
    if (!new Set(["q", "order"]).has(key) || values.has(key)) return null;
    values.set(key, value);
  }
  const order = orderSchema.safeParse(values.get("order") ?? "-created_at");
  if (!order.success) return null;
  const sort = order.data.replace(/^-/, "");
  const parsed = orderExportFiltersSchema.safeParse({
    ...(values.has("q") ? { query: values.get("q") } : {}),
    sortBy: sort === "updated_at" ? "updatedAt" : "createdAt",
    sortOrder: order.data.startsWith("-") ? "desc" : "asc",
  });
  return parsed.success ? parsed.data : null;
};

const statusToApi = (
  execution: Awaited<
    ReturnType<AdminOrderExportsApiDependencies["service"]["getForOwner"]>
  >,
) => {
  if (!execution) return null;
  const expired =
    execution.expiresAt !== null &&
    Date.parse(execution.expiresAt) <= Date.now();
  const downloadUrl =
    execution.status === "succeeded" && execution.fileKey && !expired
      ? `/api/admin/orders/export/${execution.id}`
      : null;
  const order = `${execution.filters.sortOrder === "desc" ? "-" : ""}${execution.filters.sortBy === "updatedAt" ? "updated_at" : "created_at"}`;
  return {
    workflow_execution: {
      id: execution.id,
      transaction_id: execution.id,
      workflow_id: "export-orders",
      status: expired ? "expired" : execution.status,
      created_at: execution.createdAt,
      updated_at: execution.updatedAt,
      filters: { q: execution.filters.query ?? null, order },
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

/** Medusa-shaped asynchronous order CSV export endpoints. */
export async function handleAdminOrderExportsRequest(
  request: Request,
  dependencies: AdminOrderExportsApiDependencies,
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

  if (path === "orders/export") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const filters = parseFilters(new URL(request.url).searchParams);
    if (!filters) {
      return routeError("INVALID_REQUEST", "Invalid order export filters", 400);
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
        (error.message === "ORDER_EXPORT_QUEUE_UNAVAILABLE" ||
          error.message === "ORDER_EXPORT_STORAGE_UNAVAILABLE" ||
          error.message === "ORDER_EXPORT_QUEUE_SEND_FAILED" ||
          error.message === "COMMERCE_EXPORT_STORAGE_UNAVAILABLE")
      ) {
        return routeError("SERVICE_UNAVAILABLE", "Order exports are not configured", 503);
      }
      return routeError("INTERNAL_ERROR", "Order export could not be started", 500);
    }
  }

  const executionMatch =
    /^workflows-executions\/export-orders\/([0-9a-f-]{36})$/i.exec(path);
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
        : routeError("NOT_FOUND", "Order export was not found", 404);
    } catch {
      return routeError("INTERNAL_ERROR", "Order export status could not be loaded", 500);
    }
  }

  const downloadMatch = /^orders\/export\/([0-9a-f-]{36})$/i.exec(path);
  if (downloadMatch) {
    if (request.method !== "GET") return methodNotAllowed("GET");
    try {
      const result = await dependencies.service.getFileForOwner(
        downloadMatch[1]!,
        access.userId,
      );
      if (!result) {
        return routeError("NOT_FOUND", "Order export file is not available", 404);
      }
      return new Response(result.file.body, {
        headers: {
          "cache-control": "private, no-store",
          "content-disposition": `attachment; filename="orders-${result.execution.id}.csv"`,
          "content-length": String(result.file.size),
          "content-type": "text/csv; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      return routeError("INTERNAL_ERROR", "Order export file could not be loaded", 500);
    }
  }

  return routeError("NOT_FOUND", "Order export endpoint was not found", 404);
}
