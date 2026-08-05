import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import {
  productOptionQueries,
  productTaxonomyQueries,
} from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateProductOptionMetadataAction } from "../product-actions";
import { metadataFields } from "@/components/form/metadata-fields";

/** Metadata editor for an option, at /dashboard/product-options/<id>/metadata. */
const OptionMetadata = () => {
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
    const response = await updateProductOptionMetadataAction({
      data: formData,
    });

    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: productOptionQueries.all() }),
      queryClient.invalidateQueries({ queryKey: productTaxonomyQueries.all() }),
    ]);
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
      title="Edit Metadata"
      description={option.title}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={metadataFields(option.metadata ?? {})}
    />
  );
};

export default OptionMetadata;
