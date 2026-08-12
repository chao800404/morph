import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { productOptionQueries } from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateProductOptionAction } from "../product-actions";
import { optionFormFields } from "./config/option-form-fields";

/**
 * Edit page for a library option, at /dashboard/product-options/<id>/edit.
 *
 * The record is loaded from the id in the URL rather than handed over by the
 * list, so the page works on a direct link or a refresh.
 */
const OptionEdit = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const queryClient = useQueryClient();
  const close = useRouteModalClose();
  const { data: result, isPending } = useQuery(
    productOptionQueries.detail(id),
  );

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    formData.set("id", id);
    const response = await updateProductOptionAction({ data: formData });

    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }

    await queryClient.invalidateQueries({
      queryKey: productOptionQueries.all(),
    });
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };

  if (isPending) {
    return <RouteSurfacePending />;
  }

  const option = result?.success ? result.data : null;
  if (!option) {
    return (
      <RouteSurfaceMessage>
          {result?.message ?? "Option not found"}
      </RouteSurfaceMessage>
    );
  }

  return (
    <RouteFormPage
      title="Edit Product Option"
      description={option.title}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={optionFormFields({
        title: option.title,
        values: option.values.map((value) => value.value),
      })}
    />
  );
};

export default OptionEdit;
