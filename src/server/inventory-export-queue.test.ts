import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inventoryService: {
    process: vi.fn(async () => "completed"),
    fail: vi.fn(async () => {}),
  },
  productService: {
    process: vi.fn(async () => "completed"),
    fail: vi.fn(async () => {}),
  },
  orderService: {
    process: vi.fn(async () => "completed"),
    fail: vi.fn(async () => {}),
  },
  createInventoryExportService: vi.fn(),
  createProductExportService: vi.fn(),
  createOrderExportService: vi.fn(),
  importService: {
    process: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  },
  createProductImportService: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: { R2_BUCKET: {} } }));
vi.mock("@/lib/inventory/dal/inventory.dal", () => ({
  inventoryDal: {
    reconcileManagedVariants: vi.fn(async () => {}),
    listPage: vi.fn(async () => ({ items: [], total: 0 })),
  },
}));
vi.mock("@/lib/product/dal/product-export.dal", () => ({
  productExportDal: {
    listPage: vi.fn(async () => ({ items: [], total: 0 })),
  },
}));
vi.mock("@/lib/order/export/order-export.dal", () => ({
  orderExportDal: {
    listPage: vi.fn(async () => ({ items: [], total: 0 })),
  },
}));
vi.mock("@/lib/inventory/service/inventory-export.service", () => ({
  createInventoryExportService: mocks.createInventoryExportService,
}));
vi.mock("@/lib/product/service/product-export.service", () => ({
  createProductExportService: mocks.createProductExportService,
}));
vi.mock("@/lib/order/export/order-export.service", () => ({
  createOrderExportService: mocks.createOrderExportService,
}));
vi.mock("@/lib/commerce-export/storage/commerce-export-storage", () => ({
  R2CommerceExportStorage: class {},
}));
vi.mock("@/lib/product/import/product-import-storage", () => ({
  R2ProductImportStorage: class {},
}));
vi.mock("@/lib/product/import/product-import.service", () => ({
  createProductImportService: mocks.createProductImportService,
}));
vi.mock("@/lib/product/import/product-import-apply", () => ({
  createProductImportGroupApplier: vi.fn(() => vi.fn()),
}));
vi.mock("@/lib/product/dal/product-taxonomy.dal", () => ({
  productCategoryDal: { findByNames: vi.fn(async () => []) },
}));
vi.mock("@/server/get-config", () => ({
  getConfig: () => ({ server: { upload: { maxAssetsPerRecord: 10 } } }),
}));

import { processInventoryExportQueue } from "./inventory-export-queue";

describe("commerce export queue routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createInventoryExportService.mockReturnValue(mocks.inventoryService);
    mocks.createProductExportService.mockReturnValue(mocks.productService);
    mocks.createOrderExportService.mockReturnValue(mocks.orderService);
    mocks.createProductImportService.mockReturnValue(mocks.importService);
  });

  it("dispatches each discriminated message to its export service", async () => {
    const inventoryAck = vi.fn();
    const productAck = vi.fn();
    const orderAck = vi.fn();
    await processInventoryExportQueue({
      messages: [
        {
          body: {
            version: 1,
            type: "inventory-export",
            transactionId: "c31f09f6-8d9b-4f3e-94d8-047bb63376e2",
          },
          ack: inventoryAck,
        },
        {
          body: {
            version: 1,
            type: "product-export",
            transactionId: "a53209f6-8d9b-4f3e-94d8-047bb63376e2",
          },
          ack: productAck,
        },
        {
          body: {
            version: 1,
            type: "order-export",
            transactionId: "b23209f6-8d9b-4f3e-94d8-047bb63376e2",
          },
          ack: orderAck,
        },
      ],
    });

    expect(mocks.inventoryService.process).toHaveBeenCalledWith(
      "c31f09f6-8d9b-4f3e-94d8-047bb63376e2",
    );
    expect(mocks.productService.process).toHaveBeenCalledWith(
      "a53209f6-8d9b-4f3e-94d8-047bb63376e2",
    );
    expect(mocks.orderService.process).toHaveBeenCalledWith(
      "b23209f6-8d9b-4f3e-94d8-047bb63376e2",
    );
    expect(inventoryAck).toHaveBeenCalledOnce();
    expect(productAck).toHaveBeenCalledOnce();
    expect(orderAck).toHaveBeenCalledOnce();
  });

  it("acknowledges malformed messages without invoking an export service", async () => {
    const ack = vi.fn();
    await processInventoryExportQueue({
      messages: [
        { body: { type: "product-export", transactionId: "bad" }, ack },
      ],
    });

    expect(mocks.inventoryService.process).not.toHaveBeenCalled();
    expect(mocks.productService.process).not.toHaveBeenCalled();
    expect(mocks.orderService.process).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledOnce();
  });

  it("routes import messages with their dispatch token", async () => {
    const ack = vi.fn();
    const transactionId = "c31f09f6-8d9b-4f3e-94d8-047bb63376e2";
    const dispatchToken = "a53209f6-8d9b-4f3e-94d8-047bb63376e2";
    await processInventoryExportQueue({
      messages: [
        {
          body: { version: 1, type: "product-import", transactionId, dispatchToken },
          ack,
        },
      ],
    });
    expect(mocks.importService.process).toHaveBeenCalledWith(transactionId, dispatchToken);
    expect(ack).toHaveBeenCalledOnce();
  });
});
