import { RouteModalCloseProvider } from "@/components/dialog/route-form-modal";
import { RouteSurfacePending } from "@/components/dialog/route-surface-pending";
import { NotFound } from "@/components/not-found/not-found";
import { findCollection } from "@/lib/config/navigation";
import { getConfig } from "@/server/get-config";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useMemo } from "react";

export const Route = createFileRoute("/_backend/dashboard/settings/$slug/edit")(
  {
    loader: async ({ context, params }) => {
      const { queryClient, search } = context;
      const collection = findCollection(
        getConfig().client.collections.settings,
        params.slug,
      );
      await collection?.edit?.prefetch?.({ queryClient, params, search });
    },
    component: RouteComponent,
  },
);

function RouteComponent() {
  const { slug } = Route.useParams();
  const config = useMemo(() => getConfig().client, []);
  const edit = useMemo(
    () => findCollection(config.collections.settings, slug)?.edit,
    [config, slug],
  );

  if (!edit) return <NotFound />;

  const EditView = edit.view;
  const PendingView = edit.pendingView ?? RouteSurfacePending;
  return (
    <RouteModalCloseProvider value="..">
      <Suspense fallback={<PendingView />}>
        <EditView />
      </Suspense>
    </RouteModalCloseProvider>
  );
}
