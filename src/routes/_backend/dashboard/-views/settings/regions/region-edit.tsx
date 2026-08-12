import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { regionQueries } from "@queries/region.queries";
import { currencyQueries } from "@queries/currency.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateRegionAction } from "../commerce-actions";
import { regionFormFields } from "./config/region-form-fields";

export default function RegionEdit() {
  const { id } = useParams({ strict: false }) as { id: string };
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const { data: result, isPending } = useQuery(regionQueries.detail(id));
  const { data: countriesResult, isPending: countriesPending } = useQuery(
    regionQueries.assignableCountries(id),
  );
  const { data: currencyResult, isPending: currenciesPending } = useQuery(
    currencyQueries.store(),
  );
  const { data: providerResult, isPending: providersPending } = useQuery(
    regionQueries.paymentProviders(),
  );

  if (isPending || countriesPending || currenciesPending || providersPending) {
    return <RouteSurfacePending />;
  }
  const region = result?.success ? result.data : null;
  if (!region) {
    return (
      <RouteSurfaceMessage>
        {result?.message ?? "Region not found"}
      </RouteSurfaceMessage>
    );
  }

  const countries = countriesResult?.success
    ? countriesResult.data.countries.map((country) => ({
        id: country.iso2,
        value: country.displayName,
      }))
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

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    formData.set("id", id);
    const response = await updateRegionAction(formData);
    if (!response.success) return response;
    await queryClient.invalidateQueries({ queryKey: regionQueries.all() });
    toast.success(response.message);
    close();
    return response;
  };

  return (
    <RouteFormPage
      title="Edit Region"
      description={region.name}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={regionFormFields({ currencies, countries, providers, values: region })}
    />
  );
}
