import { orderDal } from "@/lib/order/dal/order.dal";
import { orderEditService } from "@/lib/order/service/order-edit.service";
import { createDraftOrder } from "@/lib/order/service/draft-order-write.service";
import { convertDraftOrderAndNotifyCustomer } from "@/lib/order/service/order-notification.service";
import { updateDraftOrderItemsCore } from "@/lib/order/service/draft-order-edit.service";
import { customerDal } from "@/lib/customer/dal/customer.dal";
import { regionDal } from "@/lib/region/dal/region.dal";
import { salesChannelDal } from "@/lib/sales-channel/dal/sales-channel.dal";
import { productVariantDal } from "@/lib/product/dal/product-variant.dal";
import { pricingDal } from "@/lib/pricing/dal/pricing.dal";
import { findCurrency } from "@/lib/currency/catalog";
import { shippingAvailabilityDal } from "@/lib/shipping/dal/shipping-availability.dal";
import { failure, ok, paginationOf, parseInput } from "@/lib/db/server-result";
import {
  createOrderInputSchema,
  convertDraftOrderInputSchema,
  getMarketingRecordInputSchema,
  listDraftShippingOptionsInputSchema,
  listOrdersInputSchema,
  searchDraftOrderVariantsInputSchema,
  updateDraftOrderItemsInputSchema,
  updateMarketingMetadataInputSchema,
  updateOrderInputSchema,
} from "@/lib/validations/marketing";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

export const listOrders = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(listOrdersInputSchema, data ?? {}))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const page = await orderDal.listPage(data);
      return ok("Orders fetched successfully", {
        orders: page.orders,
        pagination: paginationOf(page.total, data.page, data.limit),
      });
    } catch (error) {
      return failure(
        "List orders error",
        error,
        "LIST_FAILED",
        "Failed to fetch orders",
      );
    }
  });

export const getOrder = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(getMarketingRecordInputSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const order = await orderDal.findById(data.id);
      return order
        ? ok("Order fetched successfully", order)
        : {
            success: false as const,
            message: "Order not found",
            data: null,
            error: "NOT_FOUND",
          };
    } catch (error) {
      return failure(
        "Get order error",
        error,
        "GET_FAILED",
        "Failed to fetch order",
      );
    }
  });

export const listDraftShippingOptions = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(listDraftShippingOptionsInputSchema, data),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    const data = input.data;
    try {
      const context = await orderDal.findDraftShippingContext(data.id);
      if (!context)
        return failure(
          "List draft shipping options error",
          new Error("Draft order not found"),
          "NOT_FOUND",
          "Draft order not found",
        );
      if (
        !context.order.isDraftOrder ||
        context.order.status !== "draft" ||
        context.order.canceledAt
      )
        return failure(
          "List draft shipping options error",
          new Error("Order is not an active draft"),
          "NOT_DRAFT",
          "Shipping options are only available for active draft orders",
        );
      if (context.order.version !== data.expectedVersion)
        return failure(
          "List draft shipping options error",
          new Error("Draft order changed"),
          "VERSION_CONFLICT",
          "This draft changed. Reload it before choosing shipping",
        );
      const quote =
        context.order.regionId && context.order.salesChannelId
          ? await shippingAvailabilityDal.quote({
              owner: { type: "order", id: context.order.id },
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
              itemSubtotal: context.itemSubtotal,
              itemDiscountTotal: context.itemDiscountTotal,
            })
          : { availableOptions: [], requiredShippingProfiles: [] };
      return ok("Draft shipping options fetched", {
        ...quote,
        selectedShippingOptionIds: context.selectedShippingOptionIds,
        selectedShippingMethods: context.selectedShippingMethods,
        appliedPromotionCodes: context.appliedPromotionCodes,
        hasCustomShippingMethod: context.hasCustomShippingMethod,
      });
    } catch (error) {
      return failure(
        "List draft shipping options error",
        error,
        "LIST_FAILED",
        "Failed to fetch draft shipping options",
      );
    }
  });

const orderDetailListSchema = z.object({
  orderId: z.uuid("Invalid order ID"),
  page: z.number().int().min(1),
  limit: z.number().int().min(1).max(100),
});

export const listOrderItems = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(orderDetailListSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const page = await orderDal.listItemsPage(data);
      return ok("Order items fetched successfully", {
        items: page.items,
        pagination: paginationOf(page.total, data.page, data.limit),
      });
    } catch (error) {
      return failure(
        "List order items error",
        error,
        "LIST_FAILED",
        "Failed to fetch order items",
      );
    }
  });

export const listOrderFulfillments = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(orderDetailListSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const page = await orderDal.listFulfillmentsPage(data);
      return ok("Order fulfillments fetched successfully", {
        fulfillments: page.fulfillments,
        pagination: paginationOf(page.total, data.page, data.limit),
      });
    } catch (error) {
      return failure(
        "List order fulfillments error",
        error,
        "LIST_FAILED",
        "Failed to fetch order fulfillments",
      );
    }
  });

export const getOrderFulfillableItems = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(getMarketingRecordInputSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const items = await orderDal.listFulfillableItems(data.id, 100);
      if (items.length > 100) {
        return {
          success: false as const,
          message: "A fulfillment may contain at most 100 line items",
          data: null,
          error: "LIMIT_EXCEEDED",
        };
      }
      return ok("Fulfillable order items fetched successfully", { items });
    } catch (error) {
      return failure(
        "Get fulfillable order items error",
        error,
        "GET_FAILED",
        "Failed to fetch fulfillable order items",
      );
    }
  });

export const createOrder = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(createOrderInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    return createDraftOrder(input.data);
  });

export const updateDraftOrderItems = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(updateDraftOrderItemsInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    return updateDraftOrderItemsCore(input.data);
  });

export const searchDraftOrderVariants = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(searchDraftOrderVariantsInputSchema, data),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    const data = input.data;
    if (!findCurrency(data.currencyCode))
      return failure(
        "Search draft order variants error",
        new Error("Unsupported currency"),
        "INVALID_CURRENCY",
        "Select a supported currency",
      );
    try {
      const [customer, region, salesChannel] = await Promise.all([
        data.customerId ? customerDal.findById(data.customerId) : null,
        data.regionId ? regionDal.findDetail(data.regionId) : null,
        data.salesChannelId
          ? salesChannelDal.findById(data.salesChannelId)
          : null,
      ]);
      if (data.customerId && !customer)
        return failure(
          "Search draft order variants error",
          new Error("Customer not found"),
          "CUSTOMER_NOT_FOUND",
          "The selected customer no longer exists",
        );
      if (data.regionId && !region)
        return failure(
          "Search draft order variants error",
          new Error("Region not found"),
          "REGION_NOT_FOUND",
          "The selected region no longer exists",
        );
      if (region && region.currencyCode !== data.currencyCode)
        return failure(
          "Search draft order variants error",
          new Error("Region currency mismatch"),
          "REGION_CURRENCY_MISMATCH",
          `Use ${region.currencyCode.toUpperCase()} for the selected region`,
        );
      if (data.salesChannelId && !salesChannel)
        return failure(
          "Search draft order variants error",
          new Error("Sales channel not found"),
          "SALES_CHANNEL_NOT_FOUND",
          "The selected sales channel no longer exists",
        );
      if (salesChannel?.isDisabled)
        return failure(
          "Search draft order variants error",
          new Error("Sales channel is disabled"),
          "SALES_CHANNEL_DISABLED",
          "Choose an active sales channel",
        );

      const result = await productVariantDal.searchPage({
        query: data.query,
        limit: data.limit,
        ...(data.salesChannelId
          ? { publishedSalesChannelId: data.salesChannelId }
          : {}),
      });
      const variants = await Promise.all(
        result.variants.map(async (variant) => {
          const price = await pricingDal.resolveVariantPrice(variant.id, {
            currencyCode: data.currencyCode,
            quantity: data.quantity,
            ...(data.regionId ? { regionId: data.regionId } : {}),
            ...(data.salesChannelId
              ? { salesChannelId: data.salesChannelId }
              : {}),
            ...(customer ? { customerId: customer.id } : {}),
          });
          return { ...variant, unitPrice: price?.amount ?? null };
        }),
      );
      return ok("Draft order variants fetched", { variants });
    } catch (error) {
      return failure(
        "Search draft order variants error",
        error,
        "SEARCH_FAILED",
        "Failed to search product variants",
      );
    }
  });

export const updateOrder = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(updateOrderInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const requested = await orderEditService.request({
        orderId: data.id,
        actorId: context.user.id,
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.noNotification !== undefined
          ? { noNotification: data.noNotification }
          : {}),
      });
      if (!requested.success) {
        const messages = {
          NOT_FOUND: "Order not found",
          NOT_ORDER: "Only active orders can have an edit request",
          EDIT_EXISTS: "An order edit is already waiting for a response",
          EDIT_NOT_FOUND: "Order edit not found",
          EDIT_NOT_REQUESTED: "This order edit is no longer pending",
          CONFLICT: "The order changed. Refresh and try again",
          INVALID_ACTION: "The order edit contains invalid properties",
          ITEM_EDIT_UNSUPPORTED:
            "This order has payment, promotion, fulfillment, or shipping activity that must be reconciled before its items can change",
        } as const;
        return failure(
          "Request order edit error",
          new Error(messages[requested.reason]),
          requested.reason,
          messages[requested.reason],
        );
      }
      return ok("Order edit request sent for customer review", {
        id: requested.edit.id,
        orderId: data.id,
      });
    } catch (error) {
      return failure(
        "Update order error",
        error,
        "UPDATE_FAILED",
        "Failed to update order",
      );
    }
  });

export const convertDraftOrder = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(convertDraftOrderInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;

    try {
      const converted = await convertDraftOrderAndNotifyCustomer(input.data.id);
      if (!converted.success) {
        const messages = {
          NOT_FOUND: "Draft order not found",
          NOT_DRAFT: "This order is no longer a draft",
          INVALID_STATUS: "Only an active draft can be converted",
          CANCELED: "A canceled draft order cannot be converted",
          EMPTY: "Add at least one item before converting this draft",
          PROMOTION_EXHAUSTED:
            "A promotion limit has been reached. Remove the affected promotion or review the draft before converting it.",
          CONFLICT: "The draft changed while it was being converted",
        } as const;
        return failure(
          "Convert draft order error",
          new Error(messages[converted.reason]),
          converted.reason,
          messages[converted.reason],
        );
      }
      return ok("Draft order converted to an order", { id: input.data.id });
    } catch (error) {
      return failure(
        "Convert draft order error",
        error,
        "CONVERT_FAILED",
        "Failed to convert draft order",
      );
    }
  });

export const updateOrderMetadata = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(updateMarketingMetadataInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      await orderDal.updateMetadata(data.id, data.metadata);
      return ok("Order metadata updated successfully", { id: data.id });
    } catch (error) {
      return failure(
        "Update order metadata error",
        error,
        "UPDATE_FAILED",
        "Failed to update order metadata",
      );
    }
  });
