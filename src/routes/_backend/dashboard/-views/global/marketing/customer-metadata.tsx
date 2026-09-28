import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { metadataFields } from "@/components/form/metadata-fields";
import { customerQueries } from "@queries/customer.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateCustomerMetadataAction } from "./customer-actions";

export default function CustomerMetadata() {
  const { id } = useParams({ strict: false }) as { id: string };
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const { data: result, isPending } = useQuery(customerQueries.detail(id));
  if (isPending) return <RouteSurfacePending />;
  const customer = result?.success ? result.data : null;
  if (!customer) {
    return (
      <RouteSurfaceMessage>
        {result?.message ?? "Customer not found"}
      </RouteSurfaceMessage>
    );
  }

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    formData.set("id", id);
    const response = await updateCustomerMetadataAction({ data: formData });
    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }
    await queryClient.invalidateQueries({ queryKey: customerQueries.all() });
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };

  return (
    <RouteFormPage
      title="Edit Metadata"
      description={customer.email || "Customer"}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={metadataFields(customer.metadata ?? {})}
    />
  );
}
