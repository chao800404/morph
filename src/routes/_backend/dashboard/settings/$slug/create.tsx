import { PageSpinner } from "@/components/loading/page-spinner";
import { NotFound } from "@/components/not-found/not-found";
import { dashboardSearchSchema } from "@/lib/validations/dashboard-search";
import { getConfig } from "@/server/get-config";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useMemo } from "react";

export const Route = createFileRoute(
  "/_backend/dashboard/settings/$slug/create",
)({
  validateSearch: dashboardSearchSchema,
  component: RouteComponent,
});

function RouteComponent() {
  const { slug } = Route.useParams();
  const config = useMemo(() => getConfig().client, []);
  const create = useMemo(
    () =>
      config.collections.settings
        .flatMap((group) => group.collections)
        .find((collection) => collection.slug === slug)?.create,
    [config, slug],
  );

  if (!create) return <NotFound />;

  const CreateView = create.view;
  const PendingView = create.pendingView ?? PageSpinner;
  return (
    <Suspense fallback={<PendingView />}>
      <CreateView />
    </Suspense>
  );
}
