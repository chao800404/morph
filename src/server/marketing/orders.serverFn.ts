import { orderDal } from "@/lib/order/dal/order.dal";
import { failure, ok, paginationOf } from "@/lib/db/server-result";
import {
  createOrderInputSchema,
  getMarketingRecordInputSchema,
  listOrdersInputSchema,
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
  .validator((data: unknown) => listOrdersInputSchema.parse(data ?? {}))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
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
  .validator((data: unknown) => getMarketingRecordInputSchema.parse(data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
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

const orderDetailListSchema = z.object({
  orderId: z.uuid("Invalid order ID"),
  page: z.number().int().min(1),
  limit: z.number().int().min(1).max(100),
});

export const listOrderItems = createServerFn({ method: "POST" })
  .validator((data: unknown) => orderDetailListSchema.parse(data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
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
  .validator((data: unknown) => orderDetailListSchema.parse(data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
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
  .validator((data: unknown) => getMarketingRecordInputSchema.parse(data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
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
  .validator((data: unknown) => createOrderInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const created = await orderDal.create({
        id: crypto.randomUUID(),
        ...data,
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
  });

export const updateOrder = createServerFn({ method: "POST" })
  .validator((data: unknown) => updateOrderInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      await orderDal.update(data.id, data);
      return ok("Order updated successfully", { id: data.id });
    } catch (error) {
      return failure(
        "Update order error",
        error,
        "UPDATE_FAILED",
        "Failed to update order",
      );
    }
  });

export const updateOrderMetadata = createServerFn({ method: "POST" })
  .validator((data: unknown) => updateMarketingMetadataInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
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
