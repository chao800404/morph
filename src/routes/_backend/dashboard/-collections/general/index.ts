import type {
  CollectionGroup,
  CollectionLoadContext,
} from "@/lib/config/create-config";
import { CurrencyAddPendingView } from "@views/settings/store/currency-add-skeleton";
import { UserDetailPendingView } from "@views/settings/users/user-detail-skeleton";
import { lazyView } from "@/lib/config/lazy-view";
import {
  createCollectionIndexPendingView,
  SimpleDetailSkeleton,
  StoreIndexSkeleton,
  TableDetailSkeleton,
} from "@/routes/_backend/dashboard/-components/loading/collection-page-skeletons";
import { createRouteSurfacePendingView } from "@/components/dialog/route-surface-pending";

const StoreEditPendingView = createRouteSurfacePendingView(4);
const UsersIndexPendingView = createCollectionIndexPendingView(5);
const UserInvitePendingView = createRouteSurfacePendingView(2);
const UserEditPendingView = createRouteSurfacePendingView(6);
const UserMetadataPendingView = createRouteSurfacePendingView(3);
const RegionsIndexPendingView = createCollectionIndexPendingView(4);
const RegionCreatePendingView = createRouteSurfacePendingView(8);
const RegionEditPendingView = createRouteSurfacePendingView(8);
const RegionMetadataPendingView = createRouteSurfacePendingView(3);
const SalesChannelsIndexPendingView = createCollectionIndexPendingView(4);
const SalesChannelCreatePendingView = createRouteSurfacePendingView(3);
const SalesChannelEditPendingView = createRouteSurfacePendingView(3);
const SalesChannelProductsPendingView = createRouteSurfacePendingView(2);
const SalesChannelMetadataPendingView = createRouteSurfacePendingView(3);
const LocationsIndexPendingView = createCollectionIndexPendingView(3);
const LocationCreatePendingView = createRouteSurfacePendingView(5);
const LocationEditPendingView = createRouteSurfacePendingView(5);
const LocationMetadataPendingView = createRouteSurfacePendingView(3);

export const General: CollectionGroup = {
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
        pendingView: StoreIndexSkeleton,
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
        pendingView: StoreEditPendingView,
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
        pendingView: UsersIndexPendingView,
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
        pendingView: UserInvitePendingView,
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
        pendingView: UserEditPendingView,
        prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return;
          const { dashboardUserQueries } =
            await import("@queries/dashboard-user.queries");
          void queryClient.prefetchQuery(
            dashboardUserQueries.detail(params.id),
          );
        },
      },
      pages: {
        metadata: {
          view: lazyView(() => import("@views/settings/users/user-metadata")),
          pendingView: UserMetadataPendingView,
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
    },
    {
      title: "Regions",
      slug: "regions",
      icon: "Globe2",
      label: "Regions",
      index: {
        view: lazyView(() => import("@views/settings/regions")),
        pendingView: RegionsIndexPendingView,
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
        pendingView: RegionCreatePendingView,
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
      detail: {
        view: lazyView(() => import("@views/settings/regions/region-detail")),
        pendingView: SimpleDetailSkeleton,
        breadcrumb: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return null;
          const { regionQueries } = await import("@queries/region.queries");
          const result = await queryClient.ensureQueryData(
            regionQueries.detail(params.id),
          );
          return result.success ? result.data.name : null;
        },
        prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return;
          const { regionQueries } = await import("@queries/region.queries");
          void queryClient.prefetchQuery(regionQueries.detail(params.id));
        },
      },
      edit: {
        view: lazyView(() => import("@views/settings/regions/region-edit")),
        pendingView: RegionEditPendingView,
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
      pages: {
        metadata: {
          view: lazyView(
            () => import("@views/settings/regions/region-metadata"),
          ),
          pendingView: RegionMetadataPendingView,
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const { regionQueries } = await import("@queries/region.queries");
            void queryClient.prefetchQuery(regionQueries.detail(params.id));
          },
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
        pendingView: SalesChannelsIndexPendingView,
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
        pendingView: SalesChannelCreatePendingView,
      },
      detail: {
        view: lazyView(
          () => import("@views/settings/sales-channels/sales-channel-detail"),
        ),
        pendingView: TableDetailSkeleton,
        breadcrumb: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return null;
          const { salesChannelQueries } =
            await import("@queries/sales-channel.queries");
          const result = await queryClient.ensureQueryData(
            salesChannelQueries.detail(params.id),
          );
          return result.success ? result.data.name : null;
        },
        prefetch: async ({
          queryClient,
          params,
          search,
        }: CollectionLoadContext) => {
          if (!params.id) return;
          const { salesChannelQueries } =
            await import("@queries/sales-channel.queries");
          const { productQueries, normalizeProductListParams } =
            await import("@queries/product.queries");
          const { tableViewQueries } =
            await import("@queries/table-view.queries");
          void queryClient.prefetchQuery(salesChannelQueries.detail(params.id));
          void queryClient.prefetchQuery(
            productQueries.list({
              ...normalizeProductListParams(search),
              salesChannelId: params.id,
            }),
          );
          // The embedded Products card uses the same persisted column view as
          // `/dashboard/products`; await it so both pages paint the same first
          // frame without briefly exposing default/hidden columns.
          await queryClient.ensureQueryData(
            tableViewQueries.detail("products"),
          );
        },
      },
      edit: {
        view: lazyView(
          () => import("@views/settings/sales-channels/sales-channel-edit"),
        ),
        pendingView: SalesChannelEditPendingView,
        prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return;
          const { salesChannelQueries } =
            await import("@queries/sales-channel.queries");
          void queryClient.prefetchQuery(salesChannelQueries.detail(params.id));
        },
      },
      pages: {
        "add-products": {
          view: lazyView(
            () =>
              import("@views/settings/sales-channels/sales-channel-add-products"),
          ),
          pendingView: SalesChannelProductsPendingView,
          prefetch: async ({
            queryClient,
            params,
            search,
          }: CollectionLoadContext) => {
            if (!params.id) return;
            const { salesChannelQueries } =
              await import("@queries/sales-channel.queries");
            const { productQueries, normalizeProductListParams } =
              await import("@queries/product.queries");
            const { tableViewQueries } =
              await import("@queries/table-view.queries");
            void queryClient.prefetchQuery(
              salesChannelQueries.detail(params.id),
            );
            void queryClient.prefetchQuery(
              productQueries.list({
                ...normalizeProductListParams(search),
                limit: Number(search.limit) || 50,
              }),
            );
            await queryClient.ensureQueryData(
              tableViewQueries.detail("products"),
            );
          },
        },
        metadata: {
          view: lazyView(
            () =>
              import("@views/settings/sales-channels/sales-channel-metadata"),
          ),
          pendingView: SalesChannelMetadataPendingView,
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const { salesChannelQueries } =
              await import("@queries/sales-channel.queries");
            void queryClient.prefetchQuery(
              salesChannelQueries.detail(params.id),
            );
          },
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
        pendingView: LocationsIndexPendingView,
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
        pendingView: LocationCreatePendingView,
      },
      detail: {
        view: lazyView(
          () => import("@views/settings/locations/location-detail"),
        ),
        pendingView: SimpleDetailSkeleton,
        breadcrumb: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return null;
          const { stockLocationQueries } =
            await import("@queries/stock-location.queries");
          const result = await queryClient.ensureQueryData(
            stockLocationQueries.detail(params.id),
          );
          return result.success ? result.data.name : null;
        },
        prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return;
          const { stockLocationQueries } =
            await import("@queries/stock-location.queries");
          void queryClient.prefetchQuery(
            stockLocationQueries.detail(params.id),
          );
        },
      },
      edit: {
        view: lazyView(() => import("@views/settings/locations/location-edit")),
        pendingView: LocationEditPendingView,
        prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return;
          const { stockLocationQueries } =
            await import("@queries/stock-location.queries");
          void queryClient.prefetchQuery(
            stockLocationQueries.detail(params.id),
          );
        },
      },
      pages: {
        metadata: {
          view: lazyView(
            () => import("@views/settings/locations/location-metadata"),
          ),
          pendingView: LocationMetadataPendingView,
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
    },
  ],
};
