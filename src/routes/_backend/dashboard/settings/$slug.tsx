import { getConfig } from "@/cms.config";
import { NotFound } from "@/components/not-found/not-found";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

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
      await collection.loadData({ queryClient, params });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { slug } = Route.useParams();
  const config = useMemo(() => getConfig().client, []);

  // Pick the component based on the slug from the config
  const ViewComponent = useMemo(() => {
    const settingsCollections = config.collections.settings.flatMap(
      (group) => group.collections,
    );
    const collection = settingsCollections.find((c) => c.slug === slug);
    return collection?.component;
  }, [slug, config]);

  if (!ViewComponent) return <NotFound />;
  return <ViewComponent />;
}
