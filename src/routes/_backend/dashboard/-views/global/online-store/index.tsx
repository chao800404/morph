import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { PageSplitLayout } from "@/routes/_backend/dashboard/-components/layout/page-split-layout";
import { ResourceLinkCard } from "@/routes/_backend/dashboard/-components/resource-link-card";
import { findCollection } from "@/lib/config/navigation";
import { viewPreloader } from "@/lib/config/lazy-view";
import { salesChannelTypeLabel } from "@/lib/sales-channel/types";
import { getConfig } from "@/server/get-config";
import { storefrontQueries } from "@queries/storefront.queries";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useNavigate, useRouter } from "@tanstack/react-router";
import {
  CircleCheck,
  ExternalLink,
  LockKeyhole,
  MoreHorizontal,
  ShoppingBag,
  Store,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import OnlineStorePendingView from "./online-store-pending";

const PreviewHeader = ({ compact = false }: { compact?: boolean }) => (
  <div className="flex h-10 items-center justify-between border-b border-border/70 bg-background/95 px-3 text-foreground">
    <div className="flex items-center gap-2.5">
      <span className="font-serif text-[11px] font-semibold tracking-tight">
        morph
      </span>
      {!compact ? (
        <div className="flex items-center gap-2 text-[6px] text-muted-foreground">
          <span>Shop</span>
          <span>Journal</span>
          <span>About</span>
        </div>
      ) : null}
    </div>
    <div className="flex items-center gap-1.5 text-muted-foreground">
      <span className="size-2 rounded-full border" />
      <ShoppingBag className="size-2.5" />
    </div>
  </div>
);

const StorefrontPreview = ({
  storefrontId,
  themeId,
}: {
  storefrontId?: string;
  themeId?: string;
}) => {
  const preview = (
    <div className="relative mx-auto flex min-h-0 w-full max-w-4xl origin-bottom transform-gpu items-end justify-center overflow-hidden px-4 pt-8 transition-transform duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] will-change-transform [backface-visibility:hidden] group-hover:scale-[1.015] group-focus-visible:scale-[1.015] motion-reduce:transition-none motion-reduce:group-hover:scale-100 motion-reduce:group-focus-visible:scale-100 sm:px-10 sm:pt-10">
      <div className="w-full overflow-hidden rounded-t-xl border border-border/80 bg-background shadow-[0_18px_50px_-24px_rgba(0,0,0,0.35)]">
        <PreviewHeader />
        <div className="relative flex aspect-[16/7] min-h-44 items-end overflow-hidden bg-muted sm:min-h-52">
          <img
            src="/static/storefront/theme-preview-default.png"
            alt=""
            className="absolute inset-0 size-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background/85 via-background/35 to-transparent" />
          <div className="relative z-10 max-w-sm space-y-2 p-5 sm:p-8">
            <p className="text-[7px] font-medium uppercase tracking-[0.22em] text-muted-foreground sm:text-[9px]">
              New collection
            </p>
            <p className="font-serif text-xl leading-none tracking-tight text-foreground sm:text-4xl">
              Objects for everyday rituals.
            </p>
            <span className="inline-flex border-b border-foreground/60 pb-0.5 text-[7px] font-medium text-foreground sm:text-[9px]">
              Explore the collection
            </span>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 right-4 hidden w-[24%] min-w-36 overflow-hidden rounded-t-xl border border-border bg-background shadow-[0_18px_45px_-20px_rgba(0,0,0,0.45)] sm:block lg:right-10">
        <PreviewHeader compact />
        <div className="relative flex aspect-[4/5] items-end overflow-hidden bg-muted">
          <img
            src="/static/storefront/theme-preview-default.png"
            alt=""
            className="absolute inset-0 size-full object-cover object-[68%_center]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent to-transparent" />
          <div className="relative z-10 space-y-1.5 p-4">
            <p className="font-serif text-lg leading-none text-foreground">
              Made to be kept.
            </p>
            <p className="text-[7px] leading-relaxed text-muted-foreground">
              Quiet essentials, considered in every detail.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  if (!storefrontId || !themeId) return preview;

  return (
    <Link
      to="/store/$storefrontId/themes/$themeId/editor"
      params={{ storefrontId, themeId }}
      search={{ template: "index", viewport: "desktop" }}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open visual theme editor"
      className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {preview}
    </Link>
  );
};

export default function OnlineStoreOverview() {
  const navigate = useNavigate();
  const router = useRouter();
  const query = useQuery(storefrontQueries.detail());
  const storefront = query.data?.success ? query.data.data : null;
  const editView = useMemo(
    () =>
      findCollection(getConfig().client.collections.global, "online-store")
        ?.edit?.view,
    [],
  );
  const salesChannelDetailView = useMemo(
    () =>
      findCollection(getConfig().client.collections.settings, "sales-channels")
        ?.detail?.view,
    [],
  );
  const accessView = useMemo(
    () =>
      findCollection(getConfig().client.collections.global, "online-store")
        ?.pages?.access?.view,
    [],
  );
  const openEdit = useCallback(() => {
    if (!storefront) return;
    void navigate({
      to: "/dashboard/$slug/$id/edit",
      params: { slug: "online-store", id: storefront.id },
    });
  }, [navigate, storefront]);
  const preloadEdit = useCallback(() => {
    if (!storefront) return;
    void viewPreloader(editView)?.();
    void router.preloadRoute({
      to: "/dashboard/$slug/$id/edit",
      params: { slug: "online-store", id: storefront.id },
    });
  }, [editView, router, storefront]);
  const preloadSalesChannel = useCallback(() => {
    void viewPreloader(salesChannelDetailView)?.();
  }, [salesChannelDetailView]);
  const openAccess = useCallback(() => {
    if (!storefront) return;
    void navigate({
      to: "/dashboard/$slug/$id/$page",
      params: { slug: "online-store", id: storefront.id, page: "access" },
    });
  }, [navigate, storefront]);
  const preloadAccess = useCallback(() => {
    if (!storefront) return;
    void viewPreloader(accessView)?.();
    void router.preloadRoute({
      to: "/dashboard/$slug/$id/$page",
      params: { slug: "online-store", id: storefront.id, page: "access" },
    });
  }, [accessView, router, storefront]);

  if (query.isPending) return <OnlineStorePendingView />;

  const websiteFields: EditCardField[] = [
    {
      key: "name",
      label: "Website name",
      displayValue: storefront?.name,
    },
    {
      key: "seoTitle",
      label: "Default SEO title",
      displayValue: storefront?.preferences.seoTitle,
    },
    {
      key: "seoDescription",
      label: "SEO description",
      displayValue: storefront?.preferences.seoDescription,
    },
    {
      key: "domain",
      label: "Primary domain",
      displayValue: storefront?.domain ?? "Not connected",
      disabled: true,
    },
    {
      key: "status",
      label: "Status",
      displayValue: storefront?.status,
      disabled: true,
    },
  ];

  return (
    <PageSplitLayout
      sidebar={
        <div className="flex flex-col gap-4">
          <EditCard
            id="storefront-website-information"
            title="Website information"
            description="Identity and default storefront metadata"
            fields={websiteFields}
            onEdit={storefront ? openEdit : undefined}
            onEditPreload={storefront ? preloadEdit : undefined}
          />
          {storefront?.connectedSalesChannel ? (
            <ResourceLinkCard
              id="storefront-sales-channel"
              title="Sales channel"
              headerAction={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Sales channel actions"
                  disabled
                >
                  <MoreHorizontal />
                </Button>
              }
              item={{
                href: `/dashboard/settings/sales-channels/${storefront.connectedSalesChannel.id}`,
                icon: Store,
                title: storefront.connectedSalesChannel.name,
                description: salesChannelTypeLabel(
                  storefront.connectedSalesChannel.type,
                ),
                onPreload: preloadSalesChannel,
              }}
            />
          ) : null}
        </div>
      }
    >
      <CardWrapper
        customHeader={
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-base font-medium text-foreground">
                Current theme
              </p>
              <p className="text-sm text-muted-foreground">
                The published presentation for your primary sales channel.
              </p>
            </div>
            <DropdownMenu onOpenChange={(open) => open && preloadAccess()}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Theme actions"
                  disabled={!storefront}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={openAccess}>
                  <LockKeyhole className="size-4" />
                  Manage storefront access
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
        classNames={{ cardWrapper: "overflow-hidden" }}
      >
        <div className="overflow-hidden border-t bg-muted/35">
          <StorefrontPreview
            storefrontId={storefront?.id}
            themeId={storefront?.activeThemeId ?? undefined}
          />

          <div className="flex flex-col gap-3 border-t border-border/70 bg-amber-500/8 px-5 py-3 text-amber-950 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm">
              <LockKeyhole className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                {storefront?.preferences.accessMode === "public"
                  ? "Storefront is publicly accessible."
                  : "Storefront access is limited to authorized dashboard users."}
              </span>
            </div>
            <Button
              variant="outline"
              size="xs"
              disabled={!storefront}
              onClick={openAccess}
              onPointerEnter={preloadAccess}
              onFocus={preloadAccess}
              onTouchStart={preloadAccess}
            >
              Manage access
            </Button>
          </div>

          <div className="flex flex-col gap-5 bg-component px-5 py-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  Default
                </h2>
                <p className="text-sm text-muted-foreground">
                  Your active storefront theme
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CircleCheck className="size-3.5 text-primary" />
                <span>Published</span>
                <span aria-hidden="true">·</span>
                <Link
                  to="/dashboard/$slug"
                  params={{ slug: "pages" }}
                  className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Manage pages
                </Link>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {storefront?.activeThemeId ? (
                <Button variant="cardHeader" size="xs" asChild>
                  <Link
                    to="/store/$storefrontId/themes/$themeId/editor"
                    params={{
                      storefrontId: storefront.id,
                      themeId: storefront.activeThemeId,
                    }}
                    search={{ template: "index", viewport: "desktop" }}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Customize theme
                    <ExternalLink className="size-3.5" />
                  </Link>
                </Button>
              ) : (
                <Button variant="cardHeader" size="xs" disabled>
                  Customize theme
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardWrapper>
    </PageSplitLayout>
  );
}
