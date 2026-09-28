import type { AssetActionResult } from "@/lib/asset/action-result";
import {
  deleteRevokedSecretApiKey,
  revokeSecretApiKey,
  updateSecretApiKeyTitle,
} from "@/server/api-key/secret-api-keys.serverFn";

const text = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
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

export const updateSecretApiKeyTitleAction = async ({
  data,
}: {
  data: FormData;
}) =>
  toActionResult(
    await updateSecretApiKeyTitle({
      data: { id: text(data, "id"), title: text(data, "title") },
    }),
  );

export const revokeSecretApiKeyAction = async ({ data }: { data: FormData }) =>
  toActionResult(await revokeSecretApiKey({ data: { id: text(data, "id") } }));

export const deleteSecretApiKeyAction = async ({ data }: { data: FormData }) =>
  toActionResult(
    await deleteRevokedSecretApiKey({ data: { id: text(data, "id") } }),
  );
