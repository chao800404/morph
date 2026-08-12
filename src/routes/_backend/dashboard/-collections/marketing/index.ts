import type { CollectionLoadContext } from "@/lib/config/create-config";
import { lazyView } from "@/lib/config/lazy-view";
import {
  CollectionDetailSkeleton,
  OrderDetailSkeleton,
  createCollectionIndexPendingView,
} from "@/routes/_backend/dashboard/-components/loading/collection-page-skeletons";
import { createRouteSurfacePendingView } from "@/components/dialog/route-surface-pending";

const OrdersIndexPendingView = createCollectionIndexPendingView(5);
const OrderCreatePendingView = createRouteSurfacePendingView(6);
const OrderEditPendingView = createRouteSurfacePendingView(6);
const OrderMetadataPendingView = createRouteSurfacePendingView(3);
const PromotionsIndexPendingView = createCollectionIndexPendingView(5);
const PromotionCreatePendingView = createRouteSurfacePendingView(10);
const PromotionDetailPendingView = CollectionDetailSkeleton;
const PromotionEditPendingView = createRouteSurfacePendingView(10);
const PromotionMetadataPendingView = createRouteSurfacePendingView(3);

export const Marketing = {
  slug: "/",
  title: "Marketing",
  collections: [
    {
      title: "Orders",
      slug: "orders",
      icon: "ShoppingCart",
      label: "Orders",
      index: {
        view: lazyView(() => import("@views/global/marketing/orders")),
        pendingView: OrdersIndexPendingView,
        prefetch: async ({ queryClient, search }: CollectionLoadContext) => {
          const { orderQueries, normalizeOrderListParams } =
            await import("@queries/marketing.queries");
          void queryClient.prefetchQuery(
            orderQueries.list(normalizeOrderListParams(search)),
          );
        },
      },
      create: {
        view: lazyView(
          () => import("@views/global/marketing/orders/order-create"),
        ),
        pendingView: OrderCreatePendingView,
      },
      detail: {
        view: lazyView(
          () => import("@views/global/marketing/orders/order-detail"),
        ),
        pendingView: OrderDetailSkeleton,
        breadcrumb: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return null;
          const { orderQueries } = await import("@queries/marketing.queries");
          const result = await queryClient.ensureQueryData(
            orderQueries.detail(params.id),
          );
          return result.success ? `#${result.data.displayId}` : null;
        },
        prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return;
          const { orderQueries } = await import("@queries/marketing.queries");
          void queryClient.prefetchQuery(orderQueries.detail(params.id));
        },
      },
      edit: {
        view: lazyView(
          () => import("@views/global/marketing/orders/order-edit"),
        ),
        pendingView: OrderEditPendingView,
        prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return;
          const { orderQueries } = await import("@queries/marketing.queries");
          void queryClient.prefetchQuery(orderQueries.detail(params.id));
        },
      },
      pages: {
        metadata: {
          view: lazyView(
            () => import("@views/global/marketing/orders/order-metadata"),
          ),
          pendingView: OrderMetadataPendingView,
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const { orderQueries } = await import("@queries/marketing.queries");
            void queryClient.prefetchQuery(orderQueries.detail(params.id));
          },
        },
      },
    },
    {
      title: "Promotions",
      slug: "promotions",
      icon: "TicketPercent",
      label: "Promotions",
      index: {
        view: lazyView(() => import("@views/global/marketing/promotions")),
        pendingView: PromotionsIndexPendingView,
        prefetch: async ({ queryClient, search }: CollectionLoadContext) => {
          const { promotionQueries, normalizePromotionListParams } =
            await import("@queries/marketing.queries");
          void queryClient.prefetchQuery(
            promotionQueries.list(normalizePromotionListParams(search)),
          );
        },
      },
      create: {
        view: lazyView(
          () => import("@views/global/marketing/promotion-create"),
        ),
        pendingView: PromotionCreatePendingView,
        prefetch: async ({ queryClient }: CollectionLoadContext) => {
          const { promotionQueries } =
            await import("@queries/marketing.queries");
          void queryClient.prefetchQuery(promotionQueries.campaigns());
        },
      },
      detail: {
        view: lazyView(
          () => import("@views/global/marketing/promotion-detail"),
        ),
        pendingView: PromotionDetailPendingView,
        breadcrumb: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return null;
          const { promotionQueries } =
            await import("@queries/marketing.queries");
          const result = await queryClient.ensureQueryData(
            promotionQueries.detail(params.id),
          );
          return result.success ? result.data.code : null;
        },
        prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return;
          const { promotionQueries } =
            await import("@queries/marketing.queries");
          void queryClient.prefetchQuery(promotionQueries.detail(params.id));
        },
      },
      edit: {
        view: lazyView(() => import("@views/global/marketing/promotion-edit")),
        pendingView: PromotionEditPendingView,
        prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return;
          const { promotionQueries } =
            await import("@queries/marketing.queries");
          void queryClient.prefetchQuery(promotionQueries.detail(params.id));
        },
      },
      pages: {
        metadata: {
          view: lazyView(
            () => import("@views/global/marketing/promotion-metadata"),
          ),
          pendingView: PromotionMetadataPendingView,
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const { promotionQueries } =
              await import("@queries/marketing.queries");
            void queryClient.prefetchQuery(promotionQueries.detail(params.id));
          },
        },
      },
    },
  ],
};
