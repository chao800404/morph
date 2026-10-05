import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommerceExportExecution } from "@/lib/commerce-export/storage/commerce-export-storage";
import type { ProductExportService } from "@/lib/product/service/product-export.service";
import {
  handleAdminProductExportsRequest,
  type AdminProductExportsApiDependencies,
} from "./product-exports";

const transactionId = "c31f09f6-8d9b-4f3e-94d8-047bb63376e2";
const execution: CommerceExportExecution<{
  query?: string;
  status?: "draft" | "published" | "archived";
  createdWithin?: "24h" | "7d" | "30d" | "90d";
  updatedWithin?: "24h" | "7d" | "30d" | "90d";
  collectionId?: string;
  categoryId?: string;
  optionId?: string;
  salesChannelId?: string;
  sortBy: "title" | "createdAt" | "updatedAt";
  sortOrder: "asc" | "desc";
}> = {
  version: 1,
  kind: "products",
  id: transactionId,
  ownerId: "admin-1",
  status: "succeeded",
  filters: {
    query: "mug",
    status: "published",
    sortBy: "title",
    sortOrder: "asc",
  },
  createdAt: "2026-09-28T01:00:00.000Z",
  updatedAt: "2026-09-28T01:01:00.000Z",
  processedItems: 1,
  totalItems: 1,
  fileKey: "commerce/product-exports/files/test.csv",
  expiresAt: "2026-10-05T01:01:00.000Z",
  error: null,
};

const dependencies = (
  overrides: Partial<AdminProductExportsApiDependencies> = {},
): AdminProductExportsApiDependencies => ({
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
  } as unknown as ProductExportService,
  ...overrides,
});

describe("Admin product exports API", () => {
  beforeEach(() => {
    // Keep the fixture valid regardless of the calendar date; timers stay real.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hides the download URL at and after the expiry deadline", async () => {
    for (const offset of [0, 1]) {
      vi.setSystemTime(new Date(Date.parse(execution.expiresAt!) + offset));
      const response = await handleAdminProductExportsRequest(
        new Request(
          `https://shop.test/api/admin/workflows-executions/export-products/${transactionId}`,
        ),
        dependencies(),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        workflow_execution: { status: "expired", result: null },
      });
    }
  });

  it("starts an asynchronous export with validated current-list filters", async () => {
    const deps = dependencies();
    const response = await handleAdminProductExportsRequest(
      new Request(
        "https://shop.test/api/admin/products/export?q=mug&status=published&created_within=7d&order=title",
        { method: "POST" },
      ),
      deps,
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ transaction_id: transactionId });
    expect(deps.service.start).toHaveBeenCalledWith({
      ownerId: "admin-1",
      filters: {
        query: "mug",
        status: "published",
        createdWithin: "7d",
        sortBy: "title",
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
    const response = await handleAdminProductExportsRequest(
      new Request("https://shop.test/api/admin/products/export", {
        method: "POST",
      }),
      deps,
    );

    expect(response.status).toBe(403);
    expect(deps.service.start).not.toHaveBeenCalled();
  });

  it("rejects duplicate and unsupported query filters", async () => {
    const deps = dependencies();
    const response = await handleAdminProductExportsRequest(
      new Request(
        "https://shop.test/api/admin/products/export?status=draft&status=published&unexpected=true",
        { method: "POST" },
      ),
      deps,
    );

    expect(response.status).toBe(400);
    expect(deps.service.start).not.toHaveBeenCalled();
  });

  it("returns Medusa-shaped workflow status and a private download URL", async () => {
    const deps = dependencies();
    const response = await handleAdminProductExportsRequest(
      new Request(
        `https://shop.test/api/admin/workflows-executions/export-products/${transactionId}`,
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      workflow_execution: {
        transaction_id: transactionId,
        workflow_id: "export-products",
        status: "succeeded",
        progress: { processed_items: 1, total_items: 1 },
        filters: { q: "mug", status: "published" },
        result: { download_url: `/api/admin/products/export/${transactionId}` },
      },
    });
  });

  it("does not reveal exports owned by another administrator", async () => {
    const deps = dependencies({
      service: {
        getForOwner: vi.fn(async () => null),
      } as unknown as ProductExportService,
    });
    const response = await handleAdminProductExportsRequest(
      new Request(
        `https://shop.test/api/admin/workflows-executions/export-products/${transactionId}`,
      ),
      deps,
    );

    expect(response.status).toBe(404);
  });
});
