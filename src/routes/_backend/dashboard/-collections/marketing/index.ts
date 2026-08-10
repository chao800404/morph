import type { CollectionLoadContext } from "@/lib/config/create-config";
import { lazyView } from "@/lib/config/lazy-view";

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
      },
      detail: {
        view: lazyView(
          () => import("@views/global/marketing/orders/order-detail"),
        ),
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
        prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return;
          const { orderQueries } = await import("@queries/marketing.queries");
          void queryClient.prefetchQuery(orderQueries.detail(params.id));
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
        prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return;
          const { promotionQueries } =
            await import("@queries/marketing.queries");
          void queryClient.prefetchQuery(promotionQueries.detail(params.id));
        },
      },
    },
  ],
};
