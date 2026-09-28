import type { AssetActionResult } from "@/lib/asset/action-result";
import { metadataInputSchema } from "@/lib/validations/product";
import {
  deleteCustomerGroup,
  removeCustomerFromGroup,
  updateCustomerGroup,
} from "@/server/customer/customer-groups.serverFn";

const text = (data: FormData, key: string): string | undefined => {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : undefined;
};

const toActionResult = (result: {
  success: boolean;
  message: string;
  errors?: Partial<Record<string, string[]>>;
}): AssetActionResult => ({
  success: result.success,
  message: result.message,
  errors: result.errors
    ? Object.fromEntries(
        Object.entries(result.errors).filter(
          (entry): entry is [string, string[]] => entry[1] !== undefined,
        ),
      )
    : undefined,
});

export const deleteCustomerGroupAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const id = text(data, "groupId");
  if (!id) return { success: false, message: "Missing customer group ID" };
  return toActionResult(await deleteCustomerGroup({ data: { id } }));
};

export const removeCustomerFromGroupAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const groupId = text(data, "groupId");
  const customerId = text(data, "customerId");
  if (!groupId || !customerId) {
    return { success: false, message: "Customer group membership is missing" };
  }
  return toActionResult(
    await removeCustomerFromGroup({ data: { groupId, customerId } }),
  );
};

export const updateCustomerGroupMetadataAction = async ({
  data,
}: {
  data: FormData;
}): Promise<AssetActionResult> => {
  const id = text(data, "id");
  const raw = data.get("metadata");
  if (!id || typeof raw !== "string") {
    return { success: false, message: "Customer group metadata is incomplete" };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { success: false, message: "Customer group metadata is invalid" };
  }
  const parsed = metadataInputSchema.safeParse(value);
  if (!parsed.success) {
    return { success: false, message: "Customer group metadata is invalid" };
  }
  const response = await updateCustomerGroup({
    data: { id, metadata: parsed.data },
  });
  return toActionResult(response);
};
