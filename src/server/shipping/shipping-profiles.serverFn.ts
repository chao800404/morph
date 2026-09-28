import {
  fail,
  failure,
  ok,
  paginationOf,
  parseInput,
} from "@/lib/db/server-result";
import { shippingProfileDal } from "@/lib/shipping/dal/shipping-profile.dal";
import { shippingProfileWriteService } from "@/lib/shipping/service/shipping-profile-write.service";
import {
  createShippingProfileInputSchema,
  deleteShippingProfilesInputSchema,
  listShippingProfilesInputSchema,
  shippingProfileIdInputSchema,
  updateShippingProfileInputSchema,
} from "@/lib/validations/shipping-profile";
import { createServerFn } from "@tanstack/react-start";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

export const listShippingProfiles = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(listShippingProfilesInputSchema, data ?? {}),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const page = await shippingProfileDal.listPage(input.data);
      return ok("Shipping profiles fetched successfully", {
        profiles: page.profiles,
        pagination: paginationOf(page.total, input.data.page, input.data.limit),
      });
    } catch (error) {
      return failure(
        "List shipping profiles error",
        error,
        "LIST_FAILED",
        "Failed to fetch shipping profiles",
      );
    }
  });

export const getShippingProfile = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(shippingProfileIdInputSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const profile = await shippingProfileDal.findById(input.data.id);
      return profile
        ? ok("Shipping profile fetched successfully", profile)
        : fail("Shipping profile not found", { error: "NOT_FOUND" });
    } catch (error) {
      return failure(
        "Get shipping profile error",
        error,
        "GET_FAILED",
        "Failed to fetch shipping profile",
      );
    }
  });

export const createShippingProfile = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(createShippingProfileInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    const result = await shippingProfileWriteService.create(input.data);
    return result.success
      ? ok(result.message, result.data)
      : fail(result.message, { error: result.error, errors: result.errors });
  });

export const updateShippingProfile = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(updateShippingProfileInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    const result = await shippingProfileWriteService.update(input.data);
    return result.success
      ? ok(result.message, result.data)
      : fail(result.message, { error: result.error, errors: result.errors });
  });

export const deleteShippingProfiles = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(deleteShippingProfilesInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    const result = await shippingProfileWriteService.delete(input.data.ids[0]!);
    return result.success
      ? ok(result.message, result.data)
      : fail(result.message, { error: result.error, errors: result.errors });
  });
