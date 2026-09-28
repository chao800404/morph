import { salesChannelDal } from "@/lib/sales-channel/dal/sales-channel.dal";
import { currencyDal } from "@/lib/currency/dal/currency.dal";
import {
  fail,
  failure,
  ok,
  paginationOf,
  parseInput,
} from "@/lib/db/server-result";
import { salesChannelWriteService } from "@/lib/sales-channel/service/sales-channel-write.service";
import {
  createSalesChannelInputSchema,
  deleteSalesChannelsInputSchema,
  getSalesChannelInputSchema,
  listSalesChannelsInputSchema,
  setProductSalesChannelsInputSchema,
  updateSalesChannelInputSchema,
  updateSalesChannelProductsInputSchema,
} from "@/lib/validations/sales-channel";
import { createServerFn } from "@tanstack/react-start";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

export const listSalesChannels = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(listSalesChannelsInputSchema, data ?? {}),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const [page, defaultSalesChannelId] = await Promise.all([
        salesChannelDal.listPage(data),
        currencyDal.getDefaultSalesChannelId(),
      ]);
      return ok("Sales channels fetched successfully", {
        salesChannels: page.channels.map((channel) => ({
          ...channel,
          isDefault: channel.id === defaultSalesChannelId,
        })),
        pagination: paginationOf(page.total, data.page, data.limit),
      });
    } catch (error) {
      return failure(
        "List sales channels error",
        error,
        "LIST_FAILED",
        "Failed to fetch sales channels",
      );
    }
  });

export const getSalesChannel = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(getSalesChannelInputSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const channel = await salesChannelDal.findById(data.id);
      if (!channel) {
        return fail("Sales channel not found", { error: "NOT_FOUND" });
      }

      const [counts, defaultSalesChannelId] = await Promise.all([
        salesChannelDal.countProducts([channel.id]),
        currencyDal.getDefaultSalesChannelId(),
      ]);
      return ok("Sales channel fetched successfully", {
        ...channel,
        isDefault: channel.id === defaultSalesChannelId,
        productCount: counts.get(channel.id) ?? 0,
      });
    } catch (error) {
      return failure(
        "Get sales channel error",
        error,
        "GET_FAILED",
        "Failed to fetch sales channel",
      );
    }
  });

export const createSalesChannel = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(createSalesChannelInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    return salesChannelWriteService.create(data);
  });

export const updateSalesChannel = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(updateSalesChannelInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    return salesChannelWriteService.update(data);
  });

export const deleteSalesChannels = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(deleteSalesChannelsInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    return salesChannelWriteService.deleteMany(data);
  });

export const getProductSalesChannels = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(
      setProductSalesChannelsInputSchema.pick({ productId: true }),
      data,
    ),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const ids = await salesChannelDal.listChannelIdsForProduct(
        data.productId,
      );
      // The link table has no foreign key, so a link can outlive its channel.
      // Resolving through the DAL drops those rather than returning dead ids.
      const channels = await salesChannelDal.findByIds(ids);
      return ok("Product sales channels fetched successfully", { channels });
    } catch (error) {
      return failure(
        "Get product sales channels error",
        error,
        "GET_FAILED",
        "Failed to fetch product sales channels",
      );
    }
  });

export const setProductSalesChannels = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(setProductSalesChannelsInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    return salesChannelWriteService.setProductChannels(data);
  });

export const addProductsToSalesChannel = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(updateSalesChannelProductsInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    return salesChannelWriteService.addProducts(data);
  });

export const removeProductsFromSalesChannel = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(updateSalesChannelProductsInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    return salesChannelWriteService.removeProducts(data);
  });
