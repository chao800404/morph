import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { Spinner } from "@/components/ui/spinner";
import {
  productCategoryQueries,
  productTaxonomyQueries,
} from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateProductCategoryAction } from "../product-actions";
import {
  categoryFormFields,
  toCategoryForm,
} from "./config/product-category-form";

/**
 * Edit page for a category, at /dashboard/product-categories/<id>/edit.
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
      queryClient.invalidateQueries({ queryKey: productTaxonomyQueries.all() }),
    ]);
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

  const category = result?.success ? result.data : null;
  if (!category) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">
          {result?.message ?? "Category not found"}
        </p>
      </div>
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
