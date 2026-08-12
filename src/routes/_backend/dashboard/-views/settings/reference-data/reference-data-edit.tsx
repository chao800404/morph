import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  referenceDataQueries,
  normalizeReferenceDataListParams,
} from "@queries/reference-data.queries";
import { updateReferenceDataAction } from "./reference-data-actions";
import {
  referenceDataConfig,
  referenceDataFields,
  toReferenceDataKind,
} from "./reference-data.config";

export default function ReferenceDataEdit() {
  const { slug, id } = useParams({ strict: false }) as {
    slug?: string;
    id: string;
  };
  const kind = toReferenceDataKind(slug);
  const queryClient = useQueryClient();
  const close = useRouteModalClose();
  const detail = useQuery({
    ...referenceDataQueries.detail(kind ?? "product-types", id),
    enabled: Boolean(kind),
  });
  const parentsQuery = useQuery({
    ...referenceDataQueries.list(
      normalizeReferenceDataListParams("return-reasons", { limit: 100 }),
    ),
    enabled: kind === "return-reasons",
  });
  if (!kind) return null;
  if (detail.isPending) return <RouteSurfacePending />;
  const item = detail.data?.success ? detail.data.data : null;
  if (!item)
    return (
      <RouteSurfaceMessage>
        {detail.data?.message ?? "Record not found"}
      </RouteSurfaceMessage>
    );
  const submit = async (
    _: RouteFormState,
    data: FormData,
  ): Promise<RouteFormState> => {
    data.set("kind", kind);
    data.set("id", id);
    const response = await updateReferenceDataAction(data);
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
  const parents = parentsQuery.data?.success
    ? parentsQuery.data.data.items
    : [];
  return (
    <RouteFormPage
      title={`Edit ${referenceDataConfig[kind].singular}`}
      description={item.name}
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fieldsClassName="sm:grid-cols-2"
      fields={referenceDataFields({ kind, item, parents })}
    />
  );
}
