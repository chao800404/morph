import { fail, failure, ok, parseInput } from "@/lib/db/server-result";
import { storefrontDal } from "@/lib/storefront/dal/storefront.dal";
import { salesChannelDal } from "@/lib/sales-channel/dal/sales-channel.dal";
import type { StorefrontDetailDTO } from "@/lib/storefront/dto/storefront.dto";
import {
  getStorefrontInputSchema,
  updateStorefrontAccessInputSchema,
  updateStorefrontInputSchema,
} from "@/lib/validations/storefront";
import { createServerFn } from "@tanstack/react-start";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

export const getStorefront = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(getStorefrontInputSchema, data ?? {}))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const storefront = await storefrontDal.findActive(data.id);
      if (!storefront)
        return fail("Storefront not found", { error: "NOT_FOUND" });
      const salesChannel = await salesChannelDal.findById(
        storefront.salesChannelId,
      );
      const detail: StorefrontDetailDTO = {
        ...storefront,
        connectedSalesChannel: salesChannel
          ? {
              id: salesChannel.id,
              name: salesChannel.name,
              type: salesChannel.type,
            }
          : null,
      };
      return ok("Storefront fetched", detail);
    } catch (error) {
      return failure(
        "Get storefront error",
        error,
        "GET_FAILED",
        "Failed to fetch storefront",
      );
    }
  });

export const updateStorefront = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(updateStorefrontInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const existing = await storefrontDal.findActive(data.id);
      if (!existing)
        return fail("Storefront not found", { error: "NOT_FOUND" });
      const otherPreferences = { ...existing.preferences };
      delete otherPreferences.seoTitle;
      delete otherPreferences.seoDescription;
      const updated = await storefrontDal.updateWebsiteInformation({
        id: existing.id,
        name: data.name,
        preferences: {
          ...otherPreferences,
          ...(data.seoTitle ? { seoTitle: data.seoTitle } : {}),
          ...(data.seoDescription
            ? { seoDescription: data.seoDescription }
            : {}),
        },
      });
      return updated
        ? ok("Website information updated", { id: existing.id })
        : fail("Storefront not found", { error: "NOT_FOUND" });
    } catch (error) {
      return failure(
        "Update storefront error",
        error,
        "UPDATE_FAILED",
        "Failed to update website information",
      );
    }
  });

export const updateStorefrontAccess = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(updateStorefrontAccessInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const existing = await storefrontDal.findActive(data.id);
      if (!existing)
        return fail("Storefront not found", { error: "NOT_FOUND" });
      if (data.accessMode === "public" && !existing.domain)
        return fail("Connect a primary domain before making the storefront public", {
          error: "INVALID_STATE",
        });
      const updated = await storefrontDal.updateAccess({
        id: existing.id,
        preferences: {
          ...existing.preferences,
          accessMode: data.accessMode,
        },
      });
      return updated
        ? ok("Storefront access updated", { id: existing.id })
        : fail("Storefront not found", { error: "NOT_FOUND" });
    } catch (error) {
      return failure(
        "Update storefront access error",
        error,
        "UPDATE_FAILED",
        "Failed to update storefront access",
      );
    }
  });
