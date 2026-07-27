import { PageSpinner } from "@/components/loading/page-spinner";
import { NotFound } from "@/components/not-found/not-found";
import { findCollection } from "@/lib/config/navigation";
import { getConfig } from "@/server/get-config";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useMemo } from "react";

export const Route = createFileRoute("/_backend/dashboard/$slug/view")({
  loader: async ({ context, params }) => {
    const { queryClient, search } = context;
    const preview = findCollection(
      getConfig().client.collections.global,
      params.slug,
    )?.preview;
    await preview?.prefetch?.({ queryClient, params, search });
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { slug } = Route.useParams();
  const config = useMemo(() => getConfig().client, []);
  const preview = useMemo(
    () => findCollection(config.collections.global, slug)?.preview,
    [config, slug],
  );

  if (!preview) return <NotFound />;

  const PreviewView = preview.view;
  const PendingView = preview.pendingView ?? PageSpinner;
  return (
    <Suspense fallback={<PendingView />}>
      <PreviewView />
    </Suspense>
  );
}
