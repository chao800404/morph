import type { Metadata } from "@/db/json";
import { reservationDal } from "../dal/reservation.dal";
import { inventoryDal } from "../dal/inventory.dal";
import { stockLocationDal } from "@/lib/stock-location/dal/stock-location.dal";

export type CreateManualReservationInput = {
  inventoryItemId: string;
  locationId: string;
  quantity: number;
  allowBackorder?: boolean;
  description?: string | null;
  externalId?: string | null;
  metadata?: Metadata;
  createdBy: string;
};

export type UpdateManualReservationInput = {
  id: string;
  quantity?: number;
  allowBackorder?: boolean;
  description?: string | null;
  externalId?: string | null;
  metadata?: Metadata;
};

export type ReservationWriteFailure =
  | "NOT_FOUND"
  | "NOT_MANUAL"
  | "INVALID_LOCATION"
  | "NO_LOCATION_LEVEL"
  | "INSUFFICIENT_STOCK"
  | "CONFLICT";

export type ReservationWriteResult =
  | { success: true; id: string }
  | { success: false; reason: ReservationWriteFailure };

export const reservationWriteService = {
  async create(
    input: CreateManualReservationInput,
  ): Promise<ReservationWriteResult> {
    const item = await inventoryDal.findById(input.inventoryItemId);
    if (!item) return { success: false, reason: "NOT_FOUND" };
    if (!(await stockLocationDal.findById(input.locationId))) {
      return { success: false, reason: "INVALID_LOCATION" };
    }
    const level = item.locationLevels.find(
      (candidate) => candidate.locationId === input.locationId,
    );
    if (!level) return { success: false, reason: "NO_LOCATION_LEVEL" };
    const allowBackorder = input.allowBackorder ?? false;
    if (!allowBackorder && level.availableQuantity < input.quantity) {
      return { success: false, reason: "INSUFFICIENT_STOCK" };
    }
    const id = crypto.randomUUID();
    const result = await reservationDal.createManual({
      id,
      inventoryItemId: input.inventoryItemId,
      locationId: input.locationId,
      quantity: input.quantity,
      allowBackorder,
      description: input.description ?? null,
      externalId: input.externalId ?? null,
      metadata: input.metadata ?? {},
      createdBy: input.createdBy,
    });
    const failureByResult = {
      "no-level": "NO_LOCATION_LEVEL",
      "insufficient-stock": "INSUFFICIENT_STOCK",
      conflict: "CONFLICT",
    } as const;
    return result === "created"
      ? { success: true, id }
      : { success: false, reason: failureByResult[result] };
  },

  async update(
    input: UpdateManualReservationInput,
  ): Promise<ReservationWriteResult> {
    const current = await reservationDal.findById(input.id);
    if (!current) return { success: false, reason: "NOT_FOUND" };
    if (!current.isManual) return { success: false, reason: "NOT_MANUAL" };
    const quantity = input.quantity ?? current.quantity;
    const allowBackorder = input.allowBackorder ?? current.allowBackorder;
    const item = await inventoryDal.findById(current.inventoryItemId);
    if (!item) return { success: false, reason: "NOT_FOUND" };
    const level = item.locationLevels.find(
      (candidate) => candidate.locationId === current.locationId,
    );
    if (!level) return { success: false, reason: "NO_LOCATION_LEVEL" };
    const increase = quantity - current.quantity;
    if (increase > 0 && !allowBackorder && level.availableQuantity < increase) {
      return { success: false, reason: "INSUFFICIENT_STOCK" };
    }
    const result = await reservationDal.updateManual({
      id: input.id,
      quantity,
      allowBackorder,
      description:
        input.description === undefined
          ? current.description
          : input.description,
      externalId:
        input.externalId === undefined ? current.externalId : input.externalId,
      metadata: input.metadata ?? current.metadata,
    });
    const failureByResult = {
      "not-found": "NOT_FOUND",
      "not-manual": "NOT_MANUAL",
      "no-level": "NO_LOCATION_LEVEL",
      "insufficient-stock": "INSUFFICIENT_STOCK",
      conflict: "CONFLICT",
    } as const;
    return result === "updated"
      ? { success: true, id: input.id }
      : { success: false, reason: failureByResult[result] };
  },

  async delete(
    id: string,
  ): Promise<"deleted" | "not-found" | "not-manual" | "no-level" | "conflict"> {
    return reservationDal.deleteManual(id);
  },
};
