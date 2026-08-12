import { PageSpinner } from "@/components/loading/page-spinner";
import { NotFound } from "@/components/not-found/not-found";
import { findCollection } from "@/lib/config/navigation";
import { getConfig } from "@/server/get-config";
import {
  createFileRoute,
  Outlet,
  useChildMatches,
} from "@tanstack/react-router";
import { Suspense, useMemo } from "react";

export const Route = createFileRoute("/_backend/dashboard/settings/$slug/$id")({
  loader: async ({ context, params }) => {
    const { queryClient, search } = context;
    const collection = findCollection(
      getConfig().client.collections.settings,
      params.slug,
    );
    const loadContext = { queryClient, params, search };
    await collection?.detail?.prefetch?.(loadContext);
    const breadcrumb = await collection?.detail?.breadcrumb?.(loadContext);
    return {
      breadcrumb: breadcrumb ?? null,
      breadcrumbHref: `/dashboard/settings/${params.slug}/${params.id}`,
    };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { slug } = Route.useParams();
  const config = useMemo(() => getConfig().client, []);
  const hasChild = useChildMatches({ select: (matches) => matches.length > 0 });
  const collection = useMemo(
    () => findCollection(config.collections.settings, slug),
    [config, slug],
  );
  const detail = collection?.detail;
  if (!detail) return hasChild ? <Outlet /> : <NotFound />;

  const DetailView = detail.view;
  const PendingView = detail.pendingView ?? PageSpinner;
  return (
    <>
      <Suspense fallback={<PendingView />}>
        <DetailView />
      </Suspense>
      <Outlet />
    </>
  );
}
