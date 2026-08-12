import { RouteModalCloseProvider } from "@/components/dialog/route-form-modal";
import { NotFound } from "@/components/not-found/not-found";
import { findCollection } from "@/lib/config/navigation";
import { getConfig } from "@/server/get-config";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useMemo } from "react";
import { DashboardRoutePending } from "@/routes/_backend/dashboard/-components/loading/dashboard-route-pending";

export const Route = createFileRoute(
  "/_backend/dashboard/settings/$slug/$id/$page",
)({
  loader: async ({ context, params, location }) => {
    const { queryClient, search } = context;
    const collection = findCollection(
      getConfig().client.collections.settings,
      params.slug,
    );
    const loadContext = { queryClient, params, search };
    const page = collection?.pages?.[params.page];
    await page?.prefetch?.(loadContext);
    const breadcrumb = await page?.breadcrumb?.(loadContext);
    return {
      breadcrumb: breadcrumb ?? null,
      breadcrumbHref: location.href,
    };
  },
  pendingComponent: DashboardRoutePending,
  pendingMs: 0,
  pendingMinMs: 250,
  component: RouteComponent,
});

function RouteComponent() {
  const { slug, page } = Route.useParams();
  const config = useMemo(() => getConfig().client, []);
  const collection = useMemo(
    () => findCollection(config.collections.settings, slug),
    [config, slug],
  );
  const subPage = collection?.pages?.[page];

  if (!subPage) return <NotFound />;

  const PageView = subPage.view;
  const PendingView = subPage.pendingView;
  return (
    <RouteModalCloseProvider value={collection?.detail ? ".." : "../.."}>
      <Suspense fallback={<PendingView />}>
        <PageView />
      </Suspense>
    </RouteModalCloseProvider>
  );
}
