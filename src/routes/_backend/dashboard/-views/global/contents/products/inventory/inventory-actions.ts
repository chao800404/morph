import type { AssetActionResult } from "@/lib/asset/action-result";
import {
  createInventoryItem,
  deleteInventoryItem,
  removeInventoryLocationLevels,
  setInventoryLocationLevels,
  updateInventoryItem,
} from "@/server/inventory/inventory.serverFn";

const text = (data: FormData, name: string): string | null => {
  const value = data.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const numberOrNull = (data: FormData, name: string): number | null => {
  const value = text(data, name);
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const actionResult = (result: {
  success: boolean;
  message: string;
  errors?: Record<string, string[]>;
}): AssetActionResult => ({
  success: result.success,
  message: result.message,
  ...(result.errors ? { errors: result.errors } : {}),
});

const itemFields = (data: FormData) => ({
  title: text(data, "title") ?? "",
  sku: text(data, "sku"),
  description: text(data, "description"),
  thumbnail: text(data, "thumbnail"),
  unitOfMeasure: text(data, "unitOfMeasure"),
  requiresShipping: data.get("requiresShipping") === "on",
  weight: numberOrNull(data, "weight"),
  length: numberOrNull(data, "length"),
  height: numberOrNull(data, "height"),
  width: numberOrNull(data, "width"),
  originCountry: text(data, "originCountry"),
  hsCode: text(data, "hsCode"),
  midCode: text(data, "midCode"),
  material: text(data, "material"),
});

export const createInventoryItemAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> =>
  actionResult(
    await createInventoryItem({
      data: { ...itemFields(data), metadata: {}, locationLevels: [] },
    }),
  );

export const updateInventoryItemAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const id = text(data, "id");
  if (!id) return { success: false, message: "Missing inventory item ID" };
  return actionResult(
    await updateInventoryItem({ data: { id, ...itemFields(data) } }),
  );
};

export const saveInventoryLocationLevelAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const inventoryItemId = text(data, "inventoryItemId");
  const locationId = text(data, "locationId");
  if (!inventoryItemId || !locationId || locationId === "__select_location__") {
    return { success: false, message: "Choose a stock location" };
  }
  const stockedQuantity = numberOrNull(data, "stockedQuantity");
  const incomingQuantity = numberOrNull(data, "incomingQuantity");
  if (stockedQuantity === null || incomingQuantity === null) {
    return { success: false, message: "Enter valid inventory quantities" };
  }
  return actionResult(
    await setInventoryLocationLevels({
      data: {
        inventoryItemId,
        locationLevels: [{ locationId, stockedQuantity, incomingQuantity }],
      },
    }),
  );
};

export const removeInventoryLocationLevelAction = async (input: {
  inventoryItemId: string;
  locationId: string;
}): Promise<AssetActionResult> =>
  actionResult(
    await removeInventoryLocationLevels({
      data: {
        inventoryItemId: input.inventoryItemId,
        locationIds: [input.locationId],
      },
    }),
  );

export const deleteInventoryItemAction = async (
  id: string,
): Promise<AssetActionResult> =>
  actionResult(await deleteInventoryItem({ data: { id } }));
