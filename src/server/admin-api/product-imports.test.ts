import { describe, expect, it, vi } from "vitest";
import type { ProductImportExecution } from "@/lib/product/import/product-import-storage";
import type { ProductImportService } from "@/lib/product/import/product-import.service";
import {
  handleAdminProductImportsRequest,
  type AdminProductImportsApiDependencies,
} from "./product-imports";

const id = "c31f09f6-8d9b-4f3e-94d8-047bb63376e2";
const execution: ProductImportExecution = {
  version: 1,
  id,
  ownerId: "admin-1",
  status: "awaiting_confirmation",
  dispatchToken: null,
  leaseExpiresAt: null,
  fileKey: `commerce/product-imports/files/${id}.csv`,
  createdAt: "2026-09-28T01:00:00.000Z",
  updatedAt: "2026-09-28T01:00:00.000Z",
  rows: 2,
  createCount: 1,
  updateCount: 0,
  variantCount: 2,
  processedGroups: 0,
  createdProducts: 0,
  updatedProducts: 0,
  issueCount: 0,
  issues: [],
  error: null,
};

const dependencies = (
  overrides: Partial<AdminProductImportsApiDependencies> = {},
): AdminProductImportsApiDependencies => ({
  authorize: vi.fn(async () => ({
    allowed: true as const,
    userId: "admin-1",
    role: "admin",
  })),
  service: {
    preview: vi.fn(async () => execution),
    confirm: vi.fn(async () => ({ ...execution, status: "pending" as const })),
    getForOwner: vi.fn(async () => execution),
  } as unknown as ProductImportService,
  ...overrides,
});

describe("Admin product imports API", () => {
  it("authorizes, previews uploaded CSV, and serves the template", async () => {
    const deps = dependencies();
    const preview = await handleAdminProductImportsRequest(
      new Request("https://shop.test/api/admin/products/import", {
        method: "POST",
        headers: { "content-type": "text/csv; charset=utf-8" },
        body: "Product Title,Variant Title\nMug,Default",
      }),
      deps,
    );

    expect(preview.status).toBe(202);
    expect(await preview.json()).toMatchObject({
      transaction_id: id,
      preview: { rows: 2, products_to_create: 1, variants: 2, error_count: 0 },
    });
    expect(deps.service.preview).toHaveBeenCalledWith({
      ownerId: "admin-1",
      csv: "Product Title,Variant Title\nMug,Default",
    });

    const template = await handleAdminProductImportsRequest(
      new Request("https://shop.test/api/admin/products/import/template"),
      deps,
    );
    expect(template.status).toBe(200);
    expect(template.headers.get("content-type")).toContain("text/csv");
    expect(await template.text()).toContain("Product Id,Product Handle,Product Title");
  });

  it("checks the admin role before reading an upload", async () => {
    const deps = dependencies({
      authorize: vi.fn(async () => ({
        allowed: true as const,
        userId: "user-1",
        role: "user",
      })),
    });
    const response = await handleAdminProductImportsRequest(
      new Request("https://shop.test/api/admin/products/import", {
        method: "POST",
        headers: { "content-type": "text/csv" },
        body: "should not be parsed",
      }),
      deps,
    );
    expect(response.status).toBe(403);
    expect(deps.service.preview).not.toHaveBeenCalled();
  });

  it("rejects other content types, oversized requests, and query parameters", async () => {
    const deps = dependencies();
    const contentType = await handleAdminProductImportsRequest(
      new Request("https://shop.test/api/admin/products/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      deps,
    );
    expect(contentType.status).toBe(415);

    const tooLarge = await handleAdminProductImportsRequest(
      new Request("https://shop.test/api/admin/products/import", {
        method: "POST",
        headers: {
          "content-type": "text/csv",
          "content-length": String(5 * 1024 * 1024 + 1),
        },
        body: "x",
      }),
      deps,
    );
    expect(tooLarge.status).toBe(413);

    const query = await handleAdminProductImportsRequest(
      new Request(`https://shop.test/api/admin/workflows-executions/import-products/${id}?x=1`),
      deps,
    );
    expect(query.status).toBe(400);
    expect(deps.service.preview).not.toHaveBeenCalled();
  });

  it("requires owner access for confirmation and workflow status", async () => {
    const deps = dependencies();
    const confirm = await handleAdminProductImportsRequest(
      new Request(`https://shop.test/api/admin/products/import/${id}/confirm`, {
        method: "POST",
      }),
      deps,
    );
    expect(confirm.status).toBe(202);
    expect(deps.service.confirm).toHaveBeenCalledWith(id, "admin-1");

    vi.mocked(deps.service.getForOwner).mockResolvedValueOnce(null);
    const status = await handleAdminProductImportsRequest(
      new Request(`https://shop.test/api/admin/workflows-executions/import-products/${id}`),
      deps,
    );
    expect(status.status).toBe(404);
    expect(deps.service.getForOwner).toHaveBeenCalledWith(id, "admin-1");
  });
});
