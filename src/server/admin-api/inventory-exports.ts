import { inventoryExportFiltersSchema } from "@/lib/inventory/dto/inventory-export.dto";
import type { InventoryExportService } from "@/lib/inventory/service/inventory-export.service";
import type { AdminApiAccess } from "./orders";
import { z } from "zod";

export interface AdminInventoryExportsApiDependencies {
  authorize(request: Request): Promise<AdminApiAccess>;
  service: InventoryExportService;
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

const repeatedParams = (params: URLSearchParams) => {
  const values: Record<string, string | string[]> = {};
  for (const [rawKey, value] of params.entries()) {
    const key = rawKey
      .replace(/\[\]$/, "")
      .replace("location_levels[location_id]", "location_levels.location_id");
    const previous = values[key];
    if (previous === undefined) values[key] = value;
    else if (Array.isArray(previous)) previous.push(value);
    else values[key] = [previous, value];
  }
  return values;
};

const asArray = (value: string | string[] | undefined) =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

const orderSchema = z.enum([
  "created_at",
  "-created_at",
  "updated_at",
  "-updated_at",
  "title",
  "-title",
  "sku",
  "-sku",
  "origin_country",
  "-origin_country",
  "mid_code",
  "-mid_code",
  "hs_code",
  "-hs_code",
  "material",
  "-material",
]);

const filterInput = (params: URLSearchParams, order: string) => {
  const input = repeatedParams(params);
  const sortField = order.replace(/^-/, "");
  const sortBy =
    sortField === "updated_at"
      ? "updatedAt"
      : sortField === "title"
        ? "name"
        : sortField === "sku"
          ? "sku"
          : sortField === "origin_country"
            ? "originCountry"
            : sortField === "mid_code"
              ? "midCode"
              : sortField === "hs_code"
                ? "hsCode"
                : sortField === "material"
                  ? "material"
                  : "createdAt";
  const requiresShipping = input.requires_shipping;
  const withDeleted = input.with_deleted;
  return {
    ...(typeof input.q === "string" ? { query: input.q } : {}),
    ...(asArray(input.id) ? { ids: asArray(input.id) } : {}),
    ...(asArray(input.sku) ? { skus: asArray(input.sku) } : {}),
    ...(asArray(input.origin_country)
      ? { originCountries: asArray(input.origin_country) }
      : {}),
    ...(asArray(input.mid_code) ? { midCodes: asArray(input.mid_code) } : {}),
    ...(asArray(input.hs_code) ? { hsCodes: asArray(input.hs_code) } : {}),
    ...(asArray(input.material) ? { materials: asArray(input.material) } : {}),
    ...(requiresShipping === "true" || requiresShipping === "false"
      ? { requiresShipping: requiresShipping === "true" }
      : {}),
    ...(withDeleted === "true" || withDeleted === "false"
      ? { withDeleted: withDeleted === "true" }
      : {}),
    ...(asArray(input["location_levels.location_id"])
      ? { locationIds: asArray(input["location_levels.location_id"]) }
      : asArray(input.location_id)
        ? { locationIds: asArray(input.location_id) }
        : {}),
    sortBy,
    sortOrder: order.startsWith("-") ? "desc" : "asc",
  };
};

const statusToApi = (
  execution: Awaited<
    ReturnType<AdminInventoryExportsApiDependencies["service"]["getForOwner"]>
  >,
) => {
  if (!execution) return null;
  const expired =
    execution.expiresAt !== null &&
    Date.parse(execution.expiresAt) <= Date.now();
  const downloadUrl =
    execution.status === "succeeded" && execution.fileKey && !expired
      ? `/api/admin/inventory-items/export/${execution.id}`
      : null;
  return {
    workflow_execution: {
      id: execution.id,
      transaction_id: execution.id,
      workflow_id: "export-inventory-items",
      status: expired ? "expired" : execution.status,
      created_at: execution.createdAt,
      updated_at: execution.updatedAt,
      filters: {
        q: execution.filters.query ?? null,
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

/** Medusa-shaped asynchronous inventory CSV export endpoints. */
export async function handleAdminInventoryExportsRequest(
  request: Request,
  dependencies: AdminInventoryExportsApiDependencies,
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

  if (path === "inventory-items/export") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const query = new URL(request.url).searchParams;
    const invalidBooleanFilter = ["requires_shipping", "with_deleted"].some(
      (key) => {
        const values = query.getAll(key);
        return (
          values.length > 1 ||
          (values.length === 1 && values[0] !== "true" && values[0] !== "false")
        );
      },
    );
    if (invalidBooleanFilter) {
      return routeError(
        "INVALID_REQUEST",
        "Invalid inventory export filter",
        400,
      );
    }
    const raw = repeatedParams(query).order;
    const order = Array.isArray(raw) ? raw.at(-1) : raw;
    const parsedOrder = orderSchema.safeParse(order ?? "-created_at");
    if (!parsedOrder.success) {
      return routeError(
        "INVALID_REQUEST",
        "Invalid inventory export order",
        400,
      );
    }
    const parsed = inventoryExportFiltersSchema.safeParse(
      filterInput(query, parsedOrder.data),
    );
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid inventory export filters",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    try {
      const execution = await dependencies.service.start({
        ownerId: access.userId,
        filters: parsed.data,
      });
      return privateJson({ transaction_id: execution.id }, 202);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "INVENTORY_EXPORT_QUEUE_UNAVAILABLE" ||
          error.message === "INVENTORY_EXPORT_STORAGE_UNAVAILABLE" ||
          error.message === "INVENTORY_EXPORT_QUEUE_SEND_FAILED" ||
          error.message === "COMMERCE_EXPORT_STORAGE_UNAVAILABLE")
      ) {
        return routeError(
          "SERVICE_UNAVAILABLE",
          "Inventory exports are not configured",
          503,
        );
      }
      return routeError(
        "INTERNAL_ERROR",
        "Inventory export could not be started",
        500,
      );
    }
  }

  const executionMatch =
    /^workflows-executions\/export-inventory-items\/([0-9a-f-]{36})$/i.exec(
      path,
    );
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
        : routeError("NOT_FOUND", "Inventory export was not found", 404);
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Inventory export status could not be loaded",
        500,
      );
    }
  }

  const downloadMatch = /^inventory-items\/export\/([0-9a-f-]{36})$/i.exec(
    path,
  );
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
          "Inventory export file is not available",
          404,
        );
      }
      return new Response(result.file.body, {
        headers: {
          "cache-control": "private, no-store",
          "content-disposition": `attachment; filename="inventory-items-${result.execution.id}.csv"`,
          "content-length": String(result.file.size),
          "content-type": "text/csv; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Inventory export file could not be loaded",
        500,
      );
    }
  }

  return routeError(
    "NOT_FOUND",
    "Inventory export endpoint was not found",
    404,
  );
}
