import { describe, expect, it, vi } from "vitest";
import type { InventoryExportExecution } from "@/lib/inventory/storage/inventory-export-storage";
import type { InventoryExportService } from "@/lib/inventory/service/inventory-export.service";
import {
  handleAdminInventoryExportsRequest,
  type AdminInventoryExportsApiDependencies,
} from "./inventory-exports";

const transactionId = "c31f09f6-8d9b-4f3e-94d8-047bb63376e2";
const execution: InventoryExportExecution = {
  version: 1,
  id: transactionId,
  ownerId: "admin-1",
  status: "succeeded",
  filters: { sortBy: "createdAt", sortOrder: "desc" },
  createdAt: "2026-09-28T01:00:00.000Z",
  updatedAt: "2026-09-28T01:01:00.000Z",
  processedItems: 1,
  totalItems: 1,
  fileKey: "commerce/inventory-exports/files/test.csv",
  expiresAt: "2026-10-05T01:01:00.000Z",
  error: null,
};

const dependencies = (
  overrides: Partial<AdminInventoryExportsApiDependencies> = {},
): AdminInventoryExportsApiDependencies => ({
  authorize: vi.fn(async () => ({
    allowed: true as const,
    userId: "admin-1",
    role: "admin",
  })),
  service: {
    start: vi.fn(async () => ({ ...execution, status: "pending" as const })),
    getForOwner: vi.fn(async () => execution),
    getFileForOwner: vi.fn(async () => null),
    process: vi.fn(async () => "completed" as const),
    fail: vi.fn(async () => {}),
  } as unknown as InventoryExportService,
  ...overrides,
});

describe("Admin inventory exports API", () => {
  it("starts an asynchronous export using validated list filters", async () => {
    const deps = dependencies();
    const response = await handleAdminInventoryExportsRequest(
      new Request(
        "https://shop.test/api/admin/inventory-items/export?q=shirt&sku=SKU-1&sku=SKU-2&order=title",
        { method: "POST" },
      ),
      deps,
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ transaction_id: transactionId });
    expect(deps.service.start).toHaveBeenCalledWith({
      ownerId: "admin-1",
      filters: {
        query: "shirt",
        skus: ["SKU-1", "SKU-2"],
        sortBy: "name",
        sortOrder: "asc",
      },
    });
  });

  it("requires administrator authorization before starting an export", async () => {
    const deps = dependencies({
      authorize: vi.fn(async () => ({
        allowed: true as const,
        userId: "user-1",
        role: "user",
      })),
    });
    const response = await handleAdminInventoryExportsRequest(
      new Request("https://shop.test/api/admin/inventory-items/export", {
        method: "POST",
      }),
      deps,
    );

    expect(response.status).toBe(403);
    expect(deps.service.start).not.toHaveBeenCalled();
  });

  it("rejects unsupported sort values instead of silently exporting another order", async () => {
    const deps = dependencies();
    const response = await handleAdminInventoryExportsRequest(
      new Request(
        "https://shop.test/api/admin/inventory-items/export?order=not_a_field",
        { method: "POST" },
      ),
      deps,
    );

    expect(response.status).toBe(400);
    expect(deps.service.start).not.toHaveBeenCalled();
  });

  it("returns the transaction status and an owner-bound CSV URL", async () => {
    const deps = dependencies();
    const response = await handleAdminInventoryExportsRequest(
      new Request(
        `https://shop.test/api/admin/workflows-executions/export-inventory-items/${transactionId}`,
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      workflow_execution: {
        transaction_id: transactionId,
        workflow_id: "export-inventory-items",
        status: "succeeded",
        progress: { processed_items: 1, total_items: 1 },
        result: {
          download_url: `/api/admin/inventory-items/export/${transactionId}`,
        },
      },
    });
  });

  it("does not reveal exports owned by another administrator", async () => {
    const deps = dependencies({
      service: {
        getForOwner: vi.fn(async () => null),
      } as unknown as InventoryExportService,
    });
    const response = await handleAdminInventoryExportsRequest(
      new Request(
        `https://shop.test/api/admin/workflows-executions/export-inventory-items/${transactionId}`,
      ),
      deps,
    );

    expect(response.status).toBe(404);
  });
});
