import { PageSpinner } from "@/components/loading/page-spinner";
import { NotFound } from "@/components/not-found/not-found";
import { dashboardSearchSchema } from "@/lib/validations/dashboard-search";
import { findCollection } from "@/lib/config/navigation";
import { getConfig } from "@/server/get-config";
import {
  createFileRoute,
  Outlet,
  useChildMatches,
} from "@tanstack/react-router";
import { Suspense, useMemo } from "react";

export const Route = createFileRoute("/_backend/dashboard/settings/$slug")({
  validateSearch: (search) => dashboardSearchSchema.parse(search),
  beforeLoad: ({ params, search }) => ({ slug: params.slug, search }),
  loader: async ({ context, params }) => {
    const { queryClient, search } = context;
    const config = getConfig().client;

    // Discover the collection item by slug from all settings groups
    const collection = findCollection(config.collections.settings, params.slug);

    if (collection?.index?.prefetch) {
      await collection.index.prefetch({ queryClient, params, search });
    }
  },
  component: RouteComponent,
});

const DETAIL_ROUTE_ID = "/_backend/dashboard/settings/$slug/$id";

function RouteComponent() {
  const { slug } = Route.useParams();
  const config = useMemo(() => getConfig().client, []);
  const onDetailRoute = useChildMatches({
    select: (matches) =>
      matches.some((match) => match.routeId === DETAIL_ROUTE_ID),
  });

  // Pick the route view based on the slug from the config.
  const collection = useMemo(() => {
    return findCollection(config.collections.settings, slug);
  }, [slug, config]);

  // Record details are full destinations, while create and collection-level
  // edit routes are overlays that intentionally keep the index mounted.
  if (onDetailRoute && collection?.detail) {
    return <Outlet />;
  }

  const ViewComponent = collection?.index?.view;
  if (!ViewComponent) return <NotFound />;

  const PendingView = collection.index?.pendingView ?? PageSpinner;
  return (
    <>
      <Suspense fallback={<PendingView />}>
        <ViewComponent />
      </Suspense>
      <Outlet />
    </>
  );
}
