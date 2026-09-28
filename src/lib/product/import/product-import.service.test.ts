import { describe, expect, it, vi } from "vitest";
import type {
  ProductImportExecution,
  ProductImportStorage,
  VersionedProductImportExecution,
} from "./product-import-storage";
import { createProductImportService } from "./product-import.service";
import { parseProductImportCsv } from "./product-import.csv";

class MemoryProductImportStorage implements ProductImportStorage {
  readonly executions = new Map<string, ProductImportExecution>();
  readonly files = new Map<string, string>();
  private revision = 0;

  async createExecution(execution: ProductImportExecution) {
    if (this.executions.has(execution.id)) return false;
    this.executions.set(execution.id, execution);
    return true;
  }

  async getExecution(id: string): Promise<VersionedProductImportExecution | null> {
    const execution = this.executions.get(id);
    return execution ? { execution, etag: `etag-${this.revision}` } : null;
  }

  async compareAndSwapExecution(
    id: string,
    etag: string,
    execution: ProductImportExecution,
  ) {
    if (etag !== `etag-${this.revision}` || !this.executions.has(id)) return false;
    this.executions.set(id, execution);
    this.revision += 1;
    return true;
  }

  async putCsv(key: string, contents: string) {
    this.files.set(key, contents);
  }

  async getCsv(key: string) {
    return this.files.get(key) ?? null;
  }

  async deleteCsv(key: string) {
    this.files.delete(key);
  }
}

const csvForProducts = (count: number) =>
  ["Product Title,Variant Title,Variant Sku", ...Array.from({ length: count }, (_, index) => `Product ${index + 1},Default,SKU-${index + 1}`)].join("\n");

describe("createProductImportService", () => {
  it("requires a valid preview and an explicit owner-bound confirmation", async () => {
    const storage = new MemoryProductImportStorage();
    const send = vi.fn(async () => {});
    const service = createProductImportService({
      storage,
      queue: { send },
      applyGroup: vi.fn(async () => ({ success: true, action: "created" as const })),
      createId: vi
        .fn()
        .mockReturnValueOnce("c31f09f6-8d9b-4f3e-94d8-047bb63376e2")
        .mockReturnValueOnce("b23209f6-8d9b-4f3e-94d8-047bb63376e2")
        .mockReturnValueOnce("a53209f6-8d9b-4f3e-94d8-047bb63376e2"),
    });
    const preview = await service.preview({
      ownerId: "admin-a",
      csv: "Product Title\n,",
    });
    expect(preview.issueCount).toBeGreaterThan(0);
    await expect(service.confirm(preview.id, "admin-a")).rejects.toThrow(
      "PRODUCT_IMPORT_PREVIEW_HAS_ISSUES",
    );

    const valid = await service.preview({
      ownerId: "admin-a",
      csv: csvForProducts(1),
    });
    await expect(service.confirm(valid.id, "admin-b")).resolves.toBeNull();
    expect(send).not.toHaveBeenCalled();
    await expect(service.confirm(valid.id, "admin-a")).resolves.toMatchObject({
      status: "pending",
      dispatchToken: "a53209f6-8d9b-4f3e-94d8-047bb63376e2",
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it("processes products in bounded queue batches and records results", async () => {
    const storage = new MemoryProductImportStorage();
    const messages: Array<{ transactionId: string; dispatchToken: string }> = [];
    const applyGroup = vi.fn(async () => ({ success: true, action: "created" as const }));
    const service = createProductImportService({
      storage,
      queue: {
        send: async (message) => {
          messages.push(message);
        },
      },
      applyGroup,
      createId: vi
        .fn()
        .mockReturnValueOnce("c31f09f6-8d9b-4f3e-94d8-047bb63376e2")
        .mockReturnValueOnce("a53209f6-8d9b-4f3e-94d8-047bb63376e2"),
    });
    const preview = await service.preview({ ownerId: "admin-a", csv: csvForProducts(12) });
    await service.confirm(preview.id, "admin-a");
    const token = messages[0]!.dispatchToken;

    await service.process(preview.id, token);
    expect(applyGroup).toHaveBeenCalledTimes(10);
    expect(messages).toHaveLength(2);
    expect(storage.executions.get(preview.id)?.status).toBe("pending");

    await service.process(preview.id, token);
    expect(applyGroup).toHaveBeenCalledTimes(12);
    expect(storage.executions.get(preview.id)).toMatchObject({
      status: "succeeded",
      processedGroups: 12,
      createdProducts: 12,
      issueCount: 0,
    });
  });

  it("retains parser errors in the preview and never sends a queue message", async () => {
    const storage = new MemoryProductImportStorage();
    const send = vi.fn(async () => {});
    const csv = "Product Title,Variant Price NOPE\nMug,1";
    expect(parseProductImportCsv(csv).issues.length).toBeGreaterThan(0);
    const service = createProductImportService({
      storage,
      queue: { send },
      applyGroup: vi.fn(async () => ({ success: true })),
      createId: () => "c31f09f6-8d9b-4f3e-94d8-047bb63376e2",
    });
    const preview = await service.preview({ ownerId: "admin-a", csv });
    expect(preview.issues[0]?.message).toContain("currency code");
    await expect(service.confirm(preview.id, "admin-a")).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("requires category names to resolve uniquely during preview", async () => {
    const storage = new MemoryProductImportStorage();
    const service = createProductImportService({
      storage,
      queue: { send: vi.fn(async () => {}) },
      applyGroup: vi.fn(async () => ({ success: true })),
      findCategoriesByName: async () => [
        { id: "c31f09f6-8d9b-4f3e-94d8-047bb63376e2", name: "Kitchen" },
        { id: "b23209f6-8d9b-4f3e-94d8-047bb63376e2", name: "Kitchen" },
      ],
      createId: () => "c31f09f6-8d9b-4f3e-94d8-047bb63376e2",
    });

    const preview = await service.preview({
      ownerId: "admin-a",
      csv: "Product Title,Product Category 1\nMug,Kitchen",
    });

    expect(preview.issueCount).toBe(1);
    expect(preview.issues[0]?.message).toContain("more than one category");
  });

  it("does not silently accept deleted or unknown category IDs", async () => {
    const storage = new MemoryProductImportStorage();
    const service = createProductImportService({
      storage,
      queue: { send: vi.fn(async () => {}) },
      applyGroup: vi.fn(async () => ({ success: true })),
      findCategoryIds: async () => [],
      createId: () => "c31f09f6-8d9b-4f3e-94d8-047bb63376e2",
    });

    const preview = await service.preview({
      ownerId: "admin-a",
      csv: "Product Title,Category Id 1\nMug,c31f09f6-8d9b-4f3e-94d8-047bb63376e2",
    });

    expect(preview.issueCount).toBe(1);
    expect(preview.issues[0]?.message).toContain("was not found");
  });
});
