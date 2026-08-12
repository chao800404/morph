import type { CollectionLoadContext } from "@/lib/config/create-config";
import { CurrencyAddPendingView } from "@views/settings/store/currency-add-skeleton";
import { UserDetailPendingView } from "@views/settings/users/user-detail-skeleton";
import { lazyView } from "@/lib/config/lazy-view";

export const General = {
  slug: "settings",
  title: "General",
  collections: [
    {
      title: "Store",
      slug: "store",
      icon: "Store",
      label: "Store",
      index: {
        view: lazyView(() => import("@views/settings/store")),
        prefetch: async ({ queryClient }: CollectionLoadContext) => {
          const { currencyQueries } = await import("@queries/currency.queries");
          await queryClient.prefetchQuery(currencyQueries.store());
        },
      },
      create: {
        label: "Add currencies",
        view: lazyView(() => import("@views/settings/store/currency-add")),
        pendingView: CurrencyAddPendingView,
        prefetch: async ({ queryClient }: CollectionLoadContext) => {
          const { currencyQueries } = await import("@queries/currency.queries");
          // The table lists every currency and ticks the enabled ones.
          void queryClient.prefetchQuery(currencyQueries.store());
          void queryClient.prefetchQuery(currencyQueries.available());
        },
      },
      edit: {
        view: lazyView(() => import("@views/settings/store/store-edit")),
        prefetch: async ({ queryClient }: CollectionLoadContext) => {
          const { currencyQueries } = await import("@queries/currency.queries");
          void queryClient.prefetchQuery(currencyQueries.store());
        },
      },
    },
    {
      title: "Users",
      slug: "users",
      icon: "UsersRound",
      label: "Users",
      index: {
        view: lazyView(() => import("@views/settings/users")),
        prefetch: async ({ queryClient, search }: CollectionLoadContext) => {
          const { dashboardUserQueries, normalizeDashboardUserListParams } =
            await import("@queries/dashboard-user.queries");
          void queryClient.prefetchQuery(
            dashboardUserQueries.list(normalizeDashboardUserListParams(search)),
          );
        },
      },
      create: {
        label: "Invite",
        view: lazyView(() => import("@views/settings/users/user-invite")),
        prefetch: async ({ queryClient, search }: CollectionLoadContext) => {
          const { inviteQueries, normalizeInviteListParams } =
            await import("@queries/invite.queries");
          void queryClient.prefetchQuery(
            inviteQueries.list(normalizeInviteListParams(search)),
          );
        },
      },
      detail: {
        view: lazyView(() => import("@views/settings/users/user-detail")),
        pendingView: UserDetailPendingView,
        breadcrumb: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return null;
          const { dashboardUserQueries } =
            await import("@queries/dashboard-user.queries");
          const result = await queryClient.ensureQueryData(
            dashboardUserQueries.detail(params.id),
          );
          return result.success ? result.data.email : null;
        },
        prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return;
          const { dashboardUserQueries } =
            await import("@queries/dashboard-user.queries");
          void queryClient.prefetchQuery(
            dashboardUserQueries.detail(params.id),
          );
        },
      },
      edit: {
        view: lazyView(() => import("@views/settings/users/user-edit")),
        prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return;
          const { dashboardUserQueries } =
            await import("@queries/dashboard-user.queries");
          void queryClient.prefetchQuery(
            dashboardUserQueries.detail(params.id),
          );
        },
      },
    },
    {
      title: "Regions",
      slug: "regions",
      icon: "Globe2",
      label: "Regions",
      index: {
        view: lazyView(() => import("@views/settings/regions")),
        prefetch: async ({ queryClient, search }: CollectionLoadContext) => {
          const { regionQueries, normalizeRegionListParams } =
            await import("@queries/region.queries");
          void queryClient.prefetchQuery(
            regionQueries.list(normalizeRegionListParams(search)),
          );
        },
      },
      create: {
        view: lazyView(() => import("@views/settings/regions/region-create")),
        prefetch: async ({ queryClient }: CollectionLoadContext) => {
          const { regionQueries } = await import("@queries/region.queries");
          const { currencyQueries } = await import("@queries/currency.queries");
          void queryClient.prefetchQuery(
            regionQueries.assignableCountries(null),
          );
          void queryClient.prefetchQuery(regionQueries.paymentProviders());
          void queryClient.prefetchQuery(currencyQueries.store());
        },
      },
      edit: {
        view: lazyView(() => import("@views/settings/regions/region-edit")),
        prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return;
          const { regionQueries } = await import("@queries/region.queries");
          const { currencyQueries } = await import("@queries/currency.queries");
          void queryClient.prefetchQuery(regionQueries.detail(params.id));
          void queryClient.prefetchQuery(
            regionQueries.assignableCountries(params.id),
          );
          void queryClient.prefetchQuery(regionQueries.paymentProviders());
          void queryClient.prefetchQuery(currencyQueries.store());
        },
      },
    },
    {
      title: "Sales Channels",
      slug: "sales-channels",
      icon: "RadioTower",
      label: "Sales Channels",
      index: {
        view: lazyView(() => import("@views/settings/sales-channels")),
        prefetch: async ({ queryClient, search }: CollectionLoadContext) => {
          const { salesChannelQueries, normalizeSalesChannelListParams } =
            await import("@queries/sales-channel.queries");
          void queryClient.prefetchQuery(
            salesChannelQueries.list(normalizeSalesChannelListParams(search)),
          );
        },
      },
      create: {
        view: lazyView(
          () => import("@views/settings/sales-channels/sales-channel-create"),
        ),
      },
      edit: {
        view: lazyView(
          () => import("@views/settings/sales-channels/sales-channel-edit"),
        ),
        prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return;
          const { salesChannelQueries } =
            await import("@queries/sales-channel.queries");
          void queryClient.prefetchQuery(salesChannelQueries.detail(params.id));
        },
      },
    },
    {
      title: "Locations & Shipping",
      slug: "locations",
      icon: "MapPinHouse",
      label: "Locations & Shipping",
      index: {
        view: lazyView(() => import("@views/settings/locations")),
        prefetch: async ({ queryClient, search }: CollectionLoadContext) => {
          const { stockLocationQueries, normalizeStockLocationListParams } =
            await import("@queries/stock-location.queries");
          void queryClient.prefetchQuery(
            stockLocationQueries.list(normalizeStockLocationListParams(search)),
          );
        },
      },
      create: {
        view: lazyView(
          () => import("@views/settings/locations/location-create"),
        ),
      },
      edit: {
        view: lazyView(() => import("@views/settings/locations/location-edit")),
        prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return;
          const { stockLocationQueries } =
            await import("@queries/stock-location.queries");
          void queryClient.prefetchQuery(
            stockLocationQueries.detail(params.id),
          );
        },
      },
    },
  ],
};
