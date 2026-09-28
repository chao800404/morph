import { PRODUCT_IMPORT_MAX_BYTES, PRODUCT_IMPORT_TEMPLATE } from "@/lib/product/import/product-import.csv";
import type { ProductImportService } from "@/lib/product/import/product-import.service";
import type { AdminApiAccess } from "./orders";

export interface AdminProductImportsApiDependencies {
  authorize(request: Request): Promise<AdminApiAccess>;
  service: ProductImportService;
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

const readCsvBody = async (request: Request): Promise<string> => {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > PRODUCT_IMPORT_MAX_BYTES)) {
    throw new Error("PRODUCT_IMPORT_FILE_TOO_LARGE");
  }
  if (!request.body) throw new Error("PRODUCT_IMPORT_EMPTY_FILE");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PRODUCT_IMPORT_MAX_BYTES) {
        await reader.cancel();
        throw new Error("PRODUCT_IMPORT_FILE_TOO_LARGE");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PRODUCT_IMPORT_")) throw error;
    throw new Error("PRODUCT_IMPORT_INVALID_ENCODING");
  } finally {
    reader.releaseLock();
  }
  if (size === 0) throw new Error("PRODUCT_IMPORT_EMPTY_FILE");
  return text;
};

const executionToApi = (execution: Awaited<ReturnType<ProductImportService["getForOwner"]>>) => {
  if (!execution) return null;
  return {
    workflow_execution: {
      id: execution.id,
      transaction_id: execution.id,
      workflow_id: "import-products",
      status: execution.status,
      created_at: execution.createdAt,
      updated_at: execution.updatedAt,
      preview: {
        rows: execution.rows,
        products_to_create: execution.createCount,
        products_to_update: execution.updateCount,
        variants: execution.variantCount,
      },
      progress: {
        processed_items: execution.processedGroups,
        total_items: execution.createCount + execution.updateCount,
        created_products: execution.createdProducts,
        updated_products: execution.updatedProducts,
      },
      errors: [
        ...(execution.error ? [{ row: null, message: execution.error }] : []),
        ...execution.issues.map((issue) => ({
          row: issue.row,
          field: issue.field ?? null,
          message: issue.message,
        })),
      ],
      error_count: execution.issueCount,
    },
  };
};

/** Admin-only preview, confirmation, and status endpoints for product CSV import. */
export async function handleAdminProductImportsRequest(
  request: Request,
  dependencies: AdminProductImportsApiDependencies,
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
  if (!access.allowed) return routeError(access.error, access.message, access.status);
  if (!access.userId || access.role !== "admin") {
    return routeError("FORBIDDEN", "Administrator access is required", 403);
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/admin\/?/, "").replace(/\/$/, "");
  if (url.searchParams.size > 0) return routeError("INVALID_REQUEST", "Import endpoints do not accept query parameters", 400);

  if (path === "products/import/template") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    return new Response(PRODUCT_IMPORT_TEMPLATE, {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": 'attachment; filename="morph-products-template.csv"',
        "content-type": "text/csv; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  }

  if (path === "products/import") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const contentType = request.headers.get("content-type") ?? "";
    if (!/^text\/csv(?:\s*;\s*charset\s*=\s*(?:utf-8|utf8))?$/i.test(contentType)) {
      return routeError("INVALID_REQUEST", "Upload a CSV file using the text/csv content type", 415);
    }
    try {
      const execution = await dependencies.service.preview({
        ownerId: access.userId,
        csv: await readCsvBody(request),
      });
      return privateJson({
        transaction_id: execution.id,
        preview: {
          rows: execution.rows,
          products_to_create: execution.createCount,
          products_to_update: execution.updateCount,
          variants: execution.variantCount,
          error_count: execution.issueCount,
          errors: execution.issues,
        },
      }, 202);
    } catch (error) {
      if (error instanceof Error && error.message === "PRODUCT_IMPORT_FILE_TOO_LARGE") {
        return routeError("FILE_TOO_LARGE", "CSV file exceeds the 5 MB limit", 413);
      }
      if (error instanceof Error && error.message === "PRODUCT_IMPORT_EMPTY_FILE") {
        return routeError("INVALID_REQUEST", "CSV file is empty", 400);
      }
      if (error instanceof Error && error.message === "PRODUCT_IMPORT_INVALID_ENCODING") {
        return routeError("INVALID_REQUEST", "CSV file must use UTF-8 encoding", 400);
      }
      return routeError("INTERNAL_ERROR", "Product import preview could not be created", 500);
    }
  }

  const confirmMatch = /^products\/import\/([0-9a-f-]{36})\/confirm$/i.exec(path);
  if (confirmMatch) {
    if (request.method !== "POST") return methodNotAllowed("POST");
    try {
      const execution = await dependencies.service.confirm(confirmMatch[1]!, access.userId);
      if (!execution) return routeError("NOT_FOUND", "Product import was not found", 404);
      return privateJson({ transaction_id: execution.id, ...executionToApi(execution) }, 202);
    } catch (error) {
      if (error instanceof Error && error.message === "PRODUCT_IMPORT_PREVIEW_HAS_ISSUES") {
        return routeError("PREVIEW_HAS_ISSUES", "Fix the CSV errors before confirming the import", 409);
      }
      if (error instanceof Error && (error.message === "PRODUCT_IMPORT_QUEUE_UNAVAILABLE" || error.message === "PRODUCT_IMPORT_QUEUE_SEND_FAILED" || error.message === "PRODUCT_IMPORT_STORAGE_UNAVAILABLE")) {
        return routeError("SERVICE_UNAVAILABLE", "Product imports are not configured", 503);
      }
      return routeError("INTERNAL_ERROR", "Product import could not be confirmed", 500);
    }
  }

  const statusMatch = /^workflows-executions\/import-products\/([0-9a-f-]{36})$/i.exec(path);
  if (statusMatch) {
    if (request.method !== "GET") return methodNotAllowed("GET");
    try {
      const execution = await dependencies.service.getForOwner(statusMatch[1]!, access.userId);
      return execution
        ? privateJson(executionToApi(execution))
        : routeError("NOT_FOUND", "Product import was not found", 404);
    } catch {
      return routeError("INTERNAL_ERROR", "Product import status could not be loaded", 500);
    }
  }

  return routeError("NOT_FOUND", "Product import endpoint was not found", 404);
}
