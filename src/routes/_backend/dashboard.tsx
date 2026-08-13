import { DashboardHeader } from "@/components/header/dashboard-header";
import { AppSidebar } from "@/components/nav/app-sidebar";
import { RegisterPathnameHistory } from "@/components/pathname-history/pathname-history";
import { IdleTimerProvider } from "@/components/provider/idle-timer-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { findBreadcrumbsFromCollections } from "@/lib/config/navigation";
import { cn } from "@/lib/utils";
import { getSession } from "@/server/auth/getSession";
import { NotFound } from "@/components/not-found/not-found";
import { getConfig } from "@/server/get-config";
import {
  createFileRoute,
  Outlet,
  redirect,
  useMatches,
  useRouterState,
} from "@tanstack/react-router";
import { lazy, Suspense, useMemo } from "react";
import { DashboardAdapters } from "./dashboard/-components/dashboard-component-adapters";

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
  // The shell follows the requested location immediately. Route-level pending
  // components below replace the outlet with the destination's skeleton while
  // its loader resolves, so the sidebar never describes the previous page.
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const config = getConfig().client;
  const isSettings = pathname.startsWith("/dashboard/settings");
  const rawSideData = isSettings
    ? config.collections.settings
    : config.collections.global;

  const sideData = useMemo(
    () =>
      rawSideData.map((group) => ({
        title: group.title,
        items: group.collections.map((item) => ({
          title: item.title,
          url: `/dashboard${group.slug === "/" ? "" : `/${group.slug}`}/${item.slug}`,
          icon: item.icon,
          // Nesting is a sidebar affordance only; a nested collection has its
          // own flat URL, not one under its visual parent.
          items: item.items?.map((sub) => ({
            title: sub.title,
            url: `/dashboard${group.slug === "/" ? "" : `/${group.slug}`}/${sub.slug}`,
          })),
        })),
      })),
    [rawSideData],
  );
  const sidebarUser = useMemo(
    () => ({
      name: session.user.name,
      email: session.user.email,
      avatar: session.user.image,
    }),
    [session.user.email, session.user.image, session.user.name],
  );

  const slugs = pathname.split("/").filter(Boolean).slice(1);
  const allCollections = [
    ...config.collections.global,
    ...config.collections.settings,
  ];

  const breadcrumbs = findBreadcrumbsFromCollections(allCollections, slugs);
  // Like Medusa's route handles, every matched record route contributes its
  // own loader-resolved label. The parent product and child variant therefore
  // compose naturally without a page publishing global state in an effect.
  const trailingCrumbs = useMatches({
    select: (matches) =>
      matches.flatMap((match) => {
        const data = match.loaderData as
          | { breadcrumb?: unknown; breadcrumbHref?: unknown }
          | undefined;
        if (typeof data?.breadcrumb !== "string" || !data.breadcrumb) return [];
        return [
          {
            name: data.breadcrumb,
            href:
              typeof data.breadcrumbHref === "string"
                ? data.breadcrumbHref
                : match.pathname,
          },
        ];
      }),
  });
  const items = [...breadcrumbs, ...trailingCrumbs];

  return (
    <DashboardAdapters>
      <IdleTimerProvider
        publicURL={publicURL}
        enabled={config.auth?.autoLogout?.enabled ?? true}
        timeout={config.auth?.autoLogout?.timeout ?? 30}
        promptBeforeIdle={config.auth?.autoLogout?.promptBeforeIdle ?? 25}
      >
        <RegisterPathnameHistory pathname={pathname} />
        <SidebarProvider>
          <AppSidebar
            sideData={sideData}
            showSettings={!isSettings}
            appName={config.appName}
            publicURL={publicURL}
            user={sidebarUser}
            activePathname={pathname}
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

              {/*
                The shell above is a fixed viewport box with `overflow-hidden`,
                so this is the only scroll container a page gets. Without it a
                page taller than the viewport is simply clipped — the product
                detail page's cards were unreachable below the fold.

                Assets needs no exception: its cards are `h-content`
                (`100lvh - 5.5rem`), which is exactly this box minus its own
                padding, so it fills the area and never scrolls.
              */}
              <div
                id="dashboard-scroll-container"
                className="h-full min-h-0 overflow-y-auto p-4 max-lg:h-auto"
              >
                <Outlet />
              </div>
              <Toaster />
            </div>
          </SidebarInset>
        </SidebarProvider>
      </IdleTimerProvider>
    </DashboardAdapters>
  );
}
