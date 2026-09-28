import type { CommerceExportStorage } from "@/lib/commerce-export/storage/commerce-export-storage";
import {
  createCsvExportService,
  type CsvExportQueue,
} from "@/lib/commerce-export/service/csv-export.service";
import { z } from "zod";
import type { OrderExportItemDTO } from "./order-export.dto";

export const orderExportFiltersSchema = z
  .object({
    query: z.string().trim().max(200).optional(),
    sortBy: z.enum(["createdAt", "updatedAt"]),
    sortOrder: z.enum(["asc", "desc"]),
  })
  .strict();

export type OrderExportFilters = z.infer<typeof orderExportFiltersSchema>;

export interface OrderExportServiceDependencies {
  storage: CommerceExportStorage;
  queue?: CsvExportQueue;
  listItems(input: OrderExportFilters & {
    page: number;
    limit: number;
    offset: number;
  }): Promise<{ items: OrderExportItemDTO[]; total: number }>;
  now?(): Date;
  createId?(): string;
}

const columns = [
  "id",
  "display_id",
  "custom_display_id",
  "status",
  "email",
  "currency_code",
  "is_draft_order",
  "customer_id",
  "region_id",
  "sales_channel_id",
  "total",
  "created_at",
  "updated_at",
  "canceled_at",
  "shipping_address",
  "billing_address",
  "items",
  "summary",
  "metadata",
] as const;

const addressValue = (address: OrderExportItemDTO["shippingAddress"]) =>
  address
    ? {
        company: address.company,
        first_name: address.firstName,
        last_name: address.lastName,
        address_1: address.address1,
        address_2: address.address2,
        city: address.city,
        province: address.province,
        postal_code: address.postalCode,
        country_code: address.countryCode,
        phone: address.phone,
      }
    : null;

const rowFor = (item: OrderExportItemDTO) => [
  item.order.id,
  item.order.displayId,
  item.order.customDisplayId,
  item.order.status,
  item.order.email,
  item.order.currencyCode,
  item.order.isDraftOrder,
  item.order.customerId,
  item.order.regionId,
  item.order.salesChannelId,
  item.total,
  item.order.createdAt,
  item.order.updatedAt,
  item.order.canceledAt,
  JSON.stringify(addressValue(item.shippingAddress)),
  JSON.stringify(addressValue(item.billingAddress)),
  JSON.stringify(
    item.items.map(({ lineItem, state }) => ({
      id: lineItem.id,
      title: lineItem.title,
      product_title: lineItem.productTitle,
      variant_title: lineItem.variantTitle,
      variant_id: lineItem.variantId,
      product_id: lineItem.productId,
      sku: lineItem.variantSku,
      barcode: lineItem.variantBarcode,
      option_values: lineItem.variantOptionValues,
      quantity: state.quantity,
      fulfilled_quantity: state.fulfilledQuantity,
      shipped_quantity: state.shippedQuantity,
      returned_quantity: state.returnReceivedQuantity,
      unit_price: state.unitPrice ?? lineItem.unitPrice ?? 0,
      compare_at_unit_price:
        state.compareAtUnitPrice ?? lineItem.compareAtUnitPrice,
      is_tax_inclusive: lineItem.isTaxInclusive,
      metadata: lineItem.metadata ?? {},
    })),
  ),
  JSON.stringify(item.summary ?? {}),
  JSON.stringify(item.order.metadata ?? {}),
];

export function createOrderExportService(
  dependencies: OrderExportServiceDependencies,
) {
  return createCsvExportService<OrderExportItemDTO, OrderExportFilters>({
    ...dependencies,
    kind: "orders",
    errorPrefix: "ORDER_EXPORT",
    pageSize: 25,
    filtersSchema: orderExportFiltersSchema,
    columns,
    listItems: dependencies.listItems,
    rowsForItem: (item) => [rowFor(item)],
  });
}

export type OrderExportService = ReturnType<typeof createOrderExportService>;
