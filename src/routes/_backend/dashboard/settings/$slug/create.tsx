import { NotFound } from "@/components/not-found/not-found";
import { findCollection } from "@/lib/config/navigation";
import { dashboardSearchSchema } from "@/lib/validations/dashboard-search";
import { getConfig } from "@/server/get-config";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useMemo } from "react";
import { DashboardRoutePending } from "@/routes/_backend/dashboard/-components/loading/dashboard-route-pending";

export const Route = createFileRoute(
  "/_backend/dashboard/settings/$slug/create",
)({
  validateSearch: dashboardSearchSchema,
  loader: async ({ context, params }) => {
    const { queryClient, search } = context;
    const collection = findCollection(
      getConfig().client.collections.settings,
      params.slug,
    );
    await collection?.create?.prefetch?.({ queryClient, params, search });
  },
  pendingComponent: DashboardRoutePending,
  pendingMs: 0,
  pendingMinMs: 250,
  component: RouteComponent,
});

function RouteComponent() {
  const { slug } = Route.useParams();
  const config = useMemo(() => getConfig().client, []);
  const create = useMemo(
    () => findCollection(config.collections.settings, slug)?.create,
    [config, slug],
  );

  if (!create) return <NotFound />;

  const CreateView = create.view;
  const PendingView = create.pendingView;
  return (
    <Suspense fallback={<PendingView />}>
      <CreateView />
    </Suspense>
  );
}
