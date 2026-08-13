import { resolveTaxRates } from "../resolve-tax-rates";
import type { TaxableItemReference } from "../resolve-tax-rates";
import type { TaxLine, TaxProvider, TaxProviderInput } from "./tax-provider";

const linesFor = (
  input: TaxProviderInput,
  reference: TaxableItemReference,
  target: { lineItemId: string } | { shippingLineId: string },
): TaxLine[] =>
  resolveTaxRates({
    rates: input.region.rates,
    item: reference,
    countryRegionId: input.region.countryRegion.id,
    provinceRegionId: input.region.provinceRegion?.id,
  }).flatMap((rate) =>
    rate.rate === null
      ? []
      : [
          {
            ...target,
            rate: rate.rate,
            name: rate.name,
            code: rate.code,
            providerId: "tp_system",
            taxRateId: rate.id,
          },
        ],
  );

export const systemTaxProvider: TaxProvider = {
  id: "tp_system",
  async getTaxLines(input) {
    return [
      ...input.itemLines.flatMap((line) =>
        linesFor(input, line, { lineItemId: line.id }),
      ),
      ...input.shippingLines.flatMap((line) =>
        linesFor(input, line, { shippingLineId: line.id }),
      ),
    ];
  },
};
