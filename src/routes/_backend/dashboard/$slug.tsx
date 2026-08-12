import { DashboardRoutePending } from "@/routes/_backend/dashboard/-components/loading/dashboard-route-pending";
import { NotFound } from "@/components/not-found/not-found";
import { findCollection } from "@/lib/config/navigation";
import { dashboardSearchSchema } from "@/lib/validations/dashboard-search";
import { getConfig } from "@/server/get-config";
import {
  createFileRoute,
  Outlet,
  useChildMatches,
} from "@tanstack/react-router";
import { Suspense, useMemo } from "react";

export const Route = createFileRoute("/_backend/dashboard/$slug")({
  validateSearch: (search) => dashboardSearchSchema.parse(search),
  beforeLoad: async (ctx) => {
    const { search } = ctx;
    return { search };
  },
  loader: async ({ context, params }) => {
    const { queryClient, search } = context;
    const config = getConfig().client;

    const collection = findCollection(config.collections.global, params.slug);

    await collection?.index?.prefetch?.({ queryClient, params, search });
  },
  pendingComponent: DashboardRoutePending,
  pendingMs: 0,
  pendingMinMs: 250,
  component: RouteComponent,
});

/**
 * Child destinations that replace the collection index.
 *
 * `/create` and `/<id>/edit` are overlays: the page behind stays mounted so
 * closing is a navigation back with no refetch. Detail and preview pages are
 * destinations of their own — rendering the index underneath would mount two
 * pages and fire both queries — so the index steps aside for them.
 */
const DETAIL_ROUTE_ID = "/_backend/dashboard/$slug/$id";
const PREVIEW_ROUTE_ID = "/_backend/dashboard/$slug/view";

function RouteComponent() {
  const { slug } = Route.useParams();
  const config = useMemo(() => getConfig().client, []);
  // Two selects returning booleans: a derived array would be a new reference
  // on every render and defeat the equality check.
  const onDetailRoute = useChildMatches({
    select: (matches) =>
      matches.some((match) => match.routeId === DETAIL_ROUTE_ID),
  });
  const onPreviewRoute = useChildMatches({
    select: (matches) =>
      matches.some((match) => match.routeId === PREVIEW_ROUTE_ID),
  });

  // Pick the route view based on the slug from the config.
  const collection = useMemo(
    () => findCollection(config.collections.global, slug),
    [slug, config],
  );

  // `$id` is only a destination when the collection has a detail view. Assets
  // declares `edit` without `detail`, so there `$id` is a bare layout carrying
  // the id for its `/edit` child — and the explorer must stay mounted behind
  // that overlay, or closing it would remount the list and lose its scroll,
  // collapse and selection state.
  if (onPreviewRoute || (onDetailRoute && collection?.detail)) {
    return <Outlet />;
  }

  const index = collection?.index;
  if (!index) return <NotFound />;
  const ViewComponent = index.view;

  // A view whose in-card loading state is a skeleton supplies a matching
  // fallback, so the chunk wait and the data wait look like one state.
  const PendingView = index.pendingView;
  return (
    <>
      <Suspense fallback={<PendingView />}>
        <ViewComponent />
      </Suspense>
      <Outlet />
    </>
  );
}
