import { customerDal } from "@/lib/customer/dal/customer.dal";
import { findCurrency } from "@/lib/currency/catalog";
import { calculateDraftOrderTotal } from "@/lib/order/draft-order";
import { orderDal } from "@/lib/order/dal/order.dal";
import { pricingDal } from "@/lib/pricing/dal/pricing.dal";
import { productVariantDal } from "@/lib/product/dal/product-variant.dal";
import { regionDal } from "@/lib/region/dal/region.dal";
import { salesChannelDal } from "@/lib/sales-channel/dal/sales-channel.dal";
import { failure, ok, type ServerResult } from "@/lib/db/server-result";
import type { createOrderInputSchema } from "@/lib/validations/marketing";
import type { z } from "zod";

export type CreateDraftOrderInput = z.infer<typeof createOrderInputSchema>;
export type CreateDraftOrderResult = ServerResult<{
  id: string;
  displayId: number;
}>;

/** Shared by Dashboard and Admin REST so both use the same pricing snapshots and guards. */
export async function createDraftOrder(
  data: CreateDraftOrderInput,
): Promise<CreateDraftOrderResult> {
  try {
    if (!findCurrency(data.currencyCode))
      return failure(
        "Create order error",
        new Error("Unsupported currency"),
        "INVALID_CURRENCY",
        "Select a supported currency",
      );

    const [customer, region, salesChannel] = await Promise.all([
      data.customerId ? customerDal.findById(data.customerId) : null,
      data.regionId ? regionDal.findDetail(data.regionId) : null,
      data.salesChannelId
        ? salesChannelDal.findById(data.salesChannelId)
        : null,
    ]);
    if (data.customerId && !customer)
      return failure(
        "Create order error",
        new Error("Customer not found"),
        "CUSTOMER_NOT_FOUND",
        "The selected customer no longer exists",
      );
    if (data.regionId && !region)
      return failure(
        "Create order error",
        new Error("Region not found"),
        "REGION_NOT_FOUND",
        "The selected region no longer exists",
      );
    if (region && region.currencyCode !== data.currencyCode)
      return failure(
        "Create order error",
        new Error("Region currency mismatch"),
        "REGION_CURRENCY_MISMATCH",
        `Use ${region.currencyCode.toUpperCase()} for the selected region`,
      );
    if (data.salesChannelId && !salesChannel)
      return failure(
        "Create order error",
        new Error("Sales channel not found"),
        "SALES_CHANNEL_NOT_FOUND",
        "The selected sales channel no longer exists",
      );
    if (salesChannel?.isDisabled)
      return failure(
        "Create order error",
        new Error("Sales channel is disabled"),
        "SALES_CHANNEL_DISABLED",
        "Choose an active sales channel",
      );

    const items: Parameters<typeof orderDal.create>[0]["items"] = [];
    for (const item of data.items) {
      if (item.type === "custom") {
        items.push({
          title: item.title,
          variantSku: item.sku || null,
          requiresShipping: true,
          isDiscountable: true,
          isGiftcard: false,
          isTaxInclusive: region?.isTaxInclusive ?? false,
          isCustomPrice: true,
          unitPrice: item.unitPrice,
          compareAtUnitPrice: item.compareAtUnitPrice ?? null,
          quantity: item.quantity,
        });
        continue;
      }

      const snapshot = await productVariantDal.findOrderSnapshot(
        item.variantId,
        data.salesChannelId,
      );
      if (!snapshot)
        return failure(
          "Create order error",
          new Error("Product variant is unavailable"),
          "VARIANT_UNAVAILABLE",
          "A selected product variant is no longer available in this sales channel",
        );
      const resolvedPrice = await pricingDal.resolveVariantPrice(
        item.variantId,
        {
          currencyCode: data.currencyCode,
          quantity: item.quantity,
          ...(data.regionId ? { regionId: data.regionId } : {}),
          ...(data.salesChannelId
            ? { salesChannelId: data.salesChannelId }
            : {}),
          ...(customer ? { customerId: customer.id } : {}),
        },
      );
      if (!item.customPrice && !resolvedPrice)
        return failure(
          "Create order error",
          new Error("No price exists for the selected variant"),
          "NO_PRICE",
          `${snapshot.title} has no price in ${data.currencyCode.toUpperCase()}. Set a custom price or choose another currency.`,
        );
      const unitPrice = item.customPrice
        ? item.unitPrice!
        : resolvedPrice!.amount;
      items.push({
        ...snapshot,
        isTaxInclusive: region?.isTaxInclusive ?? false,
        isCustomPrice: item.customPrice,
        unitPrice,
        compareAtUnitPrice:
          item.compareAtUnitPrice ??
          (!item.customPrice && resolvedPrice?.priceListType === "sale"
            ? resolvedPrice.originalAmount
            : null),
        quantity: item.quantity,
      });
    }

    if (calculateDraftOrderTotal(items) === null)
      return failure(
        "Create order error",
        new Error("Draft order total exceeds the supported range"),
        "INVALID_TOTAL",
        "The draft order total is too large",
      );

    const created = await orderDal.create({
      id: crypto.randomUUID(),
      email: data.email?.trim() || customer?.email || undefined,
      customerId: customer?.id,
      regionId: region?.id,
      salesChannelId: salesChannel?.id,
      shippingAddress: data.shippingAddress,
      billingAddress: data.billingAddress,
      currencyCode: data.currencyCode,
      noNotification: data.noNotification,
      metadata: data.metadata,
      items,
    });
    return ok(`Draft order #${created.displayId} created`, created);
  } catch (error) {
    return failure(
      "Create order error",
      error,
      "CREATE_FAILED",
      "Failed to create order",
    );
  }
}
