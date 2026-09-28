import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { customerQueries } from "@queries/customer.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateCustomerAddressAction } from "./customer-actions";
import { customerAddressFormFields } from "./customer-address-form-fields";

export default function CustomerAddressEdit() {
  const { id: customerId, childId: addressId } = useParams({
    strict: false,
  }) as { id: string; childId: string };
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const { data: result, isPending } = useQuery(
    customerQueries.detail(customerId),
  );
  if (isPending) return <RouteSurfacePending />;
  const customer = result?.success ? result.data : null;
  const address = customer?.addresses.find((row) => row.id === addressId);
  if (!customer || !address) {
    return (
      <RouteSurfaceMessage>
        {result?.message ?? "Customer address not found"}
      </RouteSurfaceMessage>
    );
  }
  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    formData.set("customerId", customerId);
    formData.set("addressId", addressId);
    const response = await updateCustomerAddressAction({ data: formData });
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
      title="Edit Address"
      description={customer.email || "Customer"}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={customerAddressFormFields(address)}
      fieldsClassName="grid-cols-2"
    />
  );
}
