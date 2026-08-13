import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { storefrontPageQueries } from "@queries/storefront-page.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { updatePageAction } from "./page-actions";
import { pageFormFields } from "./config/page-form-fields";

export default function StorefrontPageEdit() {
  const { id } = useParams({ strict: false }) as { id: string };
  const client = useQueryClient();
  const close = useRouteModalClose();
  const query = useQuery(storefrontPageQueries.detail(id));
  const page = query.data?.success ? query.data.data : null;
  if (query.isPending) return <RouteSurfacePending />;
  if (!page)
    return (
      <RouteSurfaceMessage>
        {query.data?.message ?? "Page not found"}
      </RouteSurfaceMessage>
    );
  const submit = async (
    _state: RouteFormState,
    data: FormData,
  ): Promise<RouteFormState> => {
    const result = await updatePageAction({ data });
    if (!result.success) {
      toast.error(result.message, { position: "top-center" });
      return result;
    }
    await client.invalidateQueries({ queryKey: storefrontPageQueries.all() });
    toast.success(result.message, { position: "top-center" });
    close();
    return result;
  };
  return (
    <RouteFormPage
      title="Edit page"
      description="Saving creates a new immutable revision. Publishing changes the storefront's active revision."
      action={submit}
      submitLabel="Save"
      loadingLabel="Saving..."
      fields={pageFormFields({
        id: page.id,
        title: page.title,
        handle: page.handle,
        publish: false,
        document: page.document,
      })}
    />
  );
}
