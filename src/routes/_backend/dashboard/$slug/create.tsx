import { PageSpinner } from "@/components/loading/page-spinner";
import { NotFound } from "@/components/not-found/not-found";
import { findCollection } from "@/lib/config/navigation";
import { getConfig } from "@/server/get-config";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useMemo } from "react";

/**
 * The create page for any collection that declares a `create` view.
 *
 * One route serves every collection, so adding a create page is a config
 * change, not a new file. It is a child of `$slug`, which keeps the list
 * mounted underneath — the create surface renders over it, and closing it is a
 * navigation back to a list that never unmounted.
 *
 * `create` is a static segment, so it outranks `$id`; that also makes
 * `create` a reserved slug, which `assertCollectionsAreAddressable` enforces.
 */
export const Route = createFileRoute("/_backend/dashboard/$slug/create")({
  component: RouteComponent,
});

function RouteComponent() {
  const { slug } = Route.useParams();
  const config = useMemo(() => getConfig().client, []);

  const create = useMemo(
    () => findCollection(config.collections.global, slug)?.create,
    [slug, config],
  );

  if (!create) return <NotFound />;

  const CreateView = create.view;
  const PendingView = create.pendingView ?? PageSpinner;
  return (
    <Suspense fallback={<PendingView />}>
      <CreateView />
    </Suspense>
  );
}
