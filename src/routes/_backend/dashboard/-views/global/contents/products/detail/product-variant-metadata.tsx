import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { metadataFields } from "@/components/form/metadata-fields";
import {
  productQueries,
  productVariantQueries,
} from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateVariantMetadataAction } from "../product-actions";

/** Independent metadata editor for a product variant child resource. */
const ProductVariantMetadata = () => {
  const { childId: variantId } = useParams({ strict: false }) as {
    childId?: string;
  };
  const queryClient = useQueryClient();
  const close = useRouteModalClose();
  const { data: result, isPending } = useQuery({
    ...productVariantQueries.detail(
      variantId ?? "00000000-0000-0000-0000-000000000000",
    ),
    enabled: Boolean(variantId),
  });

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    if (!variantId) {
      return { success: false, message: "Missing variant ID" };
    }
    formData.set("id", variantId);
    const response = await updateVariantMetadataAction({ data: formData });

    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: productQueries.all() }),
      queryClient.invalidateQueries({ queryKey: productVariantQueries.all() }),
    ]);
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };

  if (!variantId) {
    return <RouteSurfaceMessage>Missing variant ID</RouteSurfaceMessage>;
  }
  if (isPending) {
    return <RouteSurfacePending />;
  }

  const variant = result?.success ? result.data.variant : null;
  if (!variant) {
    return (
      <RouteSurfaceMessage>
        {result?.message ?? "Variant not found"}
      </RouteSurfaceMessage>
    );
  }

  return (
    <RouteFormPage
      title="Edit Metadata"
      description={variant.title}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={metadataFields(variant.metadata ?? {})}
    />
  );
};

export default ProductVariantMetadata;
