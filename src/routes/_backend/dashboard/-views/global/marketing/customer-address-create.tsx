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
import { createCustomerAddressAction } from "./customer-actions";
import { customerAddressFormFields } from "./customer-address-form-fields";

export default function CustomerAddressCreate() {
  const { id: customerId } = useParams({ strict: false }) as { id: string };
  const close = useRouteModalClose();
  const queryClient = useQueryClient();
  const { data: result, isPending } = useQuery(
    customerQueries.detail(customerId),
  );
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
    formData.set("customerId", customerId);
    const response = await createCustomerAddressAction({ data: formData });
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
      title="Add Address"
      description={customer.email || "Customer"}
      action={submit}
      fields={customerAddressFormFields()}
      fieldsClassName="grid-cols-2"
    />
  );
}
