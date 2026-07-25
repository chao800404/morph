import { PageSpinner } from "@/components/loading/page-spinner";
import { NotFound } from "@/components/not-found/not-found";
import { getAllCollections } from "@/lib/config/navigation";
import { dashboardSearchSchema } from "@/lib/validations/dashboard-search";
import { getConfig } from "@/server/get-config";
import { createFileRoute } from "@tanstack/react-router";
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

    // Discover the collection item by slug from all global groups (including nested items)
    const globalCollections = getAllCollections(config.collections.global);
    const collection = globalCollections.find((c) => c.slug === params.slug);

    await collection?.loadData?.({ queryClient, params, search });
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { slug } = Route.useParams();
  const config = useMemo(() => getConfig().client, []);

  // Pick the component based on the slug from the config
  const collection = useMemo(() => {
    const collections = getAllCollections(config.collections.global);
    return collections.find((c) => c.slug === slug);
  }, [slug, config]);

  const ViewComponent = collection?.component;
  if (!ViewComponent) return <NotFound />;

  // A view whose in-card loading state is a skeleton supplies a matching
  // fallback, so the chunk wait and the data wait look like one state.
  const Loader = collection.loader ?? PageSpinner;
  return (
    <Suspense fallback={<Loader />}>
      <ViewComponent />
    </Suspense>
  );
}
