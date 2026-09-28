import { inventoryDal } from "@/lib/inventory/dal/inventory.dal";
import { inventoryWriteService } from "@/lib/inventory/service/inventory-write.service";
import { reservationDal } from "@/lib/inventory/dal/reservation.dal";
import { reservationWriteService } from "@/lib/inventory/service/reservation-write.service";
import { failure, ok, paginationOf, parseInput } from "@/lib/db/server-result";
import {
  createInventoryItemInputSchema,
  inventoryItemIdInputSchema,
  createManualReservationInputSchema,
  listInventoryInputSchema,
  listReservationsInputSchema,
  reservationIdInputSchema,
  removeInventoryLocationLevelsInputSchema,
  setInventoryLocationLevelsInputSchema,
  updateInventoryItemInputSchema,
  updateManualReservationInputSchema,
} from "@/lib/validations/inventory";
import { createServerFn } from "@tanstack/react-start";
import {
  commerceAdminMiddleware,
  commerceReadMiddleware,
} from "../middleware/auth.middleware";

const writeFailure = (reason: string) => {
  const messages: Record<string, string> = {
    NOT_FOUND: "Inventory item not found",
    SKU_CONFLICT: "An inventory item with this SKU already exists",
    INVALID_LOCATION: "One or more stock locations are unavailable",
    RESERVED_QUANTITY:
      "Stocked quantity cannot be lower than the quantity reserved for open carts or orders",
    CONFLICT: "Inventory changed while you were editing. Refresh and try again",
    IN_USE:
      "Inventory linked to variants, reservations, or non-zero stock cannot be deleted",
    NOT_MANUAL:
      "Cart and order reservations are managed by their commerce workflow",
    NO_LOCATION_LEVEL:
      "Create an inventory level for this item and location first",
    INSUFFICIENT_STOCK:
      "There is not enough available stock for this reservation",
  };
  return {
    success: false as const,
    message: messages[reason] ?? "Inventory operation failed",
    data: null,
    error: reason,
  };
};

export const listInventory = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(listInventoryInputSchema, data ?? {}),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      await inventoryDal.reconcileManagedVariants();
      const page = await inventoryDal.listPage(data);
      return ok("Inventory fetched successfully", {
        items: page.items,
        pagination: paginationOf(page.total, data.page, data.limit),
      });
    } catch (error) {
      return failure(
        "List inventory error",
        error,
        "LIST_FAILED",
        "Failed to fetch inventory",
      );
    }
  });

export const getInventoryItem = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(inventoryItemIdInputSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const item = await inventoryDal.findById(input.data.id);
      return item
        ? ok("Inventory item fetched successfully", item)
        : writeFailure("NOT_FOUND");
    } catch (error) {
      return failure(
        "Get inventory item error",
        error,
        "GET_FAILED",
        "Failed to fetch inventory item",
      );
    }
  });

export const createInventoryItem = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(createInventoryItemInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const data = input.data;
      const result = await inventoryWriteService.create({
        title: data.title,
        sku: data.sku ?? null,
        description: data.description ?? null,
        thumbnail: data.thumbnail ?? null,
        unitOfMeasure: data.unitOfMeasure,
        requiresShipping: data.requiresShipping,
        weight: data.weight,
        length: data.length,
        height: data.height,
        width: data.width,
        originCountry: data.originCountry ?? null,
        hsCode: data.hsCode ?? null,
        midCode: data.midCode ?? null,
        material: data.material ?? null,
        metadata: data.metadata ?? {},
        locationLevels: data.locationLevels,
      });
      if (!result.success) return writeFailure(result.reason);
      return ok("Inventory item created successfully", { id: result.id });
    } catch (error) {
      return failure(
        "Create inventory item error",
        error,
        "CREATE_FAILED",
        "Failed to create inventory item",
      );
    }
  });

export const updateInventoryItem = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(updateInventoryItemInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const { id, ...fields } = input.data;
      const result = await inventoryWriteService.update(id, fields);
      return result.success
        ? ok("Inventory item updated", { id })
        : writeFailure(result.reason);
    } catch (error) {
      return failure(
        "Update inventory item error",
        error,
        "UPDATE_FAILED",
        "Failed to update inventory item",
      );
    }
  });

export const setInventoryLocationLevels = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(setInventoryLocationLevelsInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const result = await inventoryWriteService.setLocationLevels(
        input.data.inventoryItemId,
        input.data.locationLevels,
      );
      return result.success
        ? ok("Inventory location levels updated", { id: result.id })
        : writeFailure(result.reason);
    } catch (error) {
      return failure(
        "Update inventory location levels error",
        error,
        "UPDATE_FAILED",
        "Failed to update inventory location levels",
      );
    }
  });

export const removeInventoryLocationLevels = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(removeInventoryLocationLevelsInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const result = await inventoryWriteService.removeLocationLevels(
        input.data.inventoryItemId,
        input.data.locationIds,
      );
      return result.success
        ? ok("Inventory location levels removed", { id: result.id })
        : writeFailure(result.reason);
    } catch (error) {
      return failure(
        "Remove inventory location levels error",
        error,
        "DELETE_FAILED",
        "Failed to remove inventory location levels",
      );
    }
  });

export const deleteInventoryItem = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(inventoryItemIdInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const result = await inventoryWriteService.archive(input.data.id);
      if (result === "archived") {
        return ok("Inventory item deleted", { id: input.data.id });
      }
      return writeFailure(result === "in-use" ? "IN_USE" : "NOT_FOUND");
    } catch (error) {
      return failure(
        "Delete inventory item error",
        error,
        "DELETE_FAILED",
        "Failed to delete inventory item",
      );
    }
  });

export const listReservations = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(listReservationsInputSchema, data ?? {}),
  )
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const result = await reservationDal.listPage({
        ...input.data,
        inventoryItemId: input.data.inventoryItemId ?? undefined,
        locationId: input.data.locationId ?? undefined,
      });
      return ok("Reservations fetched successfully", {
        reservations: result.reservations,
        pagination: paginationOf(
          result.total,
          input.data.page,
          input.data.limit,
        ),
      });
    } catch (error) {
      return failure(
        "List reservations error",
        error,
        "LIST_FAILED",
        "Failed to fetch reservations",
      );
    }
  });

export const getReservation = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(reservationIdInputSchema, data))
  .middleware([commerceReadMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const reservation = await reservationDal.findById(input.data.id);
      return reservation
        ? ok("Reservation fetched successfully", reservation)
        : writeFailure("NOT_FOUND");
    } catch (error) {
      return failure(
        "Get reservation error",
        error,
        "GET_FAILED",
        "Failed to fetch reservation",
      );
    }
  });

export const createManualReservation = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(createManualReservationInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    try {
      const result = await reservationWriteService.create({
        ...input.data,
        createdBy: context.user.id,
      });
      if (!result.success) return writeFailure(result.reason);
      return ok("Reservation created successfully", { id: result.id });
    } catch (error) {
      return failure(
        "Create reservation error",
        error,
        "CREATE_FAILED",
        "Failed to create reservation",
      );
    }
  });

export const updateManualReservation = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(updateManualReservationInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const { id, ...fields } = input.data;
      const result = await reservationWriteService.update({ id, ...fields });
      return result.success
        ? ok("Reservation updated successfully", { id })
        : writeFailure(result.reason);
    } catch (error) {
      return failure(
        "Update reservation error",
        error,
        "UPDATE_FAILED",
        "Failed to update reservation",
      );
    }
  });

export const deleteManualReservation = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(reservationIdInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const result = await reservationWriteService.delete(input.data.id);
      if (result === "deleted") {
        return ok("Reservation deleted successfully", { id: input.data.id });
      }
      const reason = {
        "not-found": "NOT_FOUND",
        "not-manual": "NOT_MANUAL",
        "no-level": "NO_LOCATION_LEVEL",
        conflict: "CONFLICT",
      } as const;
      return writeFailure(reason[result]);
    } catch (error) {
      return failure(
        "Delete reservation error",
        error,
        "DELETE_FAILED",
        "Failed to delete reservation",
      );
    }
  });
