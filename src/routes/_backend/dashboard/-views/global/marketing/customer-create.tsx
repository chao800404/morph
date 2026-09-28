import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { customerQueries } from "@queries/customer.queries";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createCustomerAction } from "./customer-actions";
import { customerFormFields } from "./customer-form-fields";

export default function CustomerCreate() {
  const queryClient = useQueryClient();
  const close = useRouteModalClose();
  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    const response = await createCustomerAction({ data: formData });
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
      title="Create Customer"
      description="Add a customer profile to your store."
      action={submit}
      fields={customerFormFields()}
    />
  );
}
