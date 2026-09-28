import { orderReturnDal } from "@/lib/order/dal/order-return.dal";
import { failure, ok, paginationOf, parseInput } from "@/lib/db/server-result";
import {
  createOrderReturnInputSchema,
  getMarketingRecordInputSchema,
  orderReturnListInputSchema,
  orderReturnOperationInputSchema,
  receiveOrderReturnInputSchema,
} from "@/lib/validations/marketing";
import { createServerFn } from "@tanstack/react-start";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

const failureFor = (reason: string) => {
  const messages: Record<string, string> = {
    NOT_FOUND: "Order or return not found",
    ORDER_CANCELED: "Canceled and draft orders cannot have returns",
    INVALID_QUANTITY: "Return quantities exceed the eligible quantity",
    INVALID_REASON: "Select an active return reason",
    INVALID_LOCATION: "Select the same active stock location used for this return",
    RETURN_CLOSED: "This return can no longer be changed",
    CONFLICT: "The order changed during this operation. Refresh and try again",
  };
  return {
    success: false as const,
    message: messages[reason] ?? "Return operation failed",
    data: null,
    error: reason,
  };
};

export const listOrderReturns = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(orderReturnListInputSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const result = await orderReturnDal.listPage(input.data);
      return ok("Order returns fetched", {
        returns: result.returns,
        pagination: paginationOf(
          result.total,
          input.data.page,
          input.data.limit,
        ),
      });
    } catch (error) {
      return failure(
        "List order returns error",
        error,
        "LIST_FAILED",
        "Failed to fetch order returns",
      );
    }
  });

export const getOrderReturn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(orderReturnOperationInputSchema, data),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const result = await orderReturnDal.findById(input.data.returnId);
      return result
        ? ok("Order return fetched", result)
        : failureFor("NOT_FOUND");
    } catch (error) {
      return failure(
        "Get order return error",
        error,
        "GET_FAILED",
        "Failed to fetch order return",
      );
    }
  });

export const getOrderReturnableItems = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(getMarketingRecordInputSchema, data),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const result = await orderReturnDal.listReturnableItems(input.data.id);
      return result
        ? ok("Returnable order items fetched", result)
        : failureFor("NOT_FOUND");
    } catch (error) {
      return failure(
        "Get returnable order items error",
        error,
        "GET_FAILED",
        "Failed to fetch returnable order items",
      );
    }
  });

export const createOrderReturn = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(createOrderReturnInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    try {
      const result = await orderReturnDal.create({
        ...input.data,
        createdBy: context.user.id,
      });
      return result.success
        ? ok(`Return #${result.displayId} requested`, result)
        : failureFor(result.reason);
    } catch (error) {
      return failure(
        "Create order return error",
        error,
        "CREATE_FAILED",
        "Failed to request order return",
      );
    }
  });

export const receiveOrderReturn = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(receiveOrderReturnInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const result = await orderReturnDal.receive(input.data);
      return result.success
        ? ok("Return receipt recorded", result)
        : failureFor(result.reason);
    } catch (error) {
      return failure(
        "Receive order return error",
        error,
        "RECEIVE_FAILED",
        "Failed to record returned items",
      );
    }
  });

export const cancelOrderReturn = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(orderReturnOperationInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    try {
      const result = await orderReturnDal.cancel({
        ...input.data,
        canceledBy: context.user.id,
      });
      return result.success
        ? ok("Return canceled", result)
        : failureFor(result.reason);
    } catch (error) {
      return failure(
        "Cancel order return error",
        error,
        "CANCEL_FAILED",
        "Failed to cancel return",
      );
    }
  });
