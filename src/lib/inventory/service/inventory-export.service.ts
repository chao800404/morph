import type { InventoryListItemDTO } from "../dto/inventory.dto";
import {
  inventoryExportFiltersSchema,
  type InventoryExportFilters,
} from "../dto/inventory-export.dto";
import type {
  CommerceExportExecution,
  CommerceExportStorage,
} from "@/lib/commerce-export/storage/commerce-export-storage";
import {
  createCsvExportService,
  type CsvExportQueue,
  type CsvExportService,
} from "@/lib/commerce-export/service/csv-export.service";

export type InventoryExportQueueMessage = {
  version: 1;
  type: "inventory-export" | "product-export";
  transactionId: string;
};

export interface InventoryExportQueue extends CsvExportQueue {}

export interface InventoryExportServiceDependencies {
  storage: CommerceExportStorage;
  queue?: InventoryExportQueue;
  prepare?(): Promise<void>;
  listItems(
    input: InventoryExportFilters & {
      page: number;
      limit: number;
      offset: number;
    },
  ): Promise<{ items: InventoryListItemDTO[]; total: number }>;
  now?(): Date;
  createId?(): string;
}

const columns = [
  "id",
  "title",
  "sku",
  "description",
  "thumbnail",
  "unit_of_measure",
  "requires_shipping",
  "weight",
  "length",
  "height",
  "width",
  "origin_country",
  "hs_code",
  "mid_code",
  "material",
  "metadata",
  "product_id",
  "variant_id",
  "variant_count",
  "location_id",
  "location_name",
  "stocked_quantity",
  "reserved_quantity",
  "available_quantity",
  "incoming_quantity",
  "created_at",
  "updated_at",
] as const;

const rowFor = (
  item: InventoryListItemDTO,
  level: InventoryListItemDTO["locationLevels"][number] | null,
) => [
  item.id,
  item.title,
  item.sku,
  item.description,
  item.thumbnail,
  item.unitOfMeasure,
  item.requiresShipping,
  item.weight,
  item.length,
  item.height,
  item.width,
  item.originCountry,
  item.hsCode,
  item.midCode,
  item.material,
  JSON.stringify(item.metadata ?? {}),
  item.productId,
  item.variantId,
  item.variantCount,
  level?.locationId,
  level?.locationName,
  level?.stockedQuantity,
  level?.reservedQuantity,
  level?.availableQuantity,
  level?.incomingQuantity,
  item.createdAt.toISOString(),
  item.updatedAt.toISOString(),
];

export function createInventoryExportService(
  dependencies: InventoryExportServiceDependencies,
) {
  return createCsvExportService<InventoryListItemDTO, InventoryExportFilters>({
    ...dependencies,
    kind: "inventory-items",
    errorPrefix: "INVENTORY_EXPORT",
    filtersSchema: inventoryExportFiltersSchema,
    columns,
    listItems: dependencies.listItems,
    rowsForItem: (item) =>
      item.locationLevels.length
        ? item.locationLevels.map((level) => rowFor(item, level))
        : [rowFor(item, null)],
  });
}

export type InventoryExportService = CsvExportService<InventoryExportFilters>;
export type InventoryExportExecution =
  CommerceExportExecution<InventoryExportFilters>;
