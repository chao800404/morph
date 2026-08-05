import { fail, failure, ok, paginationOf } from "@/lib/db/server-result";
import { salesChannelDal } from "@/lib/sales-channel/dal/sales-channel.dal";
import { stockLocationDal } from "@/lib/stock-location/dal/stock-location.dal";
import {
  createStockLocationInputSchema,
  deleteStockLocationsInputSchema,
  getStockLocationInputSchema,
  listStockLocationsInputSchema,
  setLocationSalesChannelsInputSchema,
  updateStockLocationInputSchema,
} from "@/lib/validations/stock-location";
import { createServerFn } from "@tanstack/react-start";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

export const listStockLocations = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    listStockLocationsInputSchema.parse(data ?? {}),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
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
  .validator((data: unknown) => getStockLocationInputSchema.parse(data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data }) => {
    try {
      const location = await stockLocationDal.findById(data.id);
      if (!location) {
        return fail("Stock location not found", { error: "NOT_FOUND" });
      }

      const channelIds = await stockLocationDal.listChannelIds(location.id);
      // Resolved through the DAL because the link has no foreign key and can
      // outlive the channel it points at.
      const salesChannels = await salesChannelDal.findByIds(channelIds);

      return ok("Stock location fetched successfully", {
        ...location,
        salesChannels,
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

export const createStockLocation = createServerFn({ method: "POST" })
  .validator((data: unknown) => createStockLocationInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      if (await stockLocationDal.findByName(data.name)) {
        return fail(`A stock location named "${data.name}" already exists`, {
          errors: { name: ["This name is already in use"] },
        });
      }

      const id = crypto.randomUUID();
      await stockLocationDal.create({
        id,
        name: data.name,
        address: data.address ?? null,
      });

      return ok(`Stock location "${data.name}" created`, { id });
    } catch (error) {
      return failure(
        "Create stock location error",
        error,
        "CREATE_FAILED",
        "Failed to create stock location",
      );
    }
  });

export const updateStockLocation = createServerFn({ method: "POST" })
  .validator((data: unknown) => updateStockLocationInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const existing = await stockLocationDal.findById(data.id);
      if (!existing) {
        return fail("Stock location not found", { error: "NOT_FOUND" });
      }

      if (data.name && data.name !== existing.name) {
        const clash = await stockLocationDal.findByName(data.name);
        if (clash && clash.id !== data.id) {
          return fail(`A stock location named "${data.name}" already exists`, {
            errors: { name: ["This name is already in use"] },
          });
        }
      }

      await stockLocationDal.update(data.id, {
        name: data.name,
        address: data.address,
        metadata: data.metadata,
      });

      return ok("Stock location updated successfully", { id: data.id });
    } catch (error) {
      return failure(
        "Update stock location error",
        error,
        "UPDATE_FAILED",
        "Failed to update stock location",
      );
    }
  });

export const deleteStockLocations = createServerFn({ method: "POST" })
  .validator((data: unknown) => deleteStockLocationsInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const existing = await stockLocationDal.findByIds(data.ids);
      if (existing.length === 0) {
        return fail("No matching stock locations were found", {
          error: "NOT_FOUND",
        });
      }

      // Inventory levels are not touched. They reference the location by plain
      // id across the module boundary, and quietly deleting recorded stock
      // because a location was archived would lose a real count. Reconciling
      // them belongs to the inventory module, once it exists.
      await stockLocationDal.softDelete(
        existing.map((location) => location.id),
      );

      return ok(
        `${existing.length} stock location${existing.length === 1 ? "" : "s"} deleted`,
        { deleted: existing.length },
      );
    } catch (error) {
      return failure(
        "Delete stock locations error",
        error,
        "DELETE_FAILED",
        "Failed to delete stock locations",
      );
    }
  });

export const setLocationSalesChannels = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    setLocationSalesChannelsInputSchema.parse(data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
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
