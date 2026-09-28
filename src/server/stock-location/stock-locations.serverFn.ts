import {
  fail,
  failure,
  ok,
  paginationOf,
  parseInput,
} from "@/lib/db/server-result";
import { salesChannelDal } from "@/lib/sales-channel/dal/sales-channel.dal";
import { stockLocationDal } from "@/lib/stock-location/dal/stock-location.dal";
import { locationFulfillmentProviderService } from "@/lib/fulfillment/service/location-fulfillment-provider.service";
import { stockLocationWriteService } from "@/lib/stock-location/service/stock-location-write.service";
import {
  createStockLocationInputSchema,
  deleteStockLocationsInputSchema,
  getStockLocationInputSchema,
  getLocationFulfillmentProvidersInputSchema,
  listStockLocationsInputSchema,
  setLocationSalesChannelsInputSchema,
  setLocationFulfillmentProvidersInputSchema,
  updateStockLocationInputSchema,
} from "@/lib/validations/stock-location";
import { createServerFn } from "@tanstack/react-start";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

export const listStockLocations = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(listStockLocationsInputSchema, data ?? {}),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const page = await stockLocationDal.listPage(data);
      return ok("Stock locations fetched successfully", {
        locations: page.locations,
        pagination: paginationOf(page.total, data.page, data.limit),
      });
    } catch (error) {
      return failure(
        "List stock locations error",
        error,
        "LIST_FAILED",
        "Failed to fetch stock locations",
      );
    }
  });

export const getStockLocation = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(getStockLocationInputSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const location = await stockLocationDal.findById(data.id);
      if (!location) {
        return fail("Stock location not found", { error: "NOT_FOUND" });
      }

      const channelIds = await stockLocationDal.listChannelIds(location.id);
      // Resolved through the DAL because the link has no foreign key and can
      // outlive the channel it points at.
      const salesChannels = await salesChannelDal.findByIds(channelIds);
      const providerResult = await locationFulfillmentProviderService.list(
        location.id,
      );
      if (!providerResult.success) return providerResult;

      return ok("Stock location fetched successfully", {
        ...location,
        salesChannels,
        fulfillmentProviders: providerResult.data.providers.filter(
          (provider) => provider.isAssigned,
        ),
      });
    } catch (error) {
      return failure(
        "Get stock location error",
        error,
        "GET_FAILED",
        "Failed to fetch stock location",
      );
    }
  });

export const getLocationFulfillmentProviders = createServerFn({
  method: "POST",
})
  .validator((data: unknown) =>
    parseInput(getLocationFulfillmentProvidersInputSchema, data),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    return locationFulfillmentProviderService.list(input.data.stockLocationId);
  });

export const setLocationFulfillmentProviders = createServerFn({
  method: "POST",
})
  .validator((data: unknown) =>
    parseInput(setLocationFulfillmentProvidersInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    return locationFulfillmentProviderService.set({
      locationId: input.data.stockLocationId,
      fulfillmentProviderIds: input.data.fulfillmentProviderIds,
    });
  });

export const createStockLocation = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(createStockLocationInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    return stockLocationWriteService.create(input.data);
  });

export const updateStockLocation = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(updateStockLocationInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    return stockLocationWriteService.update(input.data);
  });

export const deleteStockLocations = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(deleteStockLocationsInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    return stockLocationWriteService.deleteMany(input.data.ids);
  });

export const setLocationSalesChannels = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(setLocationSalesChannelsInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const location = await stockLocationDal.findById(data.stockLocationId);
      if (!location) {
        return fail("Stock location not found", { error: "NOT_FOUND" });
      }

      const channels = await salesChannelDal.findByIds(data.salesChannelIds);
      if (channels.length !== data.salesChannelIds.length) {
        return fail("One or more sales channels no longer exist", {
          error: "NOT_FOUND",
        });
      }

      await stockLocationDal.setChannels(
        data.stockLocationId,
        channels.map((channel) => channel.id),
      );

      return ok("Sales channels updated", { count: channels.length });
    } catch (error) {
      return failure(
        "Set location sales channels error",
        error,
        "UPDATE_FAILED",
        "Failed to update sales channels",
      );
    }
  });
