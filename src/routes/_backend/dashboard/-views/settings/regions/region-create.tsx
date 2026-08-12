import {
  RouteFormPage,
  useRouteModalClose,
} from "@/components/dialog/route-form-modal";
import { regionQueries } from "@queries/region.queries";
import { currencyQueries } from "@queries/currency.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createRegionAction } from "../commerce-actions";
import { regionFormFields } from "./config/region-form-fields";
export default function RegionCreate() {
  const client = useQueryClient();
  const close = useRouteModalClose();
  const { data } = useQuery(regionQueries.assignableCountries(null));
  const { data: currencyResult } = useQuery(currencyQueries.store());
  const { data: providerResult } = useQuery(regionQueries.paymentProviders());
  const countries = data?.success
    ? data.data.countries.map((c) => ({ id: c.iso2, value: c.displayName }))
    : [];
  const currencies = currencyResult?.success
    ? currencyResult.data.supportedCurrencies.map((currency) => ({
        label: `${currency.code.toUpperCase()} — ${currency.name}`,
        value: currency.code,
      }))
    : [];
  const providers = providerResult?.success
    ? providerResult.data.providers.map((provider) => ({
        id: provider.id,
        value: provider.id.replace(/^pp_/, "").replaceAll("_", " "),
      }))
    : [];
  return (
    <RouteFormPage
      title="Create Region"
      description="A region must have a currency and at least one market."
      fields={regionFormFields({ currencies, countries, providers })}
      action={async (state, form) => {
        const value = await createRegionAction(state, form);
        if (value.success) {
          await client.invalidateQueries({ queryKey: regionQueries.all() });
          toast.success(value.message);
          close();
        }
        return value;
      }}
    />
  );
}
