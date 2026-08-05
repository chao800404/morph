import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { metadataFields } from "@/components/form/metadata-fields";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { productQueries } from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateProductMetadataAction } from "../product-actions";

/** Metadata editor for a product, at /dashboard/products/<id>/metadata. */
const ProductMetadata = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const queryClient = useQueryClient();
  const close = useRouteModalClose();
  const { data: result, isPending } = useQuery(productQueries.detail(id));

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    formData.set("id", id);
    const response = await updateProductMetadataAction({ data: formData });

    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }

    await queryClient.invalidateQueries({ queryKey: productQueries.all() });
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };

  if (isPending) {
    return <RouteSurfacePending />;
  }

  const product = result?.success ? result.data : null;
  if (!product) {
    return (
      <RouteSurfaceMessage>
          {result?.message ?? "Product not found"}
      </RouteSurfaceMessage>
    );
  }

  return (
    <RouteFormPage
      title="Edit Metadata"
      description={product.title}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={metadataFields(product.metadata ?? {})}
    />
  );
};

export default ProductMetadata;
