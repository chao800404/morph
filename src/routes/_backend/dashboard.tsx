import { DashboardHeader } from "@/components/header/dashboard-header";
import { AppSidebar } from "@/components/nav/app-sidebar";
import { RegisterPathnameHistory } from "@/components/pathname-history/pathname-history";
import { IdleTimerProvider } from "@/components/provider/idle-timer-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { findBreadcrumbsFromCollections } from "@/lib/config/navigation";
import { cn } from "@/lib/utils";
import { getSession } from "@/server/auth/getSession";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { NotFound } from "@/components/not-found/not-found";
import { getConfig } from "@/server/get-config";
import { lazy, Suspense } from "react";

const CreateDialog = lazy(() =>
  import("./dashboard/-views/features/index").then((m) => ({
    default: m.CreateDialog,
  })),
);
const EditDialog = lazy(() =>
  import("./dashboard/-views/features/index").then((m) => ({
    default: m.EditDialog,
  })),
);
const InfoAlert = lazy(() =>
  import("./dashboard/-views/features/index").then((m) => ({
    default: m.InfoAlert,
  })),
);
const AssetEditDialog = lazy(() =>
  import("./dashboard/-views/features/index").then((m) => ({
    default: m.AssetEditDialog,
  })),
);
const AssetMoveDialog = lazy(() =>
  import("./dashboard/-views/features/index").then((m) => ({
    default: m.AssetMoveDialog,
  })),
);
const AssetPreviewDialog = lazy(() =>
  import("./dashboard/-views/features/index").then((m) => ({
    default: m.AssetPreviewDialog,
  })),
);
const AssetPostProcessDialog = lazy(() =>
  import("./dashboard/-views/features/index").then((m) => ({
    default: m.AssetPostProcessDialog,
  })),
);
const AssetSelectFloat = lazy(() =>
  import("./dashboard/-views/features/index").then((m) => ({
    default: m.AssetSelectFloat,
  })),
);

export const Route = createFileRoute("/_backend/dashboard")({
  beforeLoad: async ({ location }) => {
    const session = await getSession();

    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    return { session, location };
  },
  component: RouteComponent,
  notFoundComponent: () => <NotFound />,
});

function RouteComponent() {
  const { publicURL, session, location } = Route.useRouteContext();
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
      items: item.items?.map((sub) => ({
        title: sub.title,
        url: `/dashboard${group.slug === "/" ? "" : `/${group.slug}`}/${item.slug}/${sub.slug}`,
      })),
    })),
  }));

  const slugs = location.pathname.split("/").filter(Boolean).slice(1);
  const allCollections = [
    ...config.collections.global,
    ...config.collections.settings,
  ];

  const breadcrumbs = findBreadcrumbsFromCollections(allCollections, slugs);

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
            <DashboardHeader items={breadcrumbs} />
            <div
              id="dashboard-content"
              className={cn(
                "h-[calc(100svh-56px)] mt-14 overflow-hidden",
                "max-lg:h-full max-lg:max-h-full max-lg:overflow-y-visible max-lg:pb-6",
              )}
            >
              <Suspense fallback={null}>
                <EditDialog />
                <CreateDialog />
                <InfoAlert />
                <AssetEditDialog />
                <AssetMoveDialog />
                <AssetPreviewDialog />
                <AssetPostProcessDialog />
                <AssetSelectFloat />
              </Suspense>

              {/* <AssetsDialogs /> */}
              <Outlet />
              <Toaster />
            </div>
          </SidebarInset>
        </SidebarProvider>
      </IdleTimerProvider>
    </>
  );
}
