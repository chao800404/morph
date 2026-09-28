import type { CommerceExportStorage } from "@/lib/commerce-export/storage/commerce-export-storage";
import {
  createCsvExportService,
  type CsvExportQueue,
} from "@/lib/commerce-export/service/csv-export.service";
import {
  productExportFiltersSchema,
  type ProductExportFilters,
  type ProductExportItemDTO,
} from "../dto/product-export.dto";

export interface ProductExportServiceDependencies {
  storage: CommerceExportStorage;
  queue?: CsvExportQueue;
  listItems(
    input: ProductExportFilters & {
      page: number;
      limit: number;
      offset: number;
    },
  ): Promise<{ items: ProductExportItemDTO[]; total: number }>;
  now?(): Date;
  createId?(): string;
}

const columns = [
  "product_id",
  "product_title",
  "product_handle",
  "product_subtitle",
  "product_description",
  "product_status",
  "collection_id",
  "collection_title",
  "type_id",
  "product_type",
  "discountable",
  "thumbnail_url",
  "image_urls",
  "tags",
  "categories",
  "sales_channels",
  "product_weight",
  "product_length",
  "product_width",
  "product_height",
  "product_origin_country",
  "product_hs_code",
  "product_mid_code",
  "product_material",
  "product_metadata",
  "variant_id",
  "variant_title",
  "variant_sku",
  "variant_barcode",
  "variant_ean",
  "variant_upc",
  "variant_rank",
  "manage_inventory",
  "allow_backorder",
  "inventory_quantity",
  "variant_weight",
  "variant_length",
  "variant_width",
  "variant_height",
  "variant_origin_country",
  "variant_hs_code",
  "variant_mid_code",
  "variant_material",
  "option_values",
  "variant_prices",
  "variant_image_urls",
  "inventory_kit",
  "variant_metadata",
  "created_at",
  "updated_at",
] as const;

const rowFor = (
  item: ProductExportItemDTO,
  variant: ProductExportItemDTO["variants"][number] | null,
) => [
  item.product.id,
  item.product.title,
  item.product.handle,
  item.product.subtitle,
  item.product.description,
  item.product.status,
  item.product.collectionId,
  item.product.collectionTitle,
  item.product.typeId,
  item.product.typeValue,
  item.product.discountable,
  item.product.thumbnailUrl,
  JSON.stringify(item.imageUrls),
  JSON.stringify(item.tags),
  JSON.stringify(item.categories),
  JSON.stringify(
    item.product.salesChannels.map(({ id, name }) => ({ id, name })),
  ),
  item.product.weight,
  item.product.length,
  item.product.width,
  item.product.height,
  item.product.originCountry,
  item.product.hsCode,
  item.product.midCode,
  item.product.material,
  JSON.stringify(item.product.metadata ?? {}),
  variant?.id,
  variant?.title,
  variant?.sku,
  variant?.barcode,
  variant?.ean,
  variant?.upc,
  variant?.rank,
  variant?.manageInventory,
  variant?.allowBackorder,
  variant?.inventoryQuantity,
  variant?.weight,
  variant?.length,
  variant?.width,
  variant?.height,
  variant?.originCountry,
  variant?.hsCode,
  variant?.midCode,
  variant?.material,
  JSON.stringify(variant?.optionValues ?? []),
  JSON.stringify(variant?.prices ?? []),
  JSON.stringify(variant?.imageUrls ?? []),
  JSON.stringify(variant?.inventoryKit ?? []),
  JSON.stringify(variant?.metadata ?? {}),
  variant?.createdAt ?? item.product.createdAt.toISOString(),
  variant?.updatedAt ?? item.product.updatedAt.toISOString(),
];

export function createProductExportService(
  dependencies: ProductExportServiceDependencies,
) {
  return createCsvExportService<ProductExportItemDTO, ProductExportFilters>({
    ...dependencies,
    kind: "products",
    errorPrefix: "PRODUCT_EXPORT",
    pageSize: 25,
    filtersSchema: productExportFiltersSchema,
    columns,
    listItems: dependencies.listItems,
    rowsForItem: (item) =>
      item.variants.length
        ? item.variants.map((variant) => rowFor(item, variant))
        : [rowFor(item, null)],
  });
}

export type ProductExportService = ReturnType<
  typeof createProductExportService
>;
