import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { updateCustomerGroup } from "@/server/customer/customer-groups.serverFn";
import { customerGroupQueries } from "@queries/customer.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { customerGroupFormFields } from "./customer-group-form-fields";

export default function CustomerGroupEdit() {
  const { id } = useParams({ strict: false }) as { id: string };
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const { data: result, isPending } = useQuery(customerGroupQueries.detail(id));
  if (isPending) return <RouteSurfacePending />;
  const group = result?.success ? result.data : null;
  if (!group) {
    return (
      <RouteSurfaceMessage>
        {result?.message ?? "Customer group not found"}
      </RouteSurfaceMessage>
    );
  }
  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    const name = formData.get("name");
    const response = await updateCustomerGroup({
      data: { id, name: typeof name === "string" ? name : undefined },
    });
    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }
    await queryClient.invalidateQueries({ queryKey: customerGroupQueries.all() });
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };
  return (
    <RouteFormPage
      title="Edit Customer Group"
      description={group.name}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={customerGroupFormFields(group.name)}
    />
  );
}
