import type { TaxRateDTO } from "./dto/tax.dto";

export interface TaxableItemReference {
  productId?: string;
  productTypeId?: string | null;
  shippingOptionId?: string;
}

const matches = (
  rate: TaxRateDTO,
  reference: "product" | "product_type" | "shipping_option",
  id?: string | null,
) =>
  Boolean(
    id &&
    rate.rules.some(
      (rule) => rule.reference === reference && rule.referenceId === id,
    ),
  );

const score = (
  rate: TaxRateDTO,
  item: TaxableItemReference,
  provinceRegionId: string | null,
) => {
  const province = rate.taxRegionId === provinceRegionId;
  const direct =
    matches(rate, "product", item.productId) ||
    matches(rate, "shipping_option", item.shippingOptionId);
  const type = matches(rate, "product_type", item.productTypeId);
  if (province && direct) return 1;
  if (province && type) return 2;
  if (province && rate.isDefault) return 3;
  if (direct) return 4;
  if (type) return 5;
  if (rate.isDefault) return 6;
  return 7;
};

/**
 * Mirrors Medusa's system tax-provider selection order. The provider itself
 * only turns these stored percentages into tax lines; matching stays in the
 * tax module so an external provider can reuse the same region/rule model.
 */
export const resolveTaxRates = (options: {
  rates: TaxRateDTO[];
  item: TaxableItemReference;
  countryRegionId: string;
  provinceRegionId?: string | null;
}) => {
  const regionIds = new Set(
    [options.countryRegionId, options.provinceRegionId].filter(
      (id): id is string => Boolean(id),
    ),
  );
  const candidates = options.rates
    .filter((rate) => regionIds.has(rate.taxRegionId))
    .filter(
      (rate) =>
        rate.isDefault ||
        matches(rate, "product", options.item.productId) ||
        matches(rate, "product_type", options.item.productTypeId) ||
        matches(rate, "shipping_option", options.item.shippingOptionId),
    )
    .sort(
      (left, right) =>
        score(left, options.item, options.provinceRegionId ?? null) -
        score(right, options.item, options.provinceRegionId ?? null),
    );
  const selected = candidates[0];
  if (!selected) return [];
  if (
    !selected.isCombinable ||
    selected.taxRegionId !== options.provinceRegionId
  )
    return [selected];
  const countryRate = candidates.find(
    (rate) => rate.taxRegionId === options.countryRegionId,
  );
  return countryRate ? [selected, countryRate] : [selected];
};
