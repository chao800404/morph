import { metadataFields } from "@/components/form/metadata-fields";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { referenceDataQueries } from "@queries/reference-data.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updateReferenceDataMetadataAction } from "./reference-data-actions";
import { toReferenceDataKind } from "./reference-data.config";

export default function ReferenceDataMetadata() {
  const { slug, id } = useParams({ strict: false }) as {
    slug?: string;
    id: string;
  };
  const kind = toReferenceDataKind(slug);
  const queryClient = useQueryClient();
  const close = useRouteModalClose();
  const query = useQuery({
    ...referenceDataQueries.detail(kind ?? "product-types", id),
    enabled: Boolean(kind),
  });
  if (!kind) return null;
  if (query.isPending) return <RouteSurfacePending />;
  const item = query.data?.success ? query.data.data : null;
  if (!item)
    return (
      <RouteSurfaceMessage>
        {query.data?.message ?? "Record not found"}
      </RouteSurfaceMessage>
    );
  const submit = async (
    _: RouteFormState,
    data: FormData,
  ): Promise<RouteFormState> => {
    data.set("kind", kind);
    data.set("id", id);
    const response = await updateReferenceDataMetadataAction({ data });
    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }
    await queryClient.invalidateQueries({
      queryKey: referenceDataQueries.all(kind),
    });
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };
  return (
    <RouteFormPage
      title="Edit Metadata"
      description={item.name}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={metadataFields(item.metadata)}
    />
  );
}
