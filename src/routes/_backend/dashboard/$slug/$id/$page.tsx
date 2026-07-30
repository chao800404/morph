import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { RouteModalCloseProvider } from "@/components/dialog/route-form-modal";
import { NotFound } from "@/components/not-found/not-found";
import { findCollection } from "@/lib/config/navigation";
import { getConfig } from "@/server/get-config";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useMemo } from "react";

/**
 * A page hanging off a record, declared in the collection's `pages`.
 *
 * Sub-pages live in config rather than each getting a named capability: the
 * framework does not participate in what they mean, it only mounts them. That
 * keeps the whole page tree readable in one place while still being derived
 * from config, which is what lets a Morph user add pages to their own
 * collections.
 *
 * `edit` is a static segment so it still outranks this route, which is why
 * `edit` is a reserved page key.
 */
export const Route = createFileRoute("/_backend/dashboard/$slug/$id/$page")({
  loader: async ({ context, params }) => {
    const { queryClient, search } = context;
    const collection = findCollection(
      getConfig().client.collections.global,
      params.slug,
    );
    await collection?.pages?.[params.page]?.prefetch?.({
      queryClient,
      params,
      search,
    });
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { slug, page } = Route.useParams();
  const config = useMemo(() => getConfig().client, []);

  const collection = useMemo(
    () => findCollection(config.collections.global, slug),
    [slug, config],
  );

  const subPage = collection?.pages?.[page];
  if (!subPage) return <NotFound />;

  const PageView = subPage.view;
  const PendingView = subPage.pendingView ?? RouteSurfacePending;
  return (
    // Same rule as `edit`: closing returns to the detail page when there is
    // one, and to the list when there is not.
    <RouteModalCloseProvider value={collection?.detail ? ".." : "../.."}>
      <Suspense fallback={<PendingView />}>
        <PageView />
      </Suspense>
    </RouteModalCloseProvider>
  );
}
