import type { AssetActionResult } from "@/lib/asset/action-result";
import {
  createTaxProvince,
  createTaxRate,
  createTaxRegion,
  deleteTaxRates,
  deleteTaxRegions,
  updateTaxRate,
  updateTaxRegion,
} from "@/server/tax/tax-regions.serverFn";

const text = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};
const checked = (data: FormData, key: string) => {
  const value = data.get(key);
  return value === "on" || value === "true";
};
const ids = (data: FormData, key: string) => {
  try {
    const value: unknown = JSON.parse(String(data.get(key) ?? "[]"));
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
};
const taxRules = (data: FormData) => [
  ...ids(data, "products").map((referenceId) => ({
    reference: "product" as const,
    referenceId,
  })),
  ...ids(data, "productTypes").map((referenceId) => ({
    reference: "product_type" as const,
    referenceId,
  })),
  ...ids(data, "shippingOptions").map((referenceId) => ({
    reference: "shipping_option" as const,
    referenceId,
  })),
];
const defaultTaxRate = (data: FormData) => {
  const name = text(data, "defaultRateName");
  const code = text(data, "defaultRateCode");
  const rate = text(data, "defaultRate");
  return name && code
    ? {
        name,
        code,
        rate: rate ? Number(rate) : null,
        isCombinable: checked(data, "defaultRateCombinable"),
      }
    : undefined;
};
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
const metadata = (data: FormData): Record<string, string> | null => {
  try {
    const value: unknown = JSON.parse(String(data.get("metadata") ?? "{}"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(
            ([key, item]) => [key, String(item)],
          ),
        )
      : null;
  } catch {
    return null;
  }
};

export const createTaxRegionAction = async (_: unknown, data: FormData) =>
  result(
    await createTaxRegion({
      data: {
        countryCode: text(data, "countryCode") ?? "",
        providerId: text(data, "providerId") ?? "tp_system",
        defaultTaxRate: defaultTaxRate(data),
      },
    }),
  );
export const createTaxProvinceAction = async (_: unknown, data: FormData) =>
  result(
    await createTaxProvince({
      data: {
        parentId: text(data, "parentId") ?? "",
        provinceCode: text(data, "provinceCode") ?? "",
        defaultTaxRate: defaultTaxRate(data),
      },
    }),
  );
export const updateTaxRegionAction = async (data: FormData) =>
  result(
    await updateTaxRegion({
      data: {
        id: text(data, "id") ?? "",
        providerId: text(data, "providerId") ?? null,
      },
    }),
  );
export const deleteTaxRegionsAction = async ({ data }: { data: FormData }) =>
  result(await deleteTaxRegions({ data: { ids: ids(data, "ids") } }));
export const createTaxRateAction = async (_: unknown, data: FormData) =>
  result(
    await createTaxRate({
      data: {
        taxRegionId: text(data, "taxRegionId") ?? "",
        name: text(data, "name") ?? "",
        code: text(data, "code") ?? "",
        rate: text(data, "rate") ? Number(text(data, "rate")) : null,
        isDefault: checked(data, "isDefault"),
        isCombinable: checked(data, "isCombinable"),
        rules: taxRules(data),
      },
    }),
  );
export const updateTaxRateAction = async (data: FormData) =>
  result(
    await updateTaxRate({
      data: {
        id: text(data, "rateId") ?? "",
        taxRegionId: text(data, "taxRegionId") ?? "",
        name: text(data, "name"),
        code: text(data, "code"),
        rate: text(data, "rate") ? Number(text(data, "rate")) : null,
        isDefault: checked(data, "isDefault"),
        isCombinable: checked(data, "isCombinable"),
        rules: taxRules(data),
      },
    }),
  );
export const deleteTaxRatesAction = async ({ data }: { data: FormData }) =>
  result(await deleteTaxRates({ data: { ids: ids(data, "ids") } }));
export const updateTaxRegionMetadataAction = async ({
  data,
}: {
  data: FormData;
}) => {
  const value = metadata(data);
  return value
    ? result(
        await updateTaxRegion({
          data: { id: text(data, "id") ?? "", metadata: value },
        }),
      )
    : {
        success: false,
        message: "Metadata could not be read",
        errors: { metadata: ["Metadata could not be read"] },
      };
};
