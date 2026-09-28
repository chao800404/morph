import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import {
  normalizeSalesChannelListParams,
  salesChannelQueries,
} from "@queries/sales-channel.queries";
import { stockLocationQueries } from "@queries/stock-location.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { setLocationSalesChannelsAction } from "../commerce-actions";
import { locationSalesChannelFormFields } from "./config/location-sales-channel-form-fields";

export default function LocationSalesChannels() {
  const { id } = useParams({ strict: false }) as { id: string };
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const { data: locationResult, isPending: locationPending } = useQuery(
    stockLocationQueries.detail(id),
  );
  const { data: channelsResult, isPending: channelsPending } = useQuery(
    salesChannelQueries.list(
      normalizeSalesChannelListParams({
        sortBy: "name",
        sortOrder: "asc",
        page: 1,
        limit: 100,
      }),
    ),
  );

  if (locationPending || channelsPending) return <RouteSurfacePending />;
  const location = locationResult?.success ? locationResult.data : null;
  if (!location) {
    return (
      <RouteSurfaceMessage>
        {locationResult?.message ?? "Location not found"}
      </RouteSurfaceMessage>
    );
  }
  if (!channelsResult?.success) {
    return (
      <RouteSurfaceMessage>
        {channelsResult?.message ?? "Sales channels could not be loaded"}
      </RouteSurfaceMessage>
    );
  }

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    formData.set("stockLocationId", id);
    const response = await setLocationSalesChannelsAction(formData);
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
      title="Manage sales channels"
      description={location.name}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={locationSalesChannelFormFields({
        salesChannelIds: location.salesChannels.map((channel) => channel.id),
        channels: channelsResult.data.salesChannels,
      })}
    />
  );
}
