import { RouteModalCloseProvider } from "@/components/dialog/route-form-modal";
import { NotFound } from "@/components/not-found/not-found";
import { findCollection } from "@/lib/config/navigation";
import { getConfig } from "@/server/get-config";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useMemo } from "react";
import { DashboardRoutePending } from "@/routes/_backend/dashboard/-components/loading/dashboard-route-pending";

export const Route = createFileRoute(
  "/_backend/dashboard/settings/$slug/$id/edit",
)({
  loader: async ({ context, params }) => {
    const { queryClient, search } = context;
    const collection = findCollection(
      getConfig().client.collections.settings,
      params.slug,
    );
    await collection?.edit?.prefetch?.({ queryClient, params, search });
  },
  pendingComponent: DashboardRoutePending,
  pendingMs: 0,
  pendingMinMs: 250,
  component: RouteComponent,
});

function RouteComponent() {
  const { slug } = Route.useParams();
  const config = useMemo(() => getConfig().client, []);
  const collection = useMemo(
    () => findCollection(config.collections.settings, slug),
    [config, slug],
  );
  const edit = collection?.edit;
  if (!edit) return <NotFound />;

  const EditView = edit.view;
  const PendingView = edit.pendingView;
  return (
    <RouteModalCloseProvider value={collection?.detail ? ".." : "../.."}>
      <Suspense fallback={<PendingView />}>
        <EditView />
      </Suspense>
    </RouteModalCloseProvider>
  );
}
