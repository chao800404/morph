import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import {
  productCategoryQueries,
  productTaxonomyQueries,
} from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateProductCategoryMetadataAction } from "../product-actions";
import { metadataFields } from "@/components/form/metadata-fields";

/**
 * Metadata editor for a category, at
 * /dashboard/categories/<id>/metadata.
 *
 * Its own page rather than a section of the edit form: it submits only the
 * metadata field, so editing a category's name can never clear its metadata,
 * and the URL says which form is open.
 */
const CategoryMetadata = () => {
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
    const response = await updateProductCategoryMetadataAction({
      data: formData,
    });

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
      title="Edit Metadata"
      description={category.name}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={metadataFields(category.metadata)}
    />
  );
};

export default CategoryMetadata;
