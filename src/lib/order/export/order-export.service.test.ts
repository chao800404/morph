import { describe, expect, it, vi } from "vitest";
import type {
  CommerceExportExecution,
  CommerceExportKind,
  CommerceExportStorage,
  VersionedCommerceExportExecution,
} from "@/lib/commerce-export/storage/commerce-export-storage";
import type { OrderExportItemDTO } from "./order-export.dto";
import { createOrderExportService } from "./order-export.service";

const transactionId = "c31f09f6-8d9b-4f3e-94d8-047bb63376e2";
const timestamp = new Date("2026-09-28T01:00:00.000Z");
const filters = { query: "order", sortBy: "createdAt", sortOrder: "desc" } as const;
const item = {
  order: {
    id: "order-1",
    displayId: 41,
    customDisplayId: "WEB-41",
    status: "completed",
    email: "=SUM(1,2)",
    currencyCode: "twd",
    isDraftOrder: false,
    customerId: "customer-1",
    regionId: "region-1",
    salesChannelId: "channel-1",
    createdAt: timestamp.toISOString(),
    updatedAt: timestamp.toISOString(),
    canceledAt: null,
    metadata: { source: "storefront" },
  },
  total: 32000,
  summary: { total: 32000 },
  shippingAddress: null,
  billingAddress: null,
  items: [
    {
      lineItem: {
        id: "item-1",
        title: "Mug",
        productTitle: "Ceramic Mug",
        variantTitle: "Blue",
        variantId: "variant-1",
        productId: "product-1",
        variantSku: "MUG-01",
        variantBarcode: null,
        variantOptionValues: [{ option: "Color", value: "Blue" }],
        unitPrice: 32000,
        compareAtUnitPrice: null,
        isTaxInclusive: false,
        metadata: {},
      },
      state: {
        quantity: 1,
        fulfilledQuantity: 1,
        shippedQuantity: 1,
        returnReceivedQuantity: 0,
        unitPrice: 32000,
        compareAtUnitPrice: null,
      },
    },
  ],
} as unknown as OrderExportItemDTO;

class MemoryExportStorage implements CommerceExportStorage {
  readonly records = new Map<string, CommerceExportExecution>();
  readonly files = new Map<string, string>();
  private revision = 0;

  async createExecution(execution: CommerceExportExecution) {
    const key = `${execution.kind}:${execution.id}`;
    if (this.records.has(key)) return false;
    this.records.set(key, execution);
    this.revision += 1;
    return true;
  }

  async getExecution(
    id: string,
    kind: CommerceExportKind = "inventory-items",
  ): Promise<VersionedCommerceExportExecution | null> {
    const execution = this.records.get(`${kind}:${id}`);
    return execution ? { execution, etag: String(this.revision) } : null;
  }

  async compareAndSwapExecution(
    id: string,
    etag: string,
    execution: CommerceExportExecution,
  ) {
    const key = `${execution.kind}:${id}`;
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
        : await new Response(contents).text(),
    );
  }

  async getFile(key: string) {
    const contents = this.files.get(key);
    if (contents === undefined) return null;
    const bytes = new TextEncoder().encode(contents);
    return {
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      size: bytes.byteLength,
    };
  }

  async deleteFile(key: string) {
    this.files.delete(key);
  }
}

describe("order export service", () => {
  it("queues a private order export with addresses and versioned line items", async () => {
    const storage = new MemoryExportStorage();
    const send = vi.fn(async () => {});
    const listItems = vi.fn(async () => ({ items: [item], total: 1 }));
    const service = createOrderExportService({
      storage,
      queue: { send },
      listItems,
      now: () => timestamp,
      createId: vi.fn().mockReturnValueOnce(transactionId).mockReturnValueOnce("file-1"),
    });

    const execution = await service.start({ ownerId: "admin-1", filters });
    expect(send).toHaveBeenCalledWith({
      version: 1,
      type: "order-export",
      transactionId,
    });
    await service.process(transactionId);
    const owned = await service.getFileForOwner(transactionId, "admin-1");
    expect(owned).not.toBeNull();
    const csv = await new Response(owned!.file.body).text();
    expect(csv).toContain("shipping_address");
    expect(csv).toContain("\"'" + "=SUM(1,2)\"");
    expect(csv).toContain("MUG-01");
    expect(csv).toContain("Ceramic Mug");
    expect(csv).toContain("32000");
    expect(listItems).toHaveBeenCalledWith({
      ...filters,
      page: 1,
      limit: 25,
      offset: 0,
    });
    expect(execution.kind).toBe("orders");
    expect([...storage.files.keys()][0]).toContain("commerce/order-exports/files");
  });
});
