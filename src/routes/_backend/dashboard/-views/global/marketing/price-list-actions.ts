import type { AssetActionResult } from "@/lib/asset/action-result";
import { deletePriceList, removePriceListPrice } from "@/server/pricing/price-lists.serverFn";

const text = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
};

const toActionResult = (result: { success: boolean; message: string }): AssetActionResult => ({
  success: result.success,
  message: result.message,
});

export const deletePriceListAction = async ({ data }: { data: FormData }): Promise<AssetActionResult> => {
  const id = text(data, "id");
  if (!id) return { success: false, message: "Missing price list ID" };
  return toActionResult(await deletePriceList({ data: { id } }));
};

export const removePriceListPriceAction = async ({ data }: { data: FormData }): Promise<AssetActionResult> => {
  const priceListId = text(data, "priceListId");
  const priceId = text(data, "priceId");
  if (!priceListId || !priceId) return { success: false, message: "Missing price entry information" };
  return toActionResult(await removePriceListPrice({ data: { priceListId, priceId } }));
};
