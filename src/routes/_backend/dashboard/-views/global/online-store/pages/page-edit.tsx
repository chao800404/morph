import {
  RouteFormPage,
  useRouteModalClose,
  type RouteFormState,
} from "@/components/dialog/route-form-modal";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { PAGE_DRAFT_CONFLICT } from "@/lib/storefront/page-write-errors";
import { storefrontPageQueries } from "@queries/storefront-page.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useRef } from "react";
import { toast } from "sonner";
import { updatePageAction } from "./page-actions";
import { pageFormFields } from "./config/page-form-fields";

export default function StorefrontPageEdit() {
  const { id } = useParams({ strict: false }) as { id: string };
  const client = useQueryClient();
  const close = useRouteModalClose();
  const query = useQuery(storefrontPageQueries.detail(id));
  const page = query.data?.success ? query.data.data : null;
  // The Page as last loaded. A save sends its document and draft version, so
  // after a conflict reloads it, saving again applies what the author typed
  // on top of the latest draft rather than over it.
  const latest = useRef(page);
  latest.current = page;
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
    const loaded = latest.current ?? page;
    data.set("document", JSON.stringify(loaded.document));
    data.set("expectedDraftVersion", String(loaded.version));
    const result = await updatePageAction({ data });
    if (!result.success) {
      // Changed elsewhere (another tab, Show again): the latest Page is
      // loaded and the form stays open with what was typed. Not resent on
      // its own; saving again applies it to the version just loaded.
      if ((result as { error?: string }).error === PAGE_DRAFT_CONFLICT) {
        await client.invalidateQueries({
          queryKey: storefrontPageQueries.detail(id).queryKey,
        });
      }
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
