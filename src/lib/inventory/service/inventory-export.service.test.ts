import { describe, expect, it, vi } from "vitest";
import type { InventoryListItemDTO } from "../dto/inventory.dto";
import type {
  InventoryExportExecution,
  InventoryExportStorage,
  VersionedInventoryExportExecution,
} from "../storage/inventory-export-storage";
import { createInventoryExportService } from "./inventory-export.service";

const transactionId = "c31f09f6-8d9b-4f3e-94d8-047bb63376e2";
const now = new Date("2026-09-28T01:00:00.000Z");

const filters = {
  sortBy: "createdAt" as const,
  sortOrder: "desc" as const,
};

const item: InventoryListItemDTO = {
  id: transactionId,
  title: "=2+2, item",
  sku: "SKU-1",
  description: "Cotton, woven",
  thumbnail: null,
  unitOfMeasure: "kg",
  requiresShipping: true,
  weight: 250,
  length: null,
  height: null,
  width: null,
  originCountry: "TW",
  hsCode: null,
  midCode: null,
  material: "cotton",
  metadata: { source: "erp" },
  productId: null,
  variantId: null,
  variantCount: 0,
  stockedQuantity: 12,
  reservedQuantity: 3,
  incomingQuantity: 4,
  availableQuantity: 9,
  locationLevels: [
    {
      id: "a7d52c3e-aeeb-4388-9a66-23ebd83a08cc",
      locationId: "ab09cb0e-89bb-4b48-83d0-e634ad6a6bda",
      locationName: "Taipei",
      unitOfMeasure: "kg",
      stockedQuantity: 12,
      reservedQuantity: 3,
      incomingQuantity: 4,
      availableQuantity: 9,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    },
  ],
  createdAt: now,
  updatedAt: now,
};

class MemoryExportStorage implements InventoryExportStorage {
  readonly records = new Map<string, InventoryExportExecution>();
  readonly files = new Map<string, string>();
  private revision = 0;

  async createExecution(execution: InventoryExportExecution) {
    if (this.records.has(execution.id)) return false;
    this.records.set(execution.id, execution);
    this.revision += 1;
    return true;
  }

  async getExecution(
    id: string,
  ): Promise<VersionedInventoryExportExecution | null> {
    const execution = this.records.get(id);
    return execution ? { execution, etag: String(this.revision) } : null;
  }

  async compareAndSwapExecution(
    id: string,
    etag: string,
    execution: InventoryExportExecution,
  ) {
    if (etag !== String(this.revision) || !this.records.has(id)) return false;
    this.records.set(id, execution);
    this.revision += 1;
    return true;
  }

  async putFile(key: string, contents: string | ReadableStream) {
    this.files.set(
      key,
      typeof contents === "string"
        ? contents
        : new TextDecoder("utf-8", { ignoreBOM: true }).decode(
            await new Response(contents).arrayBuffer(),
          ),
    );
  }

  async getFile(key: string) {
    const contents = this.files.get(key);
    if (contents === undefined) return null;
    return {
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(contents));
          controller.close();
        },
      }),
      size: new TextEncoder().encode(contents).byteLength,
    };
  }

  async deleteFile(key: string) {
    this.files.delete(key);
  }
}

describe("inventory export service", () => {
  it("queues a private execution and exports each item location as a CSV row", async () => {
    const storage = new MemoryExportStorage();
    const send = vi.fn(async () => {});
    const listItems = vi.fn(async () => ({ items: [item], total: 1 }));
    const service = createInventoryExportService({
      storage,
      queue: { send },
      listItems,
      now: () => now,
      createId: () => transactionId,
    });

    const execution = await service.start({ ownerId: "admin-1", filters });
    expect(execution).toMatchObject({
      id: transactionId,
      ownerId: "admin-1",
      status: "pending",
    });
    expect(send).toHaveBeenCalledWith({
      version: 1,
      type: "inventory-export",
      transactionId,
    });

    await expect(service.process(transactionId)).resolves.toBe("completed");
    const completed = await service.getForOwner(transactionId, "admin-1");
    expect(completed).toMatchObject({
      status: "succeeded",
      processedItems: 1,
      totalItems: 1,
      expiresAt: "2026-10-05T01:00:00.000Z",
    });
    expect(await service.getForOwner(transactionId, "admin-2")).toBeNull();

    const download = await service.getFileForOwner(transactionId, "admin-1");
    expect(download).not.toBeNull();
    const fileBytes = new Uint8Array(
      await new Response(download!.file.body).arrayBuffer(),
    );
    expect(Array.from(fileBytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(fileBytes);
    expect(csv).toContain("id,title,sku,description");
    expect(csv).toContain('"\'=2+2, item"');
    expect(csv).toContain("Cotton, woven");
    expect(csv).toContain(
      "ab09cb0e-89bb-4b48-83d0-e634ad6a6bda,Taipei,12,3,9,4",
    );
    expect(listItems).toHaveBeenCalledWith({
      ...filters,
      page: 1,
      limit: 100,
      offset: 0,
    });
  });

  it("records a terminal failure when the requested export exceeds its item cap", async () => {
    const storage = new MemoryExportStorage();
    const service = createInventoryExportService({
      storage,
      queue: { send: vi.fn(async () => {}) },
      listItems: vi.fn(async () => ({ items: [], total: 100_001 })),
      now: () => now,
      createId: () => transactionId,
    });
    await service.start({ ownerId: "admin-1", filters });

    await expect(service.process(transactionId)).resolves.toBe("completed");
    expect(await service.getForOwner(transactionId, "admin-1")).toMatchObject({
      status: "failed",
      error: "Export exceeds the 100,000 item limit",
    });
  });

  it("fails the execution if enqueueing fails", async () => {
    const storage = new MemoryExportStorage();
    const service = createInventoryExportService({
      storage,
      queue: { send: vi.fn(async () => Promise.reject(new Error("offline"))) },
      listItems: vi.fn(async () => ({ items: [], total: 0 })),
      now: () => now,
      createId: () => transactionId,
    });

    await expect(
      service.start({ ownerId: "admin-1", filters }),
    ).rejects.toThrow("INVENTORY_EXPORT_QUEUE_SEND_FAILED");
    expect(await service.getForOwner(transactionId, "admin-1")).toMatchObject({
      status: "failed",
      error: "Export could not be queued",
    });
  });
});
