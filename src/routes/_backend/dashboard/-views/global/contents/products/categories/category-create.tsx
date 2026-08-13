import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { productCategoryQueries } from "@queries/product.queries";
import { remoteOptionQueries } from "@queries/remote-options.queries";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createProductCategoryAction } from "../product-actions";
import {
  categoryFormFields,
  emptyCategoryForm,
} from "./config/product-category-form";

/** Create page for product categories, at /dashboard/categories/create. */
const CategoryCreate = () => {
  const queryClient = useQueryClient();
  const close = useRouteModalClose();

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
      queryClient.invalidateQueries({ queryKey: remoteOptionQueries.all() }),
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
      fields={categoryFormFields(emptyCategoryForm(), { includeParent: true })}
      fieldsClassName="sm:grid-cols-2"
    />
  );
};

export default CategoryCreate;
