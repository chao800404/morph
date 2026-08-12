import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { metadataFields } from "@/components/form/metadata-fields";
import type { Metadata } from "@/db/json";
import type { AssetActionResult } from "@/lib/asset/action-result";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";

/** Shared route-backed metadata editor for every collection namespace. */
export function MetadataEditorPage({
  id,
  description,
  metadata,
  isPending,
  errorMessage,
  queryKey,
  action,
}: {
  id: string;
  description?: string;
  metadata?: Metadata;
  isPending: boolean;
  errorMessage?: string;
  queryKey: QueryKey;
  action: (args: { data: FormData }) => Promise<AssetActionResult>;
}) {
  const queryClient = useQueryClient();
  const close = useRouteModalClose();

  if (isPending) return <RouteSurfacePending />;
  if (!description || metadata === undefined) {
    return (
      <RouteSurfaceMessage>
        {errorMessage ?? "Record not found"}
      </RouteSurfaceMessage>
    );
  }

  const submit = async (
    _state: RouteFormState,
    formData: FormData,
  ): Promise<RouteFormState> => {
    formData.set("id", id);
    const response = await action({ data: formData });
    if (!response.success) {
      toast.error(response.message, { position: "top-center" });
      return response;
    }
    await queryClient.invalidateQueries({ queryKey });
    toast.success(response.message, { position: "top-center" });
    close();
    return response;
  };

  return (
    <RouteFormPage
      title="Edit Metadata"
      description={description}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={metadataFields(metadata)}
    />
  );
}
