import type { AssetActionResult } from "@/lib/asset/action-result";
import {
  createRegion,
  deleteRegions,
  updateRegion,
} from "@/server/region/regions.serverFn";
import {
  createSalesChannel,
  deleteSalesChannels,
  updateSalesChannel,
} from "@/server/sales-channel/sales-channels.serverFn";
import {
  createStockLocation,
  deleteStockLocations,
  updateStockLocation,
} from "@/server/stock-location/stock-locations.serverFn";
import { updateDashboardUserMetadata } from "@/server/auth/dashboard-users.serverFn";

const text = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};
const ids = (data: FormData, key: string) => {
  try {
    const value = JSON.parse(String(data.get(key) ?? "[]"));
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
};
const metadata = (data: FormData): Record<string, string> | null => {
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
const metadataError = (): AssetActionResult => ({
  success: false,
  message: "Metadata could not be read",
  errors: { metadata: ["Metadata could not be read"] },
});
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
const address = (data: FormData) => {
  const address1 = text(data, "address1");
  const countryCode = text(data, "countryCode")?.toUpperCase();
  if (!address1 && !countryCode) return null;
  return {
    address1: address1 ?? "",
    countryCode: countryCode ?? "",
    address2: text(data, "address2") ?? null,
    company: text(data, "company") ?? null,
    city: text(data, "city") ?? null,
    province: text(data, "province") ?? null,
    postalCode: text(data, "postalCode") ?? null,
    phone: text(data, "phone") ?? null,
  };
};

export const createRegionAction = async (_: unknown, data: FormData) =>
  result(
    await createRegion({
      data: {
        name: text(data, "name") ?? "",
        type: text(data, "type") ?? "custom",
        currencyCode: text(data, "currencyCode") ?? "",
        automaticTaxes: data.get("automaticTaxes") === "on",
        isTaxInclusive: data.get("isTaxInclusive") === "on",
        countries: ids(data, "countries").map((code) => code.toUpperCase()),
        paymentProviderIds: ids(data, "paymentProviderIds"),
      },
    }),
  );
export const updateRegionAction = async (data: FormData) =>
  result(
    await updateRegion({
      data: {
        id: text(data, "id") ?? "",
        name: text(data, "name"),
        currencyCode: text(data, "currencyCode"),
        automaticTaxes: data.get("automaticTaxes") === "on",
        isTaxInclusive: data.get("isTaxInclusive") === "on",
        ...(data.has("countries")
          ? {
              countries: ids(data, "countries").map((code) =>
                code.toUpperCase(),
              ),
            }
          : {}),
        ...(data.has("paymentProviderIds")
          ? { paymentProviderIds: ids(data, "paymentProviderIds") }
          : {}),
      },
    }),
  );
export const deleteRegionsAction = async ({ data }: { data: FormData }) =>
  result(await deleteRegions({ data: { ids: ids(data, "ids") } }));
export const createSalesChannelAction = async (_: unknown, data: FormData) =>
  result(
    await createSalesChannel({
      data: {
        name: text(data, "name") ?? "",
        description: text(data, "description") ?? null,
        // The form exposes the positive author-facing state; persistence keeps
        // Medusa's negative `is_disabled` field for compatibility.
        isDisabled: data.get("enabled") !== "on",
      },
    }),
  );
export const updateSalesChannelAction = async (data: FormData) =>
  result(
    await updateSalesChannel({
      data: {
        id: text(data, "id") ?? "",
        name: text(data, "name"),
        description: text(data, "description") ?? null,
        // The author-facing control is positive (`Enabled`), while the
        // Medusa-compatible persistence field is negative (`is_disabled`).
        isDisabled: data.get("enabled") !== "on",
      },
    }),
  );
export const deleteSalesChannelsAction = async ({ data }: { data: FormData }) =>
  result(await deleteSalesChannels({ data: { ids: ids(data, "ids") } }));
export const createLocationAction = async (_: unknown, data: FormData) =>
  result(
    await createStockLocation({
      data: { name: text(data, "name") ?? "", address: address(data) },
    }),
  );
export const updateLocationAction = async (data: FormData) =>
  result(
    await updateStockLocation({
      data: {
        id: text(data, "id") ?? "",
        name: text(data, "name"),
        address: address(data),
      },
    }),
  );
export const deleteLocationsAction = async ({ data }: { data: FormData }) =>
  result(await deleteStockLocations({ data: { ids: ids(data, "ids") } }));

export const updateRegionMetadataAction = async ({
  data,
}: {
  data: FormData;
}) => {
  const value = metadata(data);
  if (!value) return metadataError();
  return result(
    await updateRegion({
      data: { id: text(data, "id") ?? "", metadata: value },
    }),
  );
};

export const updateSalesChannelMetadataAction = async ({
  data,
}: {
  data: FormData;
}) => {
  const value = metadata(data);
  if (!value) return metadataError();
  return result(
    await updateSalesChannel({
      data: { id: text(data, "id") ?? "", metadata: value },
    }),
  );
};

export const updateLocationMetadataAction = async ({
  data,
}: {
  data: FormData;
}) => {
  const value = metadata(data);
  if (!value) return metadataError();
  return result(
    await updateStockLocation({
      data: { id: text(data, "id") ?? "", metadata: value },
    }),
  );
};

export const updateUserMetadataAction = async ({
  data,
}: {
  data: FormData;
}) => {
  const value = metadata(data);
  if (!value) return metadataError();
  return result(
    await updateDashboardUserMetadata({
      data: { id: text(data, "id") ?? "", metadata: value },
    }),
  );
};
