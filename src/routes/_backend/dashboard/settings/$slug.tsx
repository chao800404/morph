import { PageSpinner } from "@/components/loading/page-spinner";
import { NotFound } from "@/components/not-found/not-found";
import { dashboardSearchSchema } from "@/lib/validations/dashboard-search";
import { getConfig } from "@/server/get-config";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Suspense, useMemo } from "react";

export const Route = createFileRoute("/_backend/dashboard/settings/$slug")({
  validateSearch: (search) => dashboardSearchSchema.parse(search),
  beforeLoad: ({ params, search }) => ({ slug: params.slug, search }),
  loader: async ({ context, params }) => {
    const { queryClient, search } = context;
    const config = getConfig().client;

    // Discover the collection item by slug from all settings groups
    const settingsCollections = config.collections.settings.flatMap(
      (group) => group.collections,
    );
    const collection = settingsCollections.find((c) => c.slug === params.slug);

    if (collection?.index?.prefetch) {
      await collection.index.prefetch({ queryClient, params, search });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { slug } = Route.useParams();
  const config = useMemo(() => getConfig().client, []);

  // Pick the route view based on the slug from the config.
  const collection = useMemo(() => {
    const settingsCollections = config.collections.settings.flatMap(
      (group) => group.collections,
    );
    return settingsCollections.find((c) => c.slug === slug);
  }, [slug, config]);

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
