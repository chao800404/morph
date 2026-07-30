import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { Spinner } from "@/components/ui/spinner";
import { productOptionQueries } from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateProductOptionAction } from "../product-actions";

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
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const option = result?.success ? result.data : null;
  if (!option) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">
          {result?.message ?? "Option not found"}
        </p>
      </div>
    );
  }

  return (
    <RouteFormPage
      title="Edit Product Option"
      description={option.title}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={[
        {
          type: "input",
          name: "title",
          label: "Title",
          value: option.title,
          required: true,
          autoFocus: true,
        },
        {
          type: "option-values",
          name: "values",
          label: "Values",
          value: option.values.map((value) => value.value),
          placeholder: "Type a value and press Enter...",
        },
      ]}
    />
  );
};

export default OptionEdit;
