import { describe, expect, it, vi } from "vitest";
import type {
  ProductExportFilters,
  ProductExportItemDTO,
} from "../dto/product-export.dto";
import type {
  CommerceExportExecution,
  CommerceExportKind,
  CommerceExportStorage,
  VersionedCommerceExportExecution,
} from "@/lib/commerce-export/storage/commerce-export-storage";
import { createProductExportService } from "./product-export.service";

const transactionId = "c31f09f6-8d9b-4f3e-94d8-047bb63376e2";
const timestamp = new Date("2026-09-28T01:00:00.000Z");

const filters: ProductExportFilters = {
  status: "published",
  sortBy: "title",
  sortOrder: "asc",
};

const item: ProductExportItemDTO = {
  product: {
    id: "product-1",
    title: "=SUM(1,2), mug",
    handle: "mug",
    subtitle: null,
    description: "Ceramic mug",
    status: "published",
    collectionId: null,
    typeId: null,
    discountable: true,
    thumbnailAssetId: null,
    weight: 250,
    length: null,
    width: null,
    height: null,
    originCountry: "TW",
    hsCode: null,
    midCode: null,
    material: "ceramic",
    metadata: { source: "erp" },
    createdBy: "admin-1",
    updatedBy: "admin-1",
    createdAt: timestamp,
    updatedAt: timestamp,
    thumbnailUrl: null,
    collectionTitle: null,
    typeValue: null,
    salesChannels: [],
    variantCount: 1,
  },
  imageUrls: [],
  tags: ["drinkware"],
  categories: ["Kitchen"],
  variants: [
    {
      id: "variant-1",
      title: "Default",
      sku: "MUG-01",
      barcode: null,
      ean: null,
      upc: null,
      rank: 0,
      manageInventory: true,
      allowBackorder: false,
      inventoryQuantity: 5,
      weight: null,
      length: null,
      width: null,
      height: null,
      originCountry: null,
      hsCode: null,
      midCode: null,
      material: null,
      optionValues: [{ option: "Size", value: "12 oz" }],
      prices: [{ currencyCode: "twd", amount: 32000 }],
      imageUrls: [],
      inventoryKit: [],
      metadata: {},
      createdAt: timestamp.toISOString(),
      updatedAt: timestamp.toISOString(),
    },
  ],
};

class MemoryExportStorage implements CommerceExportStorage {
  readonly records = new Map<string, CommerceExportExecution>();
  readonly files = new Map<string, string>();
  private revision = 0;

  private key(id: string, kind: CommerceExportKind) {
    return `${kind}:${id}`;
  }

  async createExecution(execution: CommerceExportExecution) {
    const key = this.key(execution.id, execution.kind ?? "inventory-items");
    if (this.records.has(key)) return false;
    this.records.set(key, execution);
    this.revision += 1;
    return true;
  }

  async getExecution(
    id: string,
    kind: CommerceExportKind = "inventory-items",
  ): Promise<VersionedCommerceExportExecution | null> {
    const execution = this.records.get(this.key(id, kind));
    return execution ? { execution, etag: String(this.revision) } : null;
  }

  async compareAndSwapExecution(
    id: string,
    etag: string,
    execution: CommerceExportExecution,
  ) {
    const kind = execution.kind ?? "inventory-items";
    const key = this.key(id, kind);
    if (etag !== String(this.revision) || !this.records.has(key)) return false;
    this.records.set(key, execution);
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
    const body = new TextEncoder().encode(contents);
    return {
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(body);
          controller.close();
        },
      }),
      size: body.byteLength,
    };
  }

  async deleteFile(key: string) {
    this.files.delete(key);
  }
}

describe("product export service", () => {
  it("queues a private product export and streams product and variant data as CSV", async () => {
    const storage = new MemoryExportStorage();
    const send = vi.fn(async () => {});
    const listItems = vi.fn(async () => ({ items: [item], total: 1 }));
    const service = createProductExportService({
      storage,
      queue: { send },
      listItems,
      now: () => timestamp,
      createId: vi
        .fn()
        .mockReturnValueOnce(transactionId)
        .mockReturnValueOnce("file-1"),
    });

    const execution = await service.start({ ownerId: "admin-1", filters });
    expect(send).toHaveBeenCalledWith({
      version: 1,
      type: "product-export",
      transactionId,
    });

    await service.process(transactionId);
    const owned = await service.getFileForOwner(transactionId, "admin-1");
    expect(owned).not.toBeNull();
    const csv = await new Response(owned!.file.body).text();
    expect(csv).toContain("product_title");
    expect(csv).toContain("variant_sku");
    expect(csv).toContain('"\'=SUM(1,2), mug"');
    expect(csv).toContain("MUG-01");
    expect(csv).toContain("Size");
    expect(csv).toContain("twd");
    expect(listItems).toHaveBeenCalledWith({
      ...filters,
      page: 1,
      limit: 25,
      offset: 0,
    });
    expect(execution.kind).toBe("products");
  });

  it("does not return an export to a different owner", async () => {
    const storage = new MemoryExportStorage();
    const service = createProductExportService({
      storage,
      queue: { send: async () => {} },
      listItems: async () => ({ items: [item], total: 1 }),
      createId: () => transactionId,
      now: () => timestamp,
    });
    await service.start({ ownerId: "admin-1", filters });

    expect(await service.getForOwner(transactionId, "admin-2")).toBeNull();
  });
});
