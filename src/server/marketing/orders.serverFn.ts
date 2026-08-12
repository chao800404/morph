import { orderDal } from "@/lib/commerce/marketing.dal";
import { failure, ok, paginationOf } from "@/lib/db/server-result";
import { createOrderInputSchema, getMarketingRecordInputSchema, listOrdersInputSchema, updateMarketingMetadataInputSchema, updateOrderInputSchema } from "@/lib/validations/marketing";
import { createServerFn } from "@tanstack/react-start";
import { commerceAdminMiddleware, commerceReadMiddleware } from "../middleware/auth.middleware";

export const listOrders = createServerFn({ method: "POST" })
  .validator((data: unknown) => listOrdersInputSchema.parse(data ?? {}))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
    try {
      const page = await orderDal.listPage(data);
      return ok("Orders fetched successfully", { orders: page.orders, pagination: paginationOf(page.total, data.page, data.limit) });
    } catch (error) { return failure("List orders error", error, "LIST_FAILED", "Failed to fetch orders"); }
  });

export const getOrder = createServerFn({ method: "POST" })
  .validator((data: unknown) => getMarketingRecordInputSchema.parse(data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
    try {
      const order = await orderDal.findById(data.id);
      return order ? ok("Order fetched successfully", order) : { success: false as const, message: "Order not found", data: null, error: "NOT_FOUND" };
    } catch (error) { return failure("Get order error", error, "GET_FAILED", "Failed to fetch order"); }
  });

export const createOrder = createServerFn({ method: "POST" })
  .validator((data: unknown) => createOrderInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const created = await orderDal.create({ id: crypto.randomUUID(), ...data });
      return ok(`Draft order #${created.displayId} created`, created);
    } catch (error) { return failure("Create order error", error, "CREATE_FAILED", "Failed to create order"); }
  });

export const updateOrder = createServerFn({ method: "POST" })
  .validator((data: unknown) => updateOrderInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      await orderDal.update(data.id, data);
      return ok("Order updated successfully", { id: data.id });
    } catch (error) { return failure("Update order error", error, "UPDATE_FAILED", "Failed to update order"); }
  });

export const updateOrderMetadata = createServerFn({ method: "POST" })
  .validator((data: unknown) => updateMarketingMetadataInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      await orderDal.updateMetadata(data.id, data.metadata);
      return ok("Order metadata updated successfully", { id: data.id });
    } catch (error) { return failure("Update order metadata error", error, "UPDATE_FAILED", "Failed to update order metadata"); }
  });
