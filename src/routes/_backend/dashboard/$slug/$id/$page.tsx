import { RouteModalCloseProvider } from "@/components/dialog/route-form-modal";
import { NotFound } from "@/components/not-found/not-found";
import { findCollection } from "@/lib/config/navigation";
import { getConfig } from "@/server/get-config";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { Suspense, useLayoutEffect, useMemo } from "react";
import { DashboardRoutePending } from "@/routes/_backend/dashboard/-components/loading/dashboard-route-pending";

/**
 * A page hanging off a record, declared in the collection's `pages`.
 *
 * Sub-pages live in config rather than each getting a named capability: the
 * framework does not participate in what they mean, it only mounts them. That
 * keeps the whole page tree readable in one place while still being derived
 * from config, which is what lets a Morph user add pages to their own
 * collections.
 *
 * `edit` is a static segment so it still outranks this route, which is why
 * `edit` is a reserved page key.
 */
export const Route = createFileRoute("/_backend/dashboard/$slug/$id/$page")({
  loader: async ({ context, params, location }) => {
    const { queryClient, search } = context;
    const collection = findCollection(
      getConfig().client.collections.global,
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
  const location = useLocation();
  const config = useMemo(() => getConfig().client, []);

  const collection = useMemo(
    () => findCollection(config.collections.global, slug),
    [slug, config],
  );

  const subPage = collection?.pages?.[page];

  // The dashboard uses its own scroll viewport, so browser scroll restoration
  // cannot move a replacing child page to the top. Overlay pages deliberately
  // keep the underlying record's position for a natural close/back flow.
  useLayoutEffect(() => {
    if (subPage?.presentation !== "replace") return;
    const scrollToTop = () => {
      document
        .getElementById("dashboard-scroll-container")
        ?.scrollTo({ top: 0, left: 0, behavior: "instant" });
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    };
    scrollToTop();
    // Router/view-transition work may restore layout after this effect. Run
    // once more on the next frame so the final committed page owns position 0.
    const frame = window.requestAnimationFrame(scrollToTop);
    return () => window.cancelAnimationFrame(frame);
    // Search parameters belong to the current page state (sorting, filtering,
    // pagination, and so on). Resetting the viewport for those updates fights
    // the router's scroll restoration and causes a visible top-then-back jump.
    // Only a real path change represents a newly opened replacement page.
  }, [location.pathname, subPage?.presentation]);

  if (!subPage) return <NotFound />;

  const PageView = subPage.view;
  const PendingView = subPage.pendingView;
  return (
    // Same rule as `edit`: closing returns to the detail page when there is
    // one, and to the list when there is not.
    <RouteModalCloseProvider value={collection?.detail ? ".." : "../.."}>
      <Suspense fallback={<PendingView />}>
        <PageView />
      </Suspense>
    </RouteModalCloseProvider>
  );
}
