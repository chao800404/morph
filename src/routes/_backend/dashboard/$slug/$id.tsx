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

/**
 * The detail page for any collection that declares `detail`.
 *
 * `create` is a static segment so it still outranks this one; every other second
 * segment is treated as a record id. Collection URLs are flat precisely so that
 * this route can exist — a collection addressed at `/dashboard/products/options`
 * would make `/dashboard/products/<id>` ambiguous.
 *
 * The id is read by the page from `useParams`, not passed as a prop, so a
 * detail component can be rendered by anything that supplies the route.
 *
 * A collection may declare `edit` without `detail`. Then this route renders
 * nothing of its own and exists only to carry the id for its `/edit` child.
 */
export const Route = createFileRoute("/_backend/dashboard/$slug/$id")({
  loader: async ({ context, params }) => {
    const { queryClient, search } = context;
    const collection = findCollection(
      getConfig().client.collections.global,
      params.slug,
    );
    await collection?.detail?.prefetch?.({ queryClient, params, search });
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { slug } = Route.useParams();
  const config = useMemo(() => getConfig().client, []);
  const hasChild = useChildMatches({ select: (matches) => matches.length > 0 });

  const detail = useMemo(
    () => findCollection(config.collections.global, slug)?.detail,
    [slug, config],
  );

  // No detail page and nothing below it means this URL addresses nothing.
  if (!detail) return hasChild ? <Outlet /> : <NotFound />;

  const DetailView = detail.view;
  const PendingView = detail.pendingView ?? PageSpinner;
  return (
    <>
      <Suspense fallback={<PendingView />}>
        <DetailView />
      </Suspense>
      {/* `/edit` renders over the detail page, which stays mounted. */}
      <Outlet />
    </>
  );
}
