import type { AssetActionResult } from "@/lib/asset/action-result";
import {
  createManualReservation,
  deleteManualReservation,
  updateManualReservation,
} from "@/server/inventory/inventory.serverFn";

const text = (data: FormData, name: string): string | null => {
  const value = data.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

export const createReservationAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const quantity = Number(text(data, "quantity"));
  return actionResult(
    await createManualReservation({
      data: {
        inventoryItemId: text(data, "inventoryItemId") ?? "",
        locationId: text(data, "locationId") ?? "",
        quantity,
        allowBackorder: data.get("allowBackorder") === "on",
        description: text(data, "description"),
        externalId: text(data, "externalId"),
      },
    }),
  );
};

export const updateReservationAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const id = text(data, "id");
  if (!id) return { success: false, message: "Missing reservation ID" };
  const quantity = Number(text(data, "quantity"));
  return actionResult(
    await updateManualReservation({
      data: {
        id,
        quantity,
        allowBackorder: data.get("allowBackorder") === "on",
        description: text(data, "description"),
        externalId: text(data, "externalId"),
      },
    }),
  );
};

export const deleteReservationAction = async (
  id: string,
): Promise<AssetActionResult> =>
  actionResult(await deleteManualReservation({ data: { id } }));
