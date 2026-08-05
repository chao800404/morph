import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { metadataFields } from "@/components/form/metadata-fields";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { collectionQueries } from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateCollectionMetadataAction } from "../product-actions";

/** Metadata editor for a collection, at /dashboard/collections/<id>/metadata. */
const CollectionMetadata = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const queryClient = useQueryClient();
  const close = useRouteModalClose();
  const { data: result, isPending } = useQuery(collectionQueries.detail(id));

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    formData.set("id", id);
    const response = await updateCollectionMetadataAction({ data: formData });

    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }

    await queryClient.invalidateQueries({ queryKey: collectionQueries.all() });
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };

  if (isPending) {
    return <RouteSurfacePending />;
  }

  const collection = result?.success ? result.data : null;
  if (!collection) {
    return (
      <RouteSurfaceMessage>
          {result?.message ?? "Collection not found"}
      </RouteSurfaceMessage>
    );
  }

  return (
    <RouteFormPage
      title="Edit Metadata"
      description={collection.title}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={metadataFields(collection.metadata ?? {})}
    />
  );
};

export default CollectionMetadata;
