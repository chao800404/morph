import { describe, expect, it, vi } from "vitest";
import type { CommerceExportExecution } from "@/lib/commerce-export/storage/commerce-export-storage";
import type { OrderExportService } from "@/lib/order/export/order-export.service";
import {
  handleAdminOrderExportsRequest,
  type AdminOrderExportsApiDependencies,
} from "./order-exports";

const transactionId = "c31f09f6-8d9b-4f3e-94d8-047bb63376e2";
const execution: CommerceExportExecution<{
  query?: string;
  sortBy: "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
}> = {
  version: 1,
  kind: "orders",
  id: transactionId,
  ownerId: "admin-1",
  status: "succeeded",
  filters: { query: "WEB-41", sortBy: "updatedAt", sortOrder: "desc" },
  createdAt: "2026-09-28T01:00:00.000Z",
  updatedAt: "2026-09-28T01:01:00.000Z",
  processedItems: 1,
  totalItems: 1,
  fileKey: "commerce/order-exports/files/test.csv",
  expiresAt: "2026-10-05T01:01:00.000Z",
  error: null,
};

const dependencies = (
  overrides: Partial<AdminOrderExportsApiDependencies> = {},
): AdminOrderExportsApiDependencies => ({
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
  } as unknown as OrderExportService,
  ...overrides,
});

describe("Admin order exports API", () => {
  it("starts an export with the order-list query and sort", async () => {
    const deps = dependencies();
    const response = await handleAdminOrderExportsRequest(
      new Request(
        "https://shop.test/api/admin/orders/export?q=WEB-41&order=-updated_at",
        { method: "POST" },
      ),
      deps,
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ transaction_id: transactionId });
    expect(deps.service.start).toHaveBeenCalledWith({
      ownerId: "admin-1",
      filters: { query: "WEB-41", sortBy: "updatedAt", sortOrder: "desc" },
    });
  });

  it("requires an administrator and rejects unsupported or duplicate filters", async () => {
    const forbidden = dependencies({
      authorize: vi.fn(async () => ({
        allowed: true as const,
        userId: "user-1",
        role: "user",
      })),
    });
    const denied = await handleAdminOrderExportsRequest(
      new Request("https://shop.test/api/admin/orders/export", { method: "POST" }),
      forbidden,
    );
    expect(denied.status).toBe(403);
    expect(forbidden.service.start).not.toHaveBeenCalled();

    const invalid = await handleAdminOrderExportsRequest(
      new Request(
        "https://shop.test/api/admin/orders/export?order=created_at&order=-created_at&unknown=1",
        { method: "POST" },
      ),
      dependencies(),
    );
    expect(invalid.status).toBe(400);
  });

  it("returns a private status URL and hides executions from other owners", async () => {
    const deps = dependencies();
    const response = await handleAdminOrderExportsRequest(
      new Request(
        `https://shop.test/api/admin/workflows-executions/export-orders/${transactionId}`,
      ),
      deps,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      workflow_execution: {
        workflow_id: "export-orders",
        filters: { q: "WEB-41", order: "-updated_at" },
        result: { download_url: `/api/admin/orders/export/${transactionId}` },
      },
    });

    const hidden = await handleAdminOrderExportsRequest(
      new Request(
        `https://shop.test/api/admin/workflows-executions/export-orders/${transactionId}`,
      ),
      dependencies({ service: { getForOwner: vi.fn(async () => null) } as unknown as OrderExportService }),
    );
    expect(hidden.status).toBe(404);
  });
});
