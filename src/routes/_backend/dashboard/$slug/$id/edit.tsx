import { PageSpinner } from "@/components/loading/page-spinner";
import { RouteModalCloseProvider } from "@/components/dialog/route-form-modal";
import { NotFound } from "@/components/not-found/not-found";
import { findCollection } from "@/lib/config/navigation";
import { getConfig } from "@/server/get-config";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useMemo } from "react";

/**
 * The edit page for any collection that declares `edit`.
 *
 * Editing is a route for the same reason creating is: the surface is linkable,
 * survives a refresh, and loads its record from the id in the URL instead of
 * from whatever the list had in memory.
 *
 * Closing goes back to the detail page when there is one, and to the list when
 * there is not — otherwise a collection with no detail page would close onto an
 * empty URL.
 */
export const Route = createFileRoute("/_backend/dashboard/$slug/$id/edit")({
  loader: async ({ context, params }) => {
    const { queryClient, search } = context;
    const collection = findCollection(
      getConfig().client.collections.global,
      params.slug,
    );
    await collection?.edit?.prefetch?.({ queryClient, params, search });
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { slug } = Route.useParams();
  const config = useMemo(() => getConfig().client, []);

  const collection = useMemo(
    () => findCollection(config.collections.global, slug),
    [slug, config],
  );

  const edit = collection?.edit;
  if (!edit) return <NotFound />;

  const EditView = edit.view;
  const PendingView = edit.pendingView ?? PageSpinner;
  return (
    <RouteModalCloseProvider value={collection?.detail ? ".." : "../.."}>
      <Suspense fallback={<PendingView />}>
        <EditView />
      </Suspense>
    </RouteModalCloseProvider>
  );
}
