import { PageSpinner } from "@/components/loading/page-spinner";
import { NotFound } from "@/components/not-found/not-found";
import { getConfig } from "@/server/get-config";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useMemo } from "react";

export const Route = createFileRoute("/_backend/dashboard/settings/$slug")({
  beforeLoad: ({ params }) => {
    return { slug: params.slug };
  },
  loader: async ({ context, params }) => {
    const { queryClient } = context;
    const config = getConfig().client;

    // Discover the collection item by slug from all settings groups
    const settingsCollections = config.collections.settings.flatMap(
      (group) => group.collections,
    );
    const collection = settingsCollections.find((c) => c.slug === params.slug);

    if (collection?.loadData) {
      await collection.loadData({ queryClient, params, search: {} });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { slug } = Route.useParams();
  const config = useMemo(() => getConfig().client, []);

  // Pick the component based on the slug from the config
  const collection = useMemo(() => {
    const settingsCollections = config.collections.settings.flatMap(
      (group) => group.collections,
    );
    return settingsCollections.find((c) => c.slug === slug);
  }, [slug, config]);

  const ViewComponent = collection?.component;
  if (!ViewComponent) return <NotFound />;

  const Loader = collection.loader ?? PageSpinner;
  return (
    <Suspense fallback={<Loader />}>
      <ViewComponent />
    </Suspense>
  );
}
