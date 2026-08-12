import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { productOptionQueries } from "@queries/product.queries";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createProductOptionAction } from "../product-actions";
import { optionFormFields } from "./config/option-form-fields";

/**
 * Create page for the shared option library.
 *
 * Its URL is /dashboard/product-options/create.
 */
const OptionCreate = () => {
  const queryClient = useQueryClient();
  const close = useRouteModalClose();

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    const result = await createProductOptionAction({ data: formData });

    if (!result.success) {
      toast.error(result.message, { position: "top-center" });
      return result;
    }

    await queryClient.invalidateQueries({
      queryKey: productOptionQueries.all(),
    });
    toast.success(result.message, { position: "top-center" });
    close();
    return result;
  };

  return (
    <RouteFormPage
      title="Create Product Option"
      description="Define a reusable option such as Size or Colour."
      action={submit}
      fields={optionFormFields()}
    />
  );
};

export default OptionCreate;
