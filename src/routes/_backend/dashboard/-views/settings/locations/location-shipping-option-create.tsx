import {
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { getCountryCatalog } from "@/lib/region/countries";
import {
  normalizeShippingProfileListParams,
  shippingProfileQueries,
} from "@queries/shipping-profile.queries";
import { shippingAdminQueries } from "@queries/shipping-admin.queries";
import { stockLocationQueries } from "@queries/stock-location.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { createLocationShippingOptionAction } from "./location-shipping-option-actions";
import { LocationShippingOptionCreateForm } from "./location-shipping-option-form";

export default function LocationShippingOptionCreate() {
  const { id } = useParams({ strict: false }) as { id: string };
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const { data: locationResult, isPending: locationPending } = useQuery(
    stockLocationQueries.detail(id),
  );
  const { data: shippingResult, isPending: shippingPending } = useQuery(
    shippingAdminQueries.forLocation(id),
  );
  const { data: profilesResult, isPending: profilesPending } = useQuery(
    shippingProfileQueries.list(
      normalizeShippingProfileListParams({
        sortBy: "name",
        sortOrder: "asc",
        page: 1,
        limit: 100,
      }),
    ),
  );

  if (locationPending || shippingPending || profilesPending) {
    return <RouteSurfacePending />;
  }
  const location = locationResult?.success ? locationResult.data : null;
  if (!location) {
    return (
      <RouteSurfaceMessage>
        {locationResult?.message ?? "Location not found"}
      </RouteSurfaceMessage>
    );
  }
  if (!shippingResult?.success) {
    return (
      <RouteSurfaceMessage>
        {shippingResult?.message ?? "Store currencies could not be loaded"}
      </RouteSurfaceMessage>
    );
  }
  if (!profilesResult?.success) {
    return (
      <RouteSurfaceMessage>
        {profilesResult?.message ?? "Shipping profiles could not be loaded"}
      </RouteSurfaceMessage>
    );
  }

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    formData.set("locationId", id);
    const response = await createLocationShippingOptionAction(formData);
    if (!response.success) return response;
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: shippingAdminQueries.all(),
      }),
      queryClient.invalidateQueries({
        queryKey: shippingProfileQueries.all(),
      }),
    ]);
    toast.success(response.message);
    close();
    return response;
  };

  return (
    <LocationShippingOptionCreateForm
      title="Add service zone"
      description={`${location.name} · Add geographic areas and the first shipping option.`}
      action={submit}
      submitLabel="Create service zone"
      loadingLabel="Creating..."
      currencies={shippingResult.data.currencies}
      countries={getCountryCatalog().map((country) => ({
        id: country.iso2,
        value: country.name,
      }))}
      profiles={profilesResult.data.profiles.map((profile) => ({
        id: profile.id,
        value: profile.name,
      }))}
      optionTypes={shippingResult.data.shippingOptionTypes.map((type) => ({
        id: type.id,
        value: `${type.label} (${type.code})`,
      }))}
      fulfillmentProviders={shippingResult.data.fulfillmentProviders.map(
        (provider) => ({ id: provider.id, value: provider.name }),
      )}
      shippingRateProviders={shippingResult.data.shippingRateProviders.map(
        (provider) => ({ id: provider.id, value: provider.name }),
      )}
    />
  );
}
