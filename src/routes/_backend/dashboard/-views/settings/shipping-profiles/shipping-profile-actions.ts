import type { AssetActionResult } from "@/lib/asset/action-result";
import {
  createShippingProfile,
  deleteShippingProfiles,
  updateShippingProfile,
} from "@/server/shipping/shipping-profiles.serverFn";

const text = (data: FormData, key: string): string | undefined => {
  const value = data.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const ids = (data: FormData): string[] => {
  try {
    const value = JSON.parse(String(data.get("ids") ?? "[]"));
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
};

const toActionResult = (value: {
  success: boolean;
  message: string;
  errors?: Partial<Record<string, string[]>>;
}): AssetActionResult => ({
  success: value.success,
  message: value.message,
  errors: value.errors
    ? Object.fromEntries(
        Object.entries(value.errors).filter(
          (entry): entry is [string, string[]] => Boolean(entry[1]),
        ),
      )
    : undefined,
});

export const createShippingProfileAction = async (
  _state: unknown,
  data: FormData,
): Promise<AssetActionResult> => {
  const type = text(data, "type");
  if (type !== "custom" && type !== "gift_card") {
    return { success: false, message: "Choose a valid profile type" };
  }
  return toActionResult(
    await createShippingProfile({
      data: { name: text(data, "name") ?? "", type },
    }),
  );
};

export const updateShippingProfileAction = async (
  data: FormData,
): Promise<AssetActionResult> => {
  const id = text(data, "id");
  if (!id) return { success: false, message: "Missing shipping profile ID" };
  const type = text(data, "type");
  if (
    type !== undefined &&
    type !== "custom" &&
    type !== "gift_card" &&
    type !== "default"
  ) {
    return { success: false, message: "Choose a valid profile type" };
  }
  return toActionResult(
    await updateShippingProfile({
      data: {
        id,
        name: text(data, "name"),
        ...(type ? { type } : {}),
      },
    }),
  );
};

export const deleteShippingProfilesAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> =>
  toActionResult(await deleteShippingProfiles({ data: { ids: ids(data) } }));
