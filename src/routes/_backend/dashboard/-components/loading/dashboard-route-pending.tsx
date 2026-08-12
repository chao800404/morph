import { RouteModalCloseProvider } from "@/components/dialog/route-modal-close";
import { findCollection } from "@/lib/config/navigation";
import { getConfig } from "@/server/get-config";
import { useRouterState } from "@tanstack/react-router";

/**
 * Selects the destination-owned pending view from the route currently being
 * requested. This component owns no visual fallback: every navigable
 * collection capability must declare its own `pendingView` in config.
 */
export const DashboardRoutePending = () => {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const segments = pathname.split("/").filter(Boolean).slice(1);
  const isSettings = segments[0] === "settings";
  const routeSegments = isSettings ? segments.slice(1) : segments;
  const [slug, second, third] = routeSegments;
  const collections = isSettings
    ? getConfig().client.collections.settings
    : getConfig().client.collections.global;
  // `/dashboard/settings` is a real navigation step before its index route
  // redirects to Store. Select that destination's skeleton immediately so the
  // outlet never becomes empty during the redirect/load hand-off.
  const collection = slug
    ? findCollection(collections, slug)
    : isSettings
      ? findCollection(collections, "store")
      : undefined;

  let PendingView = collection?.index?.pendingView;
  let closeTo = "..";

  if (second === "create") {
    PendingView = collection?.create?.pendingView;
  } else if (second === "view") {
    PendingView = collection?.preview?.pendingView;
  } else if (second && !third) {
    PendingView = isSettings && second === "edit"
      ? collection?.edit?.pendingView
      : collection?.detail?.pendingView;
  } else if (second && third === "edit") {
    PendingView = collection?.edit?.pendingView;
    closeTo = collection?.detail ? ".." : "../..";
  } else if (second && third) {
    PendingView = collection?.pages?.[third]?.pendingView;
    closeTo = collection?.detail ? ".." : "../..";
  }

  if (!PendingView) return null;

  return (
    <RouteModalCloseProvider value={closeTo}>
      <PendingView />
    </RouteModalCloseProvider>
  );
};
