import type { Metadata } from "@/db/json";
import { inventoryDal } from "@/lib/inventory/dal/inventory.dal";
import { stockLocationDal } from "@/lib/stock-location/dal/stock-location.dal";

export type InventoryItemFields = {
  title?: string;
  sku?: string | null;
  description?: string | null;
  thumbnail?: string | null;
  unitOfMeasure?: string | null;
  requiresShipping?: boolean;
  weight?: number | null;
  length?: number | null;
  height?: number | null;
  width?: number | null;
  originCountry?: string | null;
  hsCode?: string | null;
  midCode?: string | null;
  material?: string | null;
  metadata?: Metadata;
};

export type InventoryLocationLevelInput = {
  locationId: string;
  stockedQuantity: number;
  incomingQuantity?: number;
};

export type CreateInventoryItemInput = {
  title: string;
  sku: string | null;
  description: string | null;
  thumbnail: string | null;
  unitOfMeasure: string | null;
  requiresShipping: boolean;
  weight: number | null;
  length: number | null;
  height: number | null;
  width: number | null;
  originCountry: string | null;
  hsCode: string | null;
  midCode: string | null;
  material: string | null;
  metadata: Metadata;
  locationLevels: InventoryLocationLevelInput[];
};

export type InventoryCreateResult =
  | { success: true; id: string }
  | { success: false; reason: "SKU_CONFLICT" | "INVALID_LOCATION" };

export type InventoryUpdateResult =
  | { success: true; id: string }
  | { success: false; reason: "NOT_FOUND" | "SKU_CONFLICT" };

export type InventoryLevelsWriteResult =
  | { success: true; id: string }
  | {
      success: false;
      reason:
        | "NOT_FOUND"
        | "INVALID_LOCATION"
        | "RESERVED_QUANTITY"
        | "CONFLICT"
        | "IN_USE";
    };

export type InventoryLocationLevelsBatchInput = {
  inventoryItemId?: string;
  creates: Array<{
    inventoryItemId?: string;
    locationId: string;
    stockedQuantity: number;
    incomingQuantity: number;
  }>;
  updates: Array<{
    id: string;
    inventoryItemId?: string;
    locationId?: string;
    stockedQuantity?: number;
    incomingQuantity?: number;
  }>;
  deleteIds: string[];
  force: boolean;
};

export type InventoryLocationLevelsBatchResult =
  | { success: true }
  | {
      success: false;
      reason:
        | "NOT_FOUND"
        | "INVALID_LOCATION"
        | "RESERVED_QUANTITY"
        | "CONFLICT"
        | "IN_USE";
    };

const skuConflict = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  return (
    message.includes("inventory_items_active_sku_unique") ||
    message.includes("UNIQUE constraint failed: inventory_items.sku")
  );
};

export const inventoryWriteService = {
  async create(
    input: CreateInventoryItemInput,
  ): Promise<InventoryCreateResult> {
    if (input.sku && (await inventoryDal.findBySku(input.sku))) {
      return { success: false, reason: "SKU_CONFLICT" };
    }
    if (input.locationLevels.length) {
      const locations = await stockLocationDal.findByIds(
        input.locationLevels.map((level) => level.locationId),
      );
      if (locations.length !== input.locationLevels.length) {
        return { success: false, reason: "INVALID_LOCATION" };
      }
    }
    const id = crypto.randomUUID();
    const result = await inventoryDal.createItem({
      ...input,
      id,
      locationLevels: input.locationLevels.map((level) => ({
        ...level,
        incomingQuantity: level.incomingQuantity ?? 0,
      })),
    });
    if (result === "invalid-location") {
      return { success: false, reason: "INVALID_LOCATION" };
    }
    if (result === "sku-conflict") {
      return { success: false, reason: "SKU_CONFLICT" };
    }
    return { success: true, id };
  },

  async update(
    id: string,
    input: InventoryItemFields,
  ): Promise<InventoryUpdateResult> {
    const current = await inventoryDal.findById(id);
    if (!current) return { success: false, reason: "NOT_FOUND" };
    if (input.sku && input.sku !== current.sku) {
      const conflict = await inventoryDal.findBySku(input.sku);
      if (conflict && conflict.id !== id) {
        return { success: false, reason: "SKU_CONFLICT" };
      }
    }
    try {
      const result = await inventoryDal.updateItem(id, input);
      if (result === "updated") return { success: true, id };
      return {
        success: false,
        reason: result === "sku-conflict" ? "SKU_CONFLICT" : "NOT_FOUND",
      };
    } catch (error) {
      if (skuConflict(error)) {
        return { success: false, reason: "SKU_CONFLICT" };
      }
      throw error;
    }
  },

  async setLocationLevels(
    inventoryItemId: string,
    levels: InventoryLocationLevelInput[],
  ): Promise<InventoryLevelsWriteResult> {
    const item = await inventoryDal.findById(inventoryItemId);
    if (!item) return { success: false, reason: "NOT_FOUND" };
    const locationIds = levels.map((level) => level.locationId);
    if (new Set(locationIds).size !== locationIds.length) {
      return { success: false, reason: "INVALID_LOCATION" };
    }
    if (locationIds.length) {
      const locations = await stockLocationDal.findByIds(locationIds);
      if (locations.length !== locationIds.length) {
        return { success: false, reason: "INVALID_LOCATION" };
      }
    }
    const result = await inventoryDal.setLocationLevels(
      inventoryItemId,
      levels,
    );
    if (result === "updated") return { success: true, id: inventoryItemId };
    const reasonByResult = {
      "not-found": "NOT_FOUND",
      "invalid-location": "INVALID_LOCATION",
      "reserved-quantity": "RESERVED_QUANTITY",
      conflict: "CONFLICT",
    } as const;
    return { success: false, reason: reasonByResult[result] };
  },

  async createLocationLevel(input: {
    inventoryItemId: string;
    locationId: string;
    stockedQuantity: number;
    incomingQuantity: number;
  }): Promise<InventoryLevelsWriteResult> {
    const item = await inventoryDal.findById(input.inventoryItemId);
    if (!item) return { success: false, reason: "NOT_FOUND" };
    const locations = await stockLocationDal.findByIds([input.locationId]);
    if (locations.length !== 1) {
      return { success: false, reason: "INVALID_LOCATION" };
    }
    const result = await inventoryDal.createLocationLevel(input);
    if (result === "created") {
      return { success: true, id: input.inventoryItemId };
    }
    const reasonByResult = {
      "not-found": "NOT_FOUND",
      "invalid-location": "INVALID_LOCATION",
      conflict: "CONFLICT",
    } as const;
    return { success: false, reason: reasonByResult[result] };
  },

  async updateLocationLevel(
    inventoryItemId: string,
    locationId: string,
    input: { stockedQuantity?: number; incomingQuantity?: number },
  ): Promise<InventoryLevelsWriteResult> {
    const item = await inventoryDal.findById(inventoryItemId);
    if (!item) return { success: false, reason: "NOT_FOUND" };
    const locations = await stockLocationDal.findByIds([locationId]);
    if (locations.length !== 1) {
      return { success: false, reason: "INVALID_LOCATION" };
    }
    const result = await inventoryDal.updateLocationLevel(
      inventoryItemId,
      locationId,
      input,
    );
    if (result === "updated") {
      return { success: true, id: inventoryItemId };
    }
    const reasonByResult = {
      "not-found": "NOT_FOUND",
      "invalid-location": "INVALID_LOCATION",
      "reserved-quantity": "RESERVED_QUANTITY",
      conflict: "CONFLICT",
    } as const;
    return { success: false, reason: reasonByResult[result] };
  },

  async batchLocationLevels(
    input: InventoryLocationLevelsBatchInput,
  ): Promise<InventoryLocationLevelsBatchResult> {
    const creates = input.creates.map((level) => ({
      ...level,
      inventoryItemId: level.inventoryItemId ?? input.inventoryItemId,
    }));
    if (creates.some((level) => !level.inventoryItemId)) {
      return { success: false, reason: "NOT_FOUND" };
    }
    const result = await inventoryDal.batchLocationLevels({
      ...(input.inventoryItemId
        ? { inventoryItemId: input.inventoryItemId }
        : {}),
      creates: creates.map((level) => ({
        ...level,
        inventoryItemId: level.inventoryItemId!,
      })),
      updates: input.updates.map((level) => ({
        ...level,
        ...((level.inventoryItemId ?? input.inventoryItemId)
          ? { inventoryItemId: level.inventoryItemId ?? input.inventoryItemId }
          : {}),
      })),
      deleteIds: input.deleteIds,
      force: input.force,
    });
    if (result === "updated") return { success: true };
    const reasonByResult = {
      "not-found": "NOT_FOUND",
      "invalid-location": "INVALID_LOCATION",
      "reserved-quantity": "RESERVED_QUANTITY",
      "in-use": "IN_USE",
      conflict: "CONFLICT",
    } as const;
    return { success: false, reason: reasonByResult[result] };
  },

  async removeLocationLevels(
    inventoryItemId: string,
    locationIds: string[],
  ): Promise<InventoryLevelsWriteResult> {
    const result = await inventoryDal.removeLocationLevels(
      inventoryItemId,
      locationIds,
    );
    if (result === "deleted") return { success: true, id: inventoryItemId };
    const reasonByResult = {
      "not-found": "NOT_FOUND",
      "in-use": "IN_USE",
      conflict: "CONFLICT",
    } as const;
    return { success: false, reason: reasonByResult[result] };
  },

  archive(id: string) {
    return inventoryDal.archiveItem(id);
  },
};
