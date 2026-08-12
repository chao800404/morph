import { RouteModalCloseProvider } from "@/components/dialog/route-form-modal";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { NotFound } from "@/components/not-found/not-found";
import { findCollection } from "@/lib/config/navigation";
import { getConfig } from "@/server/get-config";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useMemo } from "react";

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
  const PendingView = edit.pendingView ?? RouteSurfacePending;
  return (
    <RouteModalCloseProvider value={collection?.detail ? ".." : "../.."}>
      <Suspense fallback={<PendingView />}>
        <EditView />
      </Suspense>
    </RouteModalCloseProvider>
  );
}
