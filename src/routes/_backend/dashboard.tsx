import { DashboardHeader } from "@/components/header/dashboard-header";
import { AppSidebar } from "@/components/nav/app-sidebar";
import { RegisterPathnameHistory } from "@/components/pathname-history/pathname-history";
import { IdleTimerProvider } from "@/components/provider/idle-timer-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { findBreadcrumbsFromCollections } from "@/lib/config/navigation";
import { usePageBreadcrumbStore } from "./dashboard/-components/breadcrumb/use-page-breadcrumb";
import { cn } from "@/lib/utils";
import { getSession } from "@/server/auth/getSession";
import { NotFound } from "@/components/not-found/not-found";
import { getConfig } from "@/server/get-config";
import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const EditDialog = lazy(() =>
  import("./dashboard/-views/features/global-edit/edit-dialog").then((m) => ({
    default: m.EditDialog,
  })),
);
const InfoAlert = lazy(() =>
  import("./dashboard/-views/features/global-info/info-alert").then((m) => ({
    default: m.InfoAlert,
  })),
);
const AssetMoveDialog = lazy(() =>
  import("./dashboard/-views/features/asset/move/asset-move-dialog").then(
    (m) => ({ default: m.AssetMoveDialog }),
  ),
);
const AssetPostProcessDialog = lazy(() =>
  import("./dashboard/-views/features/asset/post-process/asset-post-process-dialog").then(
    (m) => ({ default: m.AssetPostProcessDialog }),
  ),
);
export const Route = createFileRoute("/_backend/dashboard")({
  beforeLoad: async () => {
    const session = await getSession();

    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    return { session };
  },
  component: RouteComponent,
  notFoundComponent: () => <NotFound />,
});

function RouteComponent() {
  const { publicURL, session } = Route.useRouteContext();
  // Read from the router rather than threading a snapshot through beforeLoad:
  // this stays reactive and does not rely on route context inference.
  const location = useLocation();
  const config = getConfig().client;
  const isSettings = location.pathname.startsWith("/dashboard/settings");
  const rawSideData = isSettings
    ? config.collections.settings
    : config.collections.global;

  const sideData = rawSideData.map((group) => ({
    title: group.title,
    items: group.collections.map((item) => ({
      title: item.title,
      url: `/dashboard${group.slug === "/" ? "" : `/${group.slug}`}/${item.slug}`,
      icon: item.icon,
      // Nesting is a sidebar affordance only; a nested collection has its own
      // top-level URL, not one under its parent.
      items: item.items?.map((sub) => ({
        title: sub.title,
        url: `/dashboard${group.slug === "/" ? "" : `/${group.slug}`}/${sub.slug}`,
      })),
    })),
  }));

  const slugs = location.pathname.split("/").filter(Boolean).slice(1);
  const allCollections = [
    ...config.collections.global,
    ...config.collections.settings,
  ];

  const breadcrumbs = findBreadcrumbsFromCollections(allCollections, slugs);
  // A detail view names the record it loaded; the URL cannot.
  const trailingCrumb = usePageBreadcrumbStore((state) => state.label);
  const items = trailingCrumb
    ? [...breadcrumbs, { name: trailingCrumb, href: location.pathname }]
    : breadcrumbs;

  return (
    <>
      <IdleTimerProvider
        publicURL={publicURL}
        enabled={config.auth?.autoLogout?.enabled ?? true}
        timeout={config.auth?.autoLogout?.timeout ?? 30}
        promptBeforeIdle={config.auth?.autoLogout?.promptBeforeIdle ?? 25}
      >
        <RegisterPathnameHistory />
        <SidebarProvider>
          <AppSidebar
            sideData={sideData}
            showSettings={!isSettings}
            appName={config.appName}
            publicURL={publicURL}
            user={{
              name: session.user.name,
              email: session.user.email,
              avatar: session.user.image,
            }}
          />
          <SidebarInset>
            <DashboardHeader items={items} />
            <div
              id="dashboard-content"
              className={cn(
                "h-[calc(100svh-56px)] mt-14 overflow-hidden",
                "max-lg:h-full max-lg:max-h-full max-lg:overflow-y-visible max-lg:pb-6",
              )}
            >
              <Suspense fallback={null}>
                <EditDialog />
                <InfoAlert />
                <AssetMoveDialog />
                <AssetPostProcessDialog />
              </Suspense>

              {/* <AssetsDialogs /> */}
              {/*
                Keep the outlet mounted across navigations. Swapping it for a
                spinner while the router is pending remounts the whole view on
                every search-param change, so sorting or paging made the list
                card disappear and come back. Navigation feedback already comes
                from <TopLoader /> in _backend.tsx, and each dynamic route
                Suspends on its own lazy component for a genuine first load.
              */}
              <div className="h-full min-h-0 p-4 max-lg:h-auto">
                <Outlet />
              </div>
              <Toaster />
            </div>
          </SidebarInset>
        </SidebarProvider>
      </IdleTimerProvider>
    </>
  );
}
