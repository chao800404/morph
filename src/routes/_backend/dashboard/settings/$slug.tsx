import { getConfig } from "@/cms.config";
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

  if (!ViewComponent) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">
            View Not Found
          </h2>
          <p className="text-sm text-muted-foreground">
            The settings page{" "}
            <code className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold">
              "{slug}"
            </code>{" "}
            could not be found.
          </p>
        </div>
      </div>
    );
  }

  return <ViewComponent />;
}
