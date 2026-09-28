import {
  fail,
  failure,
  ok,
  paginationOf,
  parseInput,
} from "@/lib/db/server-result";
import { shippingOptionTypeDal } from "@/lib/shipping/dal/shipping-option-type.dal";
import { shippingOptionTypeWriteService } from "@/lib/shipping/service/shipping-option-type-write.service";
import {
  createShippingOptionTypeInputSchema,
  deleteShippingOptionTypeInputSchema,
  listShippingOptionTypesInputSchema,
  shippingOptionTypeIdInputSchema,
  updateShippingOptionTypeInputSchema,
} from "@/lib/validations/shipping-option-type";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

export const listShippingOptionTypeChoices = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(z.object({}).strict(), data ?? {}))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      return ok("Shipping option types fetched successfully", {
        types: await shippingOptionTypeDal.listActiveChoices(),
      });
    } catch (error) {
      return failure(
        "List shipping option type choices error",
        error,
        "LIST_FAILED",
        "Failed to fetch shipping option types",
      );
    }
  });

export const listShippingOptionTypes = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(listShippingOptionTypesInputSchema, data ?? {}),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const page = await shippingOptionTypeDal.listPage(input.data);
      return ok("Shipping option types fetched successfully", {
        types: page.types,
        pagination: paginationOf(page.total, input.data.page, input.data.limit),
      });
    } catch (error) {
      return failure(
        "List shipping option types error",
        error,
        "LIST_FAILED",
        "Failed to fetch shipping option types",
      );
    }
  });

export const getShippingOptionType = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(shippingOptionTypeIdInputSchema, data),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const type = await shippingOptionTypeDal.findById(input.data.id);
      return type
        ? ok("Shipping option type fetched successfully", type)
        : fail("Shipping option type not found", { error: "NOT_FOUND" });
    } catch (error) {
      return failure(
        "Get shipping option type error",
        error,
        "GET_FAILED",
        "Failed to fetch shipping option type",
      );
    }
  });

export const createShippingOptionType = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(createShippingOptionTypeInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    const result = await shippingOptionTypeWriteService.create(input.data);
    return result.success
      ? ok(result.message, result.data)
      : fail(result.message, { error: result.error, errors: result.errors });
  });

export const updateShippingOptionType = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(updateShippingOptionTypeInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    const result = await shippingOptionTypeWriteService.update(input.data);
    return result.success
      ? ok(result.message, result.data)
      : fail(result.message, { error: result.error, errors: result.errors });
  });

export const deleteShippingOptionType = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(deleteShippingOptionTypeInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    const result = await shippingOptionTypeWriteService.delete(input.data);
    return result.success
      ? ok(result.message, result.data)
      : fail(result.message, { error: result.error, errors: result.errors });
  });
