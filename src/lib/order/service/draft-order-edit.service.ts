import { customerDal } from "@/lib/customer/dal/customer.dal";
import { findCurrency } from "@/lib/currency/catalog";
import type { JsonValue } from "@/db/json";
import { failure, ok } from "@/lib/db/server-result";
import { draftOrderPromotionDal } from "@/lib/order/dal/draft-order-promotion.dal";
import {
  draftOrderEditDal,
  type DraftOrderEditItemInput,
} from "@/lib/order/dal/draft-order-edit.dal";
import { orderDal } from "@/lib/order/dal/order.dal";
import {
  calculateDraftOrderTotal,
  resolveDraftShippingOptions,
} from "@/lib/order/draft-order";
import { pricingDal } from "@/lib/pricing/dal/pricing.dal";
import { productVariantDal } from "@/lib/product/dal/product-variant.dal";
import { regionDal } from "@/lib/region/dal/region.dal";
import { salesChannelDal } from "@/lib/sales-channel/dal/sales-channel.dal";
import { shippingAvailabilityDal } from "@/lib/shipping/dal/shipping-availability.dal";
import type {
  DraftOrderItemInput,
  updateDraftOrderItemsInputSchema,
} from "@/lib/validations/marketing";
import type { z } from "zod";

export type DraftOrderEditConfirmation = {
  orderChangeId: string;
  expectedUpdatedAt: string;
  actorId?: string;
};

type DraftShippingDescription = ReadonlyMap<string, string>;

export async function updateDraftOrderItemsCore(
  data: z.infer<typeof updateDraftOrderItemsInputSchema>,
  editConfirmation?: DraftOrderEditConfirmation,
  shippingDescriptions?: DraftShippingDescription,
) {
  try {
    const order = await orderDal.findById(data.id);
    if (!order)
      return failure(
        "Update draft order items error",
        new Error("Order not found"),
        "NOT_FOUND",
        "Draft order not found",
      );
    if (!order.isDraftOrder || order.status !== "draft")
      return failure(
        "Update draft order items error",
        new Error("Order is not an active draft"),
        "NOT_DRAFT",
        "Only an active draft order can be edited",
      );
    if (order.version !== data.expectedVersion)
      return failure(
        "Update draft order items error",
        new Error("Draft order changed"),
        "VERSION_CONFLICT",
        "This draft changed while you were editing it. Reload and review the latest items.",
      );
    if (!findCurrency(order.currencyCode))
      return failure(
        "Update draft order items error",
        new Error("Unsupported currency"),
        "INVALID_CURRENCY",
        "The order currency is no longer supported",
      );

    const [customer, region, salesChannel] = await Promise.all([
      order.customerId ? customerDal.findById(order.customerId) : null,
      order.regionId ? regionDal.findDetail(order.regionId) : null,
      order.salesChannelId
        ? salesChannelDal.findById(order.salesChannelId)
        : null,
    ]);
    if (order.customerId && !customer)
      return failure(
        "Update draft order items error",
        new Error("Customer not found"),
        "CUSTOMER_NOT_FOUND",
        "The customer on this order is no longer available",
      );
    if (order.regionId && !region)
      return failure(
        "Update draft order items error",
        new Error("Region not found"),
        "REGION_NOT_FOUND",
        "The region on this order is no longer available",
      );
    if (region && region.currencyCode !== order.currencyCode)
      return failure(
        "Update draft order items error",
        new Error("Region currency mismatch"),
        "REGION_CURRENCY_MISMATCH",
        "The order currency does not match its region",
      );
    if (order.salesChannelId && !salesChannel)
      return failure(
        "Update draft order items error",
        new Error("Sales channel not found"),
        "SALES_CHANNEL_NOT_FOUND",
        "The sales channel on this order is no longer available",
      );
    if (salesChannel?.isDisabled)
      return failure(
        "Update draft order items error",
        new Error("Sales channel is disabled"),
        "SALES_CHANNEL_DISABLED",
        "The sales channel on this order is disabled",
      );

    const items: Parameters<typeof orderDal.updateDraftItems>[3] = [];
    for (const item of data.items) {
      if (item.type === "custom") {
        items.push({
          id: crypto.randomUUID(),
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
        order.salesChannelId ?? undefined,
      );
      if (!snapshot)
        return failure(
          "Update draft order items error",
          new Error("Product variant is unavailable"),
          "VARIANT_UNAVAILABLE",
          "A selected product variant is no longer available in this sales channel",
        );
      const resolvedPrice = await pricingDal.resolveVariantPrice(
        item.variantId,
        {
          currencyCode: order.currencyCode,
          quantity: item.quantity,
          ...(order.regionId ? { regionId: order.regionId } : {}),
          ...(order.salesChannelId
            ? { salesChannelId: order.salesChannelId }
            : {}),
          ...(customer ? { customerId: customer.id } : {}),
        },
      );
      if (!item.customPrice && !resolvedPrice)
        return failure(
          "Update draft order items error",
          new Error("No price exists for the selected variant"),
          "NO_PRICE",
          `${snapshot.title} has no price in ${order.currencyCode.toUpperCase()}. Set a custom price or remove the item.`,
        );
      items.push({
        id: crypto.randomUUID(),
        ...snapshot,
        isTaxInclusive: region?.isTaxInclusive ?? false,
        isCustomPrice: item.customPrice,
        unitPrice: item.customPrice ? item.unitPrice! : resolvedPrice!.amount,
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
        "Update draft order items error",
        new Error("Draft order total exceeds the supported range"),
        "INVALID_TOTAL",
        "The draft order total is too large",
      );

    const promotionLines = items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      isDiscountable: item.isDiscountable,
      attributes: {
        variant_id: item.variantId ?? null,
        product_id: item.productId ?? null,
        product_type_id: item.productTypeId ?? null,
        product_collection_id: item.productCollectionId ?? null,
        product_handle: item.productHandle ?? null,
        sku: item.variantSku ?? null,
      },
    }));
    const promotionContext = {
      codes: data.promotionCodes,
      currencyCode: order.currencyCode,
      regionId: order.regionId,
      salesChannelId: order.salesChannelId,
      customerId: order.customerId,
      email: data.email?.trim() || null,
      items: promotionLines,
    };
    const itemPromotionPreview = await draftOrderPromotionDal.evaluate({
      ...promotionContext,
      shipping: [],
    });
    if (!itemPromotionPreview.success)
      return failure(
        "Update draft order items error",
        new Error(itemPromotionPreview.reason),
        itemPromotionPreview.reason,
        itemPromotionPreview.reason === "NOT_FOUND"
          ? "A promotion code could not be found"
          : itemPromotionPreview.reason === "INACTIVE"
            ? "A promotion code is no longer active"
            : "Review the promotion codes and try again",
      );
    const itemDiscountTotal = itemPromotionPreview.itemAdjustments.reduce(
      (sum, adjustment) => sum + adjustment.amount,
      0,
    );

    let shippingMethods: Array<{
      id: string;
      shippingOptionId: string;
      name: string;
      description?: string;
      amount: number;
      isCustomAmount: boolean;
    }> = [];
    if (data.shippingOptionIds.length) {
      const itemSubtotal = calculateDraftOrderTotal(items)!;
      const quote =
        region && order.salesChannelId
          ? await shippingAvailabilityDal.quote({
              owner: { type: "order", id: order.id },
              regionId: region.id,
              salesChannelId: order.salesChannelId,
              currencyCode: order.currencyCode,
              shippingAddress: data.shippingAddress
                ? {
                    countryCode: data.shippingAddress.countryCode,
                    provinceCode: data.shippingAddress.province,
                    city: data.shippingAddress.city,
                    postalCode: data.shippingAddress.postalCode,
                  }
                : null,
              items: items.map((item) => ({
                productId:
                  "productId" in item ? (item.productId ?? null) : null,
                requiresShipping: item.requiresShipping,
                quantity: item.quantity,
              })),
              itemSubtotal,
              itemDiscountTotal,
            })
          : { availableOptions: [], requiredShippingProfiles: [] };
      const selected = resolveDraftShippingOptions({
        selectedOptionIds: data.shippingOptionIds,
        availableOptions: quote.availableOptions,
        requiredShippingProfiles: quote.requiredShippingProfiles,
        customAmounts: data.shippingCustomAmounts,
      });
      if (!selected)
        return failure(
          "Update draft order items error",
          new Error("Shipping option unavailable"),
          "SHIPPING_OPTION_UNAVAILABLE",
          "Choose one available shipping option for each required shipping profile, or clear the shipping selection.",
        );
      shippingMethods = selected.map((option) => ({
        id: crypto.randomUUID(),
        shippingOptionId: option.id,
        name: option.name,
        amount: option.amount,
        isCustomAmount: option.isCustomAmount === true,
        ...(shippingDescriptions?.has(option.id)
          ? { description: shippingDescriptions.get(option.id)! }
          : {}),
      }));
    }

    const promotionEvaluation = await draftOrderPromotionDal.evaluate({
      ...promotionContext,
      shipping: shippingMethods.map((method) => ({
        id: method.id,
        quantity: 1,
        unitPrice: method.amount,
        isDiscountable: true,
        shippingOptionId: method.shippingOptionId,
        attributes: { name: method.name },
      })),
    });
    if (!promotionEvaluation.success)
      return failure(
        "Update draft order items error",
        new Error(promotionEvaluation.reason),
        promotionEvaluation.reason,
        promotionEvaluation.reason === "NOT_FOUND"
          ? "A promotion code could not be found"
          : promotionEvaluation.reason === "INACTIVE"
            ? "A promotion code is no longer active"
            : "Review the promotion codes and try again",
      );

    const updated = await orderDal.updateDraftItems(
      data.id,
      data.expectedVersion,
      {
        email: data.email,
        noNotification: data.noNotification,
        shippingAddress: data.shippingAddress,
        billingAddress: data.billingAddress,
        shippingMethods,
        promotionEvaluation,
        ...(editConfirmation ? { editConfirmation } : {}),
      },
      items,
    );
    if (!updated.success) {
      const message = {
        NOT_FOUND: "Draft order not found",
        NOT_DRAFT: "Only an active draft order can be edited",
        VERSION_CONFLICT:
          "This draft changed while you were editing it. Reload and review the latest items.",
        HAS_ADJUSTMENTS:
          "This draft has shipping, tax, payment, or other charges that must be recalculated before its items can change.",
        SHIPPING_OPTION_UNAVAILABLE:
          "The selected shipping option is no longer available. Choose another option or clear the shipping selection.",
        INVALID_TOTAL: "The draft order total is too large",
        EDIT_CONFLICT:
          "This draft edit changed while it was being confirmed. Reload and review the latest changes.",
        EMPTY_EDIT: "Add at least one change before confirming this edit",
      }[updated.reason];
      return failure(
        "Update draft order items error",
        new Error(updated.reason),
        updated.reason,
        message,
      );
    }
    return ok("Draft order items updated", {
      id: data.id,
      version: updated.version,
    });
  } catch (error) {
    return failure(
      "Update draft order items error",
      error,
      "UPDATE_FAILED",
      "Failed to update draft order items",
    );
  }
}

export async function beginDraftOrderEdit(input: {
  orderId: string;
  expectedVersion: number;
  actorId?: string;
}) {
  return draftOrderEditDal.begin(
    input.orderId,
    input.expectedVersion,
    input.actorId,
  );
}

export async function addDraftOrderEditPromotions(input: {
  orderId: string;
  codes: string[];
}) {
  return draftOrderEditDal.addPromotions(input.orderId, input.codes);
}

export async function removeDraftOrderEditPromotions(input: {
  orderId: string;
  codes: string[];
}) {
  return draftOrderEditDal.removePromotions(input.orderId, input.codes);
}

export async function updateDraftOrderEditFields(input: {
  orderId: string;
  email?: string;
  noNotification?: boolean;
  shippingAddress?: JsonValue;
  billingAddress?: JsonValue;
}) {
  return draftOrderEditDal.updateOrderFields(input);
}

export async function addDraftOrderEditShippingMethod(input: {
  orderId: string;
  shippingOptionId: string;
  customAmount?: number;
  description?: string;
  internalNote?: string;
}) {
  const context = await orderDal.findDraftShippingContext(input.orderId);
  if (!context)
    return { success: false as const, reason: "NOT_FOUND" as const };
  if (
    !context.order.isDraftOrder ||
    context.order.status !== "draft" ||
    context.order.canceledAt
  )
    return { success: false as const, reason: "NOT_DRAFT" as const };
  if (!context.order.regionId || !context.order.salesChannelId)
    return {
      success: false as const,
      reason: "SHIPPING_OPTION_UNAVAILABLE" as const,
    };
  if (
    input.customAmount !== undefined &&
    (!Number.isSafeInteger(input.customAmount) ||
      input.customAmount < 0 ||
      input.customAmount > 2_147_483_647)
  )
    return {
      success: false as const,
      reason: "SHIPPING_OPTION_UNAVAILABLE" as const,
    };
  const region = await regionDal.findDetail(context.order.regionId);
  if (!region)
    return { success: false as const, reason: "REGION_NOT_FOUND" as const };
  const itemSubtotal = calculateDraftOrderTotal(context.items);
  if (itemSubtotal === null)
    return { success: false as const, reason: "INVALID_TOTAL" as const };
  const quote = await shippingAvailabilityDal.quote({
    owner: { type: "order", id: input.orderId },
    regionId: context.order.regionId,
    salesChannelId: context.order.salesChannelId,
    currencyCode: context.order.currencyCode,
    shippingAddress: context.shippingAddress
      ? {
          countryCode: context.shippingAddress.countryCode,
          provinceCode: context.shippingAddress.province,
          city: context.shippingAddress.city,
          postalCode: context.shippingAddress.postalCode,
        }
      : null,
    items: context.items.map((item) => ({
      productId: item.productId,
      requiresShipping: item.requiresShipping,
      quantity: item.quantity,
    })),
    itemSubtotal,
    itemDiscountTotal: context.itemDiscountTotal,
  });
  const option = quote.availableOptions.find(
    (candidate) => candidate.id === input.shippingOptionId,
  );
  if (!option || !option.shippingProfileId)
    return {
      success: false as const,
      reason: "SHIPPING_OPTION_UNAVAILABLE" as const,
    };
  return draftOrderEditDal.addShippingMethod({
    orderId: input.orderId,
    shippingOptionId: option.id,
    shippingProfileId: option.shippingProfileId,
    ...(input.customAmount !== undefined
      ? { customAmount: input.customAmount }
      : {}),
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
    ...(input.internalNote !== undefined
      ? { internalNote: input.internalNote }
      : {}),
  });
}

export async function updateDraftOrderEditShippingMethod(input: {
  orderId: string;
  methodId: string;
  customAmount?: number;
  description?: string;
  internalNote?: string;
}) {
  return draftOrderEditDal.updateShippingMethod(input);
}

export async function updateDraftOrderEditShippingAction(input: {
  orderId: string;
  actionId: string;
  customAmount?: number;
  description?: string;
  internalNote?: string;
}) {
  return draftOrderEditDal.updateAddedShippingMethod(input);
}

export async function removeDraftOrderEditShippingMethod(input: {
  orderId: string;
  methodId: string;
}) {
  return draftOrderEditDal.removeShippingMethod(input);
}

export async function removeDraftOrderEditShippingAction(input: {
  orderId: string;
  actionId: string;
}) {
  return draftOrderEditDal.removeAddedShippingMethod(input);
}

export async function confirmDraftOrderEdit(input: {
  orderId: string;
  actorId?: string;
}) {
  const context = await orderDal.findDraftShippingContext(input.orderId);
  if (!context)
    return { success: false as const, reason: "NOT_FOUND" as const };
  if (
    !context.order.isDraftOrder ||
    context.order.status !== "draft" ||
    context.order.canceledAt
  )
    return { success: false as const, reason: "NOT_DRAFT" as const };
  const [edit, page] = await Promise.all([
    draftOrderEditDal.get(input.orderId),
    orderDal.listItemsPage({ orderId: input.orderId, page: 1, limit: 100 }),
  ]);
  if (!edit)
    return { success: false as const, reason: "EDIT_NOT_FOUND" as const };
  if (edit.version !== context.order.version + 1)
    return { success: false as const, reason: "VERSION_CONFLICT" as const };
  if (!edit.actions.length)
    return { success: false as const, reason: "EMPTY_EDIT" as const };

  const projected = new Map<string, DraftOrderItemInput>();
  for (const item of page.items) {
    projected.set(item.id, {
      type: item.variantId ? "variant" : "custom",
      ...(item.variantId
        ? {
            variantId: item.variantId,
            customPrice: item.isCustomPrice,
            ...(item.compareAtUnitPrice !== null &&
            item.compareAtUnitPrice !== undefined
              ? { compareAtUnitPrice: item.compareAtUnitPrice }
              : {}),
            ...(item.isCustomPrice ? { unitPrice: item.unitPrice } : {}),
          }
        : {
            title: item.title,
            ...(item.sku ? { sku: item.sku } : {}),
            unitPrice: item.unitPrice,
            ...(item.compareAtUnitPrice !== null &&
            item.compareAtUnitPrice !== undefined
              ? { compareAtUnitPrice: item.compareAtUnitPrice }
              : {}),
          }),
      quantity: item.quantity,
    } as DraftOrderItemInput);
  }
  const projectedShipping = context.selectedShippingMethods.map((method) => ({
    ...method,
  }));
  const promotionCodes = [...context.appliedPromotionCodes];
  let projectedEmail = context.order.email ?? "";
  let projectedNoNotification = context.order.noNotification ?? false;
  let projectedShippingAddress = toAddress(context.shippingAddress);
  let projectedBillingAddress = toAddress(context.billingAddress);
  for (const action of edit.actions) {
    const details = toRecord(action.details);
    if (!details)
      return { success: false as const, reason: "INVALID_ACTION" as const };
    if (action.action === "ITEM_ADD") {
      const item = parseDraftEditItem(details.item);
      if (!item)
        return { success: false as const, reason: "INVALID_ACTION" as const };
      projected.set(`add:${action.id}`, toDraftOrderItemInput(item));
      continue;
    }
    if (action.action === "ITEM_REMOVE") {
      if (!action.referenceId || !projected.delete(action.referenceId))
        return { success: false as const, reason: "INVALID_ACTION" as const };
      continue;
    }
    if (action.action === "ITEM_UPDATE" && action.referenceId) {
      const current = projected.get(action.referenceId);
      if (!current)
        return { success: false as const, reason: "INVALID_ACTION" as const };
      const quantity = readPositiveInteger(details.quantity);
      const unitPrice = readNonNegativeInteger(details.unitPrice);
      const compareAtUnitPrice = readNonNegativeInteger(
        details.compareAtUnitPrice,
      );
      projected.set(
        action.referenceId,
        current.type === "variant"
          ? {
              ...current,
              ...(quantity !== null ? { quantity } : {}),
              ...(unitPrice !== null ? { customPrice: true, unitPrice } : {}),
              ...(compareAtUnitPrice !== null ? { compareAtUnitPrice } : {}),
            }
          : {
              ...current,
              ...(quantity !== null ? { quantity } : {}),
              ...(unitPrice !== null ? { unitPrice } : {}),
              ...(compareAtUnitPrice !== null ? { compareAtUnitPrice } : {}),
            },
      );
      continue;
    }
    if (
      action.action === "PROMOTION_ADD" ||
      action.action === "PROMOTION_REMOVE"
    ) {
      const code = typeof details.code === "string" ? details.code.trim() : "";
      if (!code)
        return { success: false as const, reason: "INVALID_ACTION" as const };
      const normalizedCode = code.toUpperCase();
      const index = promotionCodes.findIndex(
        (candidate) => candidate.toUpperCase() === normalizedCode,
      );
      if (action.action === "PROMOTION_ADD" && index < 0)
        promotionCodes.push(code);
      if (action.action === "PROMOTION_REMOVE" && index >= 0)
        promotionCodes.splice(index, 1);
      continue;
    }
    if (action.action === "ORDER_UPDATE") {
      if (details.email !== undefined) {
        if (typeof details.email !== "string")
          return { success: false as const, reason: "INVALID_ACTION" as const };
        projectedEmail = details.email;
      }
      if (details.noNotification !== undefined) {
        if (typeof details.noNotification !== "boolean")
          return { success: false as const, reason: "INVALID_ACTION" as const };
        projectedNoNotification = details.noNotification;
      }
      if (details.shippingAddress !== undefined) {
        const address = parseEditAddress(details.shippingAddress);
        if (address === undefined)
          return { success: false as const, reason: "INVALID_ACTION" as const };
        projectedShippingAddress = address;
      }
      if (details.billingAddress !== undefined) {
        const address = parseEditAddress(details.billingAddress);
        if (address === undefined)
          return { success: false as const, reason: "INVALID_ACTION" as const };
        projectedBillingAddress = address;
      }
      continue;
    }
    if (action.action === "SHIPPING_ADD") {
      if (
        typeof details.shippingOptionId !== "string" ||
        typeof details.shippingProfileId !== "string"
      )
        return { success: false as const, reason: "INVALID_ACTION" as const };
      const customAmount =
        details.customAmount === undefined
          ? null
          : readNonNegativeInteger(details.customAmount);
      if (details.customAmount !== undefined && customAmount === null)
        return { success: false as const, reason: "INVALID_ACTION" as const };
      for (let index = projectedShipping.length - 1; index >= 0; index -= 1)
        if (
          projectedShipping[index]?.shippingProfileId ===
          details.shippingProfileId
        )
          projectedShipping.splice(index, 1);
      projectedShipping.push({
        id: action.id,
        shippingOptionId: details.shippingOptionId,
        shippingProfileId: details.shippingProfileId,
        name: "",
        amount: customAmount ?? 0,
        isCustomAmount: customAmount !== null,
        description:
          typeof details.description === "string" ? details.description : null,
      });
      continue;
    }
    if (action.action === "SHIPPING_REMOVE" && action.referenceId) {
      const index = projectedShipping.findIndex(
        (method) => method.id === action.referenceId,
      );
      if (index < 0)
        return { success: false as const, reason: "INVALID_ACTION" as const };
      projectedShipping.splice(index, 1);
      continue;
    }
    if (action.action === "SHIPPING_UPDATE" && action.referenceId) {
      const index = projectedShipping.findIndex(
        (method) => method.id === action.referenceId,
      );
      if (index < 0)
        return { success: false as const, reason: "INVALID_ACTION" as const };
      const current = projectedShipping[index];
      if (!current)
        return { success: false as const, reason: "INVALID_ACTION" as const };
      const customAmount =
        details.customAmount === undefined
          ? null
          : readNonNegativeInteger(details.customAmount);
      if (details.customAmount !== undefined && customAmount === null)
        return { success: false as const, reason: "INVALID_ACTION" as const };
      projectedShipping[index] = {
        ...current,
        ...(customAmount !== null
          ? { amount: customAmount, isCustomAmount: true }
          : {}),
        ...(typeof details.description === "string"
          ? { description: details.description }
          : {}),
      };
    }
  }
  if (!projected.size)
    return { success: false as const, reason: "EMPTY_ORDER" as const };
  if (projected.size > 40)
    return { success: false as const, reason: "TOO_MANY_ITEMS" as const };

  const result = await updateDraftOrderItemsCore(
    {
      id: input.orderId,
      expectedVersion: context.order.version,
      shippingAddress: projectedShippingAddress,
      billingAddress: projectedBillingAddress,
      shippingOptionIds: [
        ...new Set(
          projectedShipping.flatMap((method) =>
            method.shippingOptionId ? [method.shippingOptionId] : [],
          ),
        ),
      ],
      shippingCustomAmounts: projectedShipping.flatMap((method) =>
        method.isCustomAmount && method.shippingOptionId
          ? [
              {
                shippingOptionId: method.shippingOptionId,
                amount: method.amount,
              },
            ]
          : [],
      ),
      promotionCodes,
      email: projectedEmail,
      noNotification: projectedNoNotification,
      items: [...projected.values()],
    },
    {
      orderChangeId: edit.id,
      expectedUpdatedAt: edit.updatedAt,
      actorId: input.actorId,
    },
    new Map(
      projectedShipping.flatMap((method) =>
        typeof method.description === "string"
          ? [[method.shippingOptionId ?? "", method.description] as const]
          : [],
      ),
    ),
  );
  if (result.success)
    return {
      success: true as const,
      editId: edit.id,
      orderId: input.orderId,
      version: result.data.version,
    };
  const knownReasons = [
    "NOT_FOUND",
    "NOT_DRAFT",
    "VERSION_CONFLICT",
    "CUSTOMER_NOT_FOUND",
    "REGION_NOT_FOUND",
    "REGION_CURRENCY_MISMATCH",
    "SALES_CHANNEL_NOT_FOUND",
    "SALES_CHANNEL_DISABLED",
    "VARIANT_UNAVAILABLE",
    "NO_PRICE",
    "INVALID_TOTAL",
    "HAS_ADJUSTMENTS",
    "SHIPPING_OPTION_UNAVAILABLE",
    "EDIT_CONFLICT",
    "EMPTY_EDIT",
  ] as const;
  const reason: (typeof knownReasons)[number] | "UPDATE_FAILED" =
    knownReasons.includes(result.error as (typeof knownReasons)[number])
      ? (result.error as (typeof knownReasons)[number])
      : "UPDATE_FAILED";
  return { success: false as const, reason, message: result.message };
}

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readPositiveInteger = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;

const readNonNegativeInteger = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;

const parseDraftEditItem = (value: unknown): DraftOrderEditItemInput | null => {
  const item = toRecord(value);
  if (!item) return null;
  const quantity = readPositiveInteger(item.quantity);
  if (!quantity) return null;
  if (typeof item.variantId === "string")
    return {
      variantId: item.variantId,
      quantity,
      ...(readNonNegativeInteger(item.unitPrice) !== null
        ? { unitPrice: readNonNegativeInteger(item.unitPrice)! }
        : {}),
      ...(readNonNegativeInteger(item.compareAtUnitPrice) !== null
        ? {
            compareAtUnitPrice: readNonNegativeInteger(
              item.compareAtUnitPrice,
            )!,
          }
        : {}),
    };
  if (typeof item.title === "string" && item.title.trim()) {
    const unitPrice = readNonNegativeInteger(item.unitPrice);
    if (unitPrice === null) return null;
    return {
      title: item.title.trim(),
      ...(typeof item.sku === "string" ? { sku: item.sku } : {}),
      quantity,
      unitPrice,
      ...(readNonNegativeInteger(item.compareAtUnitPrice) !== null
        ? {
            compareAtUnitPrice: readNonNegativeInteger(
              item.compareAtUnitPrice,
            )!,
          }
        : {}),
    };
  }
  return null;
};

const toDraftOrderItemInput = (
  item: DraftOrderEditItemInput,
): DraftOrderItemInput =>
  "variantId" in item
    ? {
        type: "variant",
        variantId: item.variantId,
        quantity: item.quantity,
        customPrice: item.unitPrice !== undefined,
        ...(item.unitPrice !== undefined ? { unitPrice: item.unitPrice } : {}),
        ...(item.compareAtUnitPrice !== undefined
          ? { compareAtUnitPrice: item.compareAtUnitPrice }
          : {}),
      }
    : {
        type: "custom",
        title: item.title,
        ...(item.sku ? { sku: item.sku } : {}),
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        ...(item.compareAtUnitPrice !== undefined
          ? { compareAtUnitPrice: item.compareAtUnitPrice }
          : {}),
      };

const toAddress = (
  address: {
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    countryCode: string | null;
    phone: string | null;
  } | null,
) =>
  address
    ? {
        firstName: address.firstName ?? "",
        lastName: address.lastName ?? "",
        company: address.company ?? "",
        address1: address.address1 ?? "",
        address2: address.address2 ?? "",
        city: address.city ?? "",
        province: address.province ?? "",
        postalCode: address.postalCode ?? "",
        countryCode: address.countryCode ?? "",
        phone: address.phone ?? "",
      }
    : null;

const editAddressFields = [
  "firstName",
  "lastName",
  "company",
  "address1",
  "address2",
  "city",
  "province",
  "postalCode",
  "countryCode",
  "phone",
] as const;

const parseEditAddress = (
  value: unknown,
): NonNullable<ReturnType<typeof toAddress>> | null | undefined => {
  if (value === null) return null;
  const record = toRecord(value);
  if (!record) return undefined;
  if (
    editAddressFields.some(
      (field) =>
        !Object.hasOwn(record, field) ||
        (record[field] !== null && typeof record[field] !== "string"),
    )
  )
    return undefined;
  return Object.fromEntries(
    editAddressFields.map((field) => [
      field,
      typeof record[field] === "string" ? record[field] : "",
    ]),
  ) as NonNullable<ReturnType<typeof toAddress>>;
};
