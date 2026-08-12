import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { salesChannelQueries } from "@queries/sales-channel.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateSalesChannelAction } from "../commerce-actions";

export default function SalesChannelEdit() {
  const { id } = useParams({ strict: false }) as { id: string };
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const { data: result, isPending } = useQuery(salesChannelQueries.detail(id));

  if (isPending) return <RouteSurfacePending />;
  const channel = result?.success ? result.data : null;
  if (!channel) {
    return (
      <RouteSurfaceMessage>
        {result?.message ?? "Sales channel not found"}
      </RouteSurfaceMessage>
    );
  }

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    formData.set("id", id);
    const response = await updateSalesChannelAction(formData);
    if (!response.success) return response;
    await queryClient.invalidateQueries({
      queryKey: salesChannelQueries.all(),
    });
    toast.success(response.message);
    close();
    return response;
  };

  return (
    <RouteFormPage
      title="Edit Sales Channel"
      description={channel.name}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={[
        {
          type: "input",
          name: "name",
          label: "Name",
          value: channel.name,
          required: true,
          autoFocus: true,
        },
        {
          type: "textarea",
          name: "description",
          label: "Description",
          value: channel.description ?? "",
          rows: 3,
        },
        {
          type: "switch",
          name: "isDisabled",
          label: "Disabled",
          value: channel.isDisabled,
        },
      ]}
    />
  );
}
