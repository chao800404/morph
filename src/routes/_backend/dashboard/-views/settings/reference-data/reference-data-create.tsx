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
import { createReferenceDataAction } from "./reference-data-actions";
import {
  referenceDataConfig,
  referenceDataFields,
  toReferenceDataKind,
} from "./reference-data.config";

export default function ReferenceDataCreate() {
  const { slug } = useParams({ strict: false }) as { slug?: string };
  const kind = toReferenceDataKind(slug);
  const queryClient = useQueryClient();
  const close = useRouteModalClose();
  const parentsQuery = useQuery({
    ...referenceDataQueries.list(
      normalizeReferenceDataListParams("return-reasons", { limit: 100 }),
    ),
    enabled: kind === "return-reasons",
  });
  if (!kind) return null;
  const submit = async (
    _: RouteFormState,
    data: FormData,
  ): Promise<RouteFormState> => {
    data.set("kind", kind);
    const response = await createReferenceDataAction(_, data);
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
      title={`Create ${referenceDataConfig[kind].singular}`}
      description={referenceDataConfig[kind].description}
      action={submit}
      fieldsClassName="sm:grid-cols-2"
      fields={referenceDataFields({ kind, parents })}
    />
  );
}
