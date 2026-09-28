import type { AssetActionResult } from "@/lib/asset/action-result";
import {
  createShippingOptionType,
  deleteShippingOptionType,
  updateShippingOptionType,
} from "@/server/shipping/shipping-option-types.serverFn";

const text = (data: FormData, key: string): string | undefined => {
  const value = data.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const optionalText = (data: FormData, key: string): string | null | undefined => {
  const value = data.get(key);
  if (typeof value !== "string") return undefined;
  return value.trim() || null;
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

export const createShippingOptionTypeAction = async (
  _state: unknown,
  data: FormData,
): Promise<AssetActionResult> =>
  toActionResult(
    await createShippingOptionType({
      data: {
        label: text(data, "label") ?? "",
        code: text(data, "code") ?? "",
        description: optionalText(data, "description"),
      },
    }),
  );

export const updateShippingOptionTypeAction = async (
  data: FormData,
): Promise<AssetActionResult> => {
  const id = text(data, "id");
  const expectedUpdatedAt = text(data, "expectedUpdatedAt");
  if (!id || !expectedUpdatedAt) {
    return { success: false, message: "Missing shipping option type state" };
  }
  return toActionResult(
    await updateShippingOptionType({
      data: {
        id,
        expectedUpdatedAt,
        label: text(data, "label"),
        code: text(data, "code"),
        description: optionalText(data, "description"),
      },
    }),
  );
};

export const deleteShippingOptionTypeAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const id = ids(data)[0];
  const expectedUpdatedAt = text(data, "expectedUpdatedAt");
  if (!id || !expectedUpdatedAt) {
    return { success: false, message: "Missing shipping option type state" };
  }
  return toActionResult(
    await deleteShippingOptionType({ data: { id, expectedUpdatedAt } }),
  );
};
