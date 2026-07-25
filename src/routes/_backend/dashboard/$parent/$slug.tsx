import { PageSpinner } from "@/components/loading/page-spinner";
import { NotFound } from "@/components/not-found/not-found";
import { getAllCollections } from "@/lib/config/navigation";
import { dashboardSearchSchema } from "@/lib/validations/dashboard-search";
import { getConfig } from "@/server/get-config";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useMemo } from "react";

export const Route = createFileRoute("/_backend/dashboard/$parent/$slug")({
  validateSearch: (search) => dashboardSearchSchema.parse(search),
  beforeLoad: async (ctx) => {
    const { search } = ctx;
    return { search };
  },
  loader: async ({ context, params }) => {
    const { queryClient, search } = context;
    const config = getConfig().client;

    const globalCollections = getAllCollections(config.collections.global);
    const collection = globalCollections.find((c) => c.slug === params.slug);

    await collection?.loadData?.({ queryClient, params, search });
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { slug } = Route.useParams();
  const config = useMemo(() => getConfig().client, []);

  const collection = useMemo(() => {
    const globalCollections = getAllCollections(config.collections.global);
    return globalCollections.find((c) => c.slug === slug);
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
