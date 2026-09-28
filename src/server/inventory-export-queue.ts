import { z } from "zod";
import { inventoryDal } from "@/lib/inventory/dal/inventory.dal";
import { createInventoryExportService } from "@/lib/inventory/service/inventory-export.service";
import { createProductExportService } from "@/lib/product/service/product-export.service";
import { productExportDal } from "@/lib/product/dal/product-export.dal";
import { createOrderExportService } from "@/lib/order/export/order-export.service";
import { orderExportDal } from "@/lib/order/export/order-export.dal";
import {
  R2CommerceExportStorage,
  type CommerceExportR2Bucket,
} from "@/lib/commerce-export/storage/commerce-export-storage";
import { env } from "cloudflare:workers";
import { R2ProductImportStorage } from "@/lib/product/import/product-import-storage";
import { createProductImportService } from "@/lib/product/import/product-import.service";
import { createProductImportGroupApplier } from "@/lib/product/import/product-import-apply";
import { getConfig } from "@/server/get-config";
import { productCategoryDal } from "@/lib/product/dal/product-taxonomy.dal";

type QueueMessage = {
  body: unknown;
  attempts?: number;
  ack?: () => void;
};

type InventoryExportQueueBatch = { messages: QueueMessage[] };

const exportMessageSchema = z
  .object({
    version: z.literal(1),
    type: z.enum(["inventory-export", "product-export", "order-export"]),
    transactionId: z.uuid(),
  })
  .strict();
const importMessageSchema = z
  .object({
    version: z.literal(1),
    type: z.literal("product-import"),
    transactionId: z.uuid(),
    dispatchToken: z.uuid(),
  })
  .strict();
const messageSchema = z.union([importMessageSchema, exportMessageSchema]);

/** Run one durable commerce export message at a time. */
export async function processInventoryExportQueue(
  batch: InventoryExportQueueBatch,
): Promise<void> {
  const workerEnv = env as unknown as {
    R2_BUCKET?: CommerceExportR2Bucket;
    INVENTORY_EXPORT_QUEUE?: {
      send(message: {
        version: 1;
        type: "inventory-export" | "product-export" | "order-export" | "product-import";
        transactionId: string;
        dispatchToken?: string;
      }): Promise<void>;
    };
  };
  const storage = new R2CommerceExportStorage(workerEnv.R2_BUCKET);
  const inventoryService = createInventoryExportService({
    storage,
    prepare: async () => {
      await inventoryDal.reconcileManagedVariants();
    },
    listItems: (input) => inventoryDal.listPage(input),
  });
  const productService = createProductExportService({
    storage,
    listItems: (input) => productExportDal.listPage(input),
  });
  const orderService = createOrderExportService({
    storage,
    listItems: (input) => orderExportDal.listPage(input),
  });
  const importService = createProductImportService({
    storage: new R2ProductImportStorage(workerEnv.R2_BUCKET),
    queue: workerEnv.INVENTORY_EXPORT_QUEUE,
    applyGroup: createProductImportGroupApplier(
      getConfig().server.upload.maxAssetsPerRecord,
    ),
    findCategoriesByName: (names) => productCategoryDal.findByNames(names),
    findCategoryIds: (ids) => productCategoryDal.filterExisting(ids),
  });

  for (const message of batch.messages) {
    const parsed = messageSchema.safeParse(message.body);
    if (!parsed.success) {
      message.ack?.();
      continue;
    }
    if (parsed.data.type === "product-import") {
      try {
        await importService.process(
          parsed.data.transactionId,
          parsed.data.dispatchToken,
        );
        message.ack?.();
      } catch {
        if ((message.attempts ?? 1) > 3) {
          await importService.fail(
            parsed.data.transactionId,
            "Product import failed after retrying",
          );
          message.ack?.();
          continue;
        }
        await importService.retry(
          parsed.data.transactionId,
          parsed.data.dispatchToken,
        );
        throw new Error("PRODUCT_IMPORT_QUEUE_PROCESS_FAILED");
      }
      continue;
    }
    const service =
      parsed.data.type === "product-export"
        ? productService
        : parsed.data.type === "order-export"
          ? orderService
          : inventoryService;
    try {
      await service.process(parsed.data.transactionId);
      message.ack?.();
    } catch (error) {
      // Cloudflare retries a thrown message up to max_retries. Mark the durable
      // execution as failed on its final delivery so polling never stays stuck
      // in "running" after the platform drops the message.
      if ((message.attempts ?? 1) > 3) {
        await service.fail(
          parsed.data.transactionId,
          "Commerce export failed after retrying",
        );
        message.ack?.();
        continue;
      }
      throw error;
    }
  }
}
