import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { customerGroupQueries } from "@queries/customer.queries";
import { createCustomerGroup } from "@/server/customer/customer-groups.serverFn";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { customerGroupFormFields } from "./customer-group-form-fields";

export default function CustomerGroupCreate() {
  const queryClient = useQueryClient();
  const close = useRouteModalClose();
  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    const name = formData.get("name");
    const result = await createCustomerGroup({
      data: { name: typeof name === "string" ? name : "" },
    });
    if (!result.success) {
      toast.error(result.message, { position: "top-center" });
      return result;
    }
    await queryClient.invalidateQueries({ queryKey: customerGroupQueries.all() });
    toast.success(result.message, { position: "top-center" });
    close();
    return result;
  };
  return (
    <RouteFormPage
      title="Create Customer Group"
      description="Group customers for pricing and promotion targeting."
      action={submit}
      fields={customerGroupFormFields()}
    />
  );
}
