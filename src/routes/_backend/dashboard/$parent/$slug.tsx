import { NotFound } from "@/components/not-found/not-found";
import { getConfig } from "@/server/get-config";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useMemo } from "react";
import { getAllCollections } from "@/lib/config/navigation";
import { dashboardSearchSchema } from "@/lib/validations/dashboard-search";

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

  const ViewComponent = useMemo(() => {
    const globalCollections = getAllCollections(config.collections.global);
    const collection = globalCollections.find((c) => c.slug === slug);
    return collection?.component;
  }, [slug, config]);

  if (!ViewComponent) return <NotFound />;
  return (
    <Suspense fallback={null}>
      <ViewComponent />
    </Suspense>
  );
}
