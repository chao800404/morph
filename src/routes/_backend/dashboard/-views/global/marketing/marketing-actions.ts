import type { AssetActionResult } from "@/lib/asset/action-result";
import { updateOrderMetadata } from "@/server/marketing/orders.serverFn";
import { updatePromotionMetadata } from "@/server/marketing/promotions.serverFn";

const text = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const readMetadata = (data: FormData): Record<string, string> | null => {
  const raw = data.get("metadata");
  if (typeof raw !== "string" || raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
        key,
        String(value),
      ]),
    );
  } catch {
    return null;
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

const metadataError = (): AssetActionResult => ({
  success: false,
  message: "Metadata could not be read",
  errors: { metadata: ["Metadata could not be read"] },
});

export const updateOrderMetadataAction = async ({
  data,
}: {
  data: FormData;
}) => {
  const metadata = readMetadata(data);
  if (!metadata) return metadataError();
  return toActionResult(
    await updateOrderMetadata({
      data: { id: text(data, "id") ?? "", metadata },
    }),
  );
};

export const updatePromotionMetadataAction = async ({
  data,
}: {
  data: FormData;
}) => {
  const metadata = readMetadata(data);
  if (!metadata) return metadataError();
  return toActionResult(
    await updatePromotionMetadata({
      data: { id: text(data, "id") ?? "", metadata },
    }),
  );
};
