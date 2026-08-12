import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { stockLocationQueries } from "@queries/stock-location.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateLocationAction } from "../commerce-actions";
import { locationFormFields } from "./config/location-form-fields";

export default function LocationEdit() {
  const { id } = useParams({ strict: false }) as { id: string };
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const { data: result, isPending } = useQuery(stockLocationQueries.detail(id));

  if (isPending) return <RouteSurfacePending />;
  const location = result?.success ? result.data : null;
  if (!location) {
    return (
      <RouteSurfaceMessage>
        {result?.message ?? "Location not found"}
      </RouteSurfaceMessage>
    );
  }

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    formData.set("id", id);
    const response = await updateLocationAction(formData);
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
      title="Edit Location"
      description={location.name}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fieldsClassName="md:grid-cols-2"
      fields={locationFormFields(location)}
    />
  );
}
