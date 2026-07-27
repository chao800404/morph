import { PageSpinner } from "@/components/loading/page-spinner";
import { NotFound } from "@/components/not-found/not-found";
import { getConfig } from "@/server/get-config";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useMemo } from "react";

export const Route = createFileRoute(
  "/_backend/dashboard/settings/$slug/edit",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { slug } = Route.useParams();
  const config = useMemo(() => getConfig().client, []);
  const edit = useMemo(
    () =>
      config.collections.settings
        .flatMap((group) => group.collections)
        .find((collection) => collection.slug === slug)?.edit,
    [config, slug],
  );

  if (!edit) return <NotFound />;

  const EditView = edit.view;
  const PendingView = edit.pendingView ?? PageSpinner;
  return (
    <Suspense fallback={<PendingView />}>
      <EditView />
    </Suspense>
  );
}
