import type { ReferenceDataKind } from "@/lib/commerce/reference-data";
import type { AssetActionResult } from "@/lib/asset/action-result";
import {
  createReferenceData,
  deleteReferenceData,
  updateReferenceData,
} from "@/server/settings/reference-data.serverFn";

const text = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};
const kind = (data: FormData) => text(data, "kind") as ReferenceDataKind;
const result = (value: {
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
const ids = (data: FormData) => {
  try {
    const parsed: unknown = JSON.parse(String(data.get("ids") ?? "[]"));
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
};
const metadata = (data: FormData): Record<string, string> | null => {
  try {
    const parsed: unknown = JSON.parse(String(data.get("metadata") ?? "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).map(
            ([key, value]) => [key, String(value)],
          ),
        )
      : null;
  } catch {
    return null;
  }
};

export const createReferenceDataAction = async (_: unknown, data: FormData) =>
  result(
    await createReferenceData({
      data: {
        kind: kind(data),
        name: text(data, "name") ?? "",
        code: text(data, "code"),
        description: text(data, "description"),
        parentId:
          text(data, "parentId") === "none" ? null : text(data, "parentId"),
      },
    }),
  );
export const updateReferenceDataAction = async (data: FormData) =>
  result(
    await updateReferenceData({
      data: {
        kind: kind(data),
        id: text(data, "id") ?? "",
        name: text(data, "name"),
        code: text(data, "code"),
        description: text(data, "description") ?? null,
        parentId:
          text(data, "parentId") === "none" ? null : text(data, "parentId"),
      },
    }),
  );
export const updateReferenceDataMetadataAction = async ({
  data,
}: {
  data: FormData;
}) => {
  const value = metadata(data);
  if (!value)
    return {
      success: false,
      message: "Metadata could not be read",
      errors: { metadata: ["Metadata could not be read"] },
    };
  return result(
    await updateReferenceData({
      data: { kind: kind(data), id: text(data, "id") ?? "", metadata: value },
    }),
  );
};
export const deleteReferenceDataAction = async ({ data }: { data: FormData }) =>
  result(
    await deleteReferenceData({ data: { kind: kind(data), ids: ids(data) } }),
  );
