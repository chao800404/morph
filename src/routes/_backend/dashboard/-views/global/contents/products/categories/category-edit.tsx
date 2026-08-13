import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { productCategoryQueries } from "@queries/product.queries";
import { remoteOptionQueries } from "@queries/remote-options.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateProductCategoryAction } from "../product-actions";
import {
  categoryFormFields,
  toCategoryForm,
} from "./config/product-category-form";

/**
 * Edit page for a category, at /dashboard/categories/<id>/edit.
 *
 * The parent is deliberately absent: moving a category would have to rewrite
 * every descendant's materialised path, and Medusa's edit form cannot do it
 * either — re-parenting is a separate operation there.
 */
const CategoryEdit = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const queryClient = useQueryClient();
  const close = useRouteModalClose();
  const { data: result, isPending } = useQuery(
    productCategoryQueries.detail(id),
  );

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    formData.set("id", id);
    const response = await updateProductCategoryAction({ data: formData });

    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: productCategoryQueries.all() }),
      queryClient.invalidateQueries({ queryKey: remoteOptionQueries.all() }),
    ]);
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };

  if (isPending) {
    return <RouteSurfacePending />;
  }

  const category = result?.success ? result.data : null;
  if (!category) {
    return (
      <RouteSurfaceMessage>
        {result?.message ?? "Category not found"}
      </RouteSurfaceMessage>
    );
  }

  return (
    <RouteFormPage
      title="Edit Category"
      description={category.name}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={categoryFormFields(toCategoryForm(category))}
      fieldsClassName="sm:grid-cols-2"
    />
  );
};

export default CategoryEdit;
