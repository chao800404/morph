import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import {
  productCategoryQueries,
  productTaxonomyQueries,
} from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createProductCategoryAction } from "../product-actions";
import {
  categoryFormFields,
  emptyCategoryForm,
} from "./config/product-category-form";

/** Create page for product categories, at /dashboard/product-categories/create. */
const CategoryCreate = () => {
  const queryClient = useQueryClient();
  const close = useRouteModalClose();

  // The parent picker needs the whole tree — the same bounded read the product
  // Organize step already uses, so it usually comes from cache.
  const { data: taxonomy } = useQuery(productTaxonomyQueries.list());
  const parents = taxonomy?.success ? (taxonomy.data?.categories ?? []) : [];

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    const result = await createProductCategoryAction({ data: formData });

    if (!result.success) {
      toast.error(result.message, { position: "top-center" });
      return result;
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: productCategoryQueries.all() }),
      // The Organize step's category picker reads the same rows.
      queryClient.invalidateQueries({ queryKey: productTaxonomyQueries.all() }),
    ]);
    toast.success(result.message, { position: "top-center" });
    close();
    return result;
  };

  return (
    <RouteFormPage
      title="Create Category"
      description="Group products into a branch of your storefront's category tree."
      action={submit}
      fields={categoryFormFields(emptyCategoryForm(), { parents })}
      fieldsClassName="sm:grid-cols-2"
    />
  );
};

export default CategoryCreate;
