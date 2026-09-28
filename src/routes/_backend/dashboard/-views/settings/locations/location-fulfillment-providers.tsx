import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { setLocationFulfillmentProvidersAction } from "../commerce-actions";
import { stockLocationQueries } from "@queries/stock-location.queries";
import { locationFulfillmentProviderFormFields } from "./config/location-fulfillment-provider-form-fields";

export default function LocationFulfillmentProviders() {
  const { id } = useParams({ strict: false }) as { id: string };
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const { data: locationResult, isPending: locationPending } = useQuery(
    stockLocationQueries.detail(id),
  );
  const { data: providersResult, isPending: providersPending } = useQuery(
    stockLocationQueries.fulfillmentProviders(id),
  );

  if (locationPending || providersPending) return <RouteSurfacePending />;
  const location = locationResult?.success ? locationResult.data : null;
  if (!location) {
    return (
      <RouteSurfaceMessage>
        {locationResult?.message ?? "Location not found"}
      </RouteSurfaceMessage>
    );
  }
  if (!providersResult?.success) {
    return (
      <RouteSurfaceMessage>
        {providersResult?.message ??
          "Fulfillment providers could not be loaded"}
      </RouteSurfaceMessage>
    );
  }

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    formData.set("stockLocationId", id);
    const response = await setLocationFulfillmentProvidersAction(formData);
    if (!response.success) return response;
    await queryClient.invalidateQueries({
      queryKey: stockLocationQueries.all(),
    });
    toast.success(response.message);
    close();
    return response;
  };

  return (
    <RouteFormPage
      title="Manage fulfillment providers"
      description={location.name}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={locationFulfillmentProviderFormFields({
        fulfillmentProviderIds: providersResult.data.fulfillmentProviderIds,
        providers: providersResult.data.providers,
      })}
    />
  );
}
