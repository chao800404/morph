import { createRouteSurfacePendingView } from "@/components/dialog/route-surface-pending";
import type {
  CollectionGroup,
  CollectionLoadContext,
} from "@/lib/config/create-config";
import { lazyView } from "@/lib/config/lazy-view";
import { createCollectionIndexPendingView } from "@/routes/_backend/dashboard/-components/loading/collection-page-skeletons";
import OnlineStoreOverviewPendingView from "@views/global/online-store/online-store-pending";
import StorefrontPageDetailPending from "@views/global/online-store/pages/page-detail-pending";

const PagesIndexPendingView = createCollectionIndexPendingView(4);
const PageCreatePendingView = createRouteSurfacePendingView(3);
const PageEditPendingView = createRouteSurfacePendingView(3);

export const OnlineStore: CollectionGroup = {
  slug: "/",
  title: "Sales channels",
  collections: [
    {
      title: "Online Store",
      slug: "online-store",
      icon: "Store",
      label: "Online Store",
      index: {
        view: lazyView(() => import("@views/global/online-store")),
        pendingView: OnlineStoreOverviewPendingView,
      },
      items: [
        {
          title: "Pages",
          slug: "pages",
          label: "Pages",
          index: {
            view: lazyView(() => import("@views/global/online-store/pages")),
            pendingView: PagesIndexPendingView,
            prefetch: async ({
              queryClient,
              search,
            }: CollectionLoadContext) => {
              const {
                normalizeStorefrontPageListParams,
                storefrontPageQueries,
              } = await import("@queries/storefront-page.queries");
              void queryClient.prefetchQuery(
                storefrontPageQueries.list(
                  normalizeStorefrontPageListParams(search),
                ),
              );
            },
          },
          create: {
            view: lazyView(
              () => import("@views/global/online-store/pages/page-create"),
            ),
            pendingView: PageCreatePendingView,
          },
          detail: {
            view: lazyView(
              () => import("@views/global/online-store/pages/page-detail"),
            ),
            pendingView: StorefrontPageDetailPending,
            breadcrumb: async ({
              queryClient,
              params,
            }: CollectionLoadContext) => {
              if (!params.id) return null;
              const { storefrontPageQueries } =
                await import("@queries/storefront-page.queries");
              const result = await queryClient.ensureQueryData(
                storefrontPageQueries.detail(params.id),
              );
              return result.success ? result.data.title : null;
            },
            prefetch: async ({
              queryClient,
              params,
            }: CollectionLoadContext) => {
              if (!params.id) return;
              const { storefrontPageQueries } =
                await import("@queries/storefront-page.queries");
              void queryClient.prefetchQuery(
                storefrontPageQueries.detail(params.id),
              );
            },
          },
          edit: {
            view: lazyView(
              () => import("@views/global/online-store/pages/page-edit"),
            ),
            pendingView: PageEditPendingView,
            prefetch: async ({
              queryClient,
              params,
            }: CollectionLoadContext) => {
              if (!params.id) return;
              const { storefrontPageQueries } =
                await import("@queries/storefront-page.queries");
              void queryClient.prefetchQuery(
                storefrontPageQueries.detail(params.id),
              );
            },
          },
          pages: {
            metadata: {
              view: lazyView(
                () => import("@views/global/online-store/pages/page-metadata"),
              ),
              pendingView: createRouteSurfacePendingView(1),
              breadcrumb: () => "Metadata",
              prefetch: async ({
                queryClient,
                params,
              }: CollectionLoadContext) => {
                if (!params.id) return;
                const { storefrontPageQueries } =
                  await import("@queries/storefront-page.queries");
                void queryClient.prefetchQuery(
                  storefrontPageQueries.detail(params.id),
                );
              },
            },
            revisions: {
              view: lazyView(
                () => import("@views/global/online-store/pages/page-revisions"),
              ),
              pendingView: createCollectionIndexPendingView(3),
              presentation: "replace",
              breadcrumb: () => "Revision history",
              prefetch: async ({
                queryClient,
                params,
                search,
              }: CollectionLoadContext) => {
                if (!params.id) return;
                const { storefrontPageQueries } =
                  await import("@queries/storefront-page.queries");
                void queryClient.prefetchQuery(
                  storefrontPageQueries.revisions(
                    params.id,
                    Number(search.page) || 1,
                  ),
                );
              },
            },
          },
        },
      ],
    },
  ],
};
