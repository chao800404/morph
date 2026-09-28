import type {
  CollectionGroup,
  CollectionLoadContext,
} from "@/lib/config/create-config";
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
const OrderRefundPendingView = createRouteSurfacePendingView(2);
const OrderFulfillPendingView = createRouteSurfacePendingView(4);
const OrderReturnPendingView = createRouteSurfacePendingView(5);
const OrderReceiveReturnPendingView = createRouteSurfacePendingView(7);
const OrderClaimCreatePendingView = createRouteSurfacePendingView(7);
const OrderExchangeCreatePendingView = createRouteSurfacePendingView(8);
const PromotionsIndexPendingView = createCollectionIndexPendingView(5);
const PromotionCreatePendingView = createRouteSurfacePendingView(10);
const PromotionDetailPendingView = CollectionDetailSkeleton;
const PromotionEditPendingView = createRouteSurfacePendingView(10);
const PromotionMetadataPendingView = createRouteSurfacePendingView(3);
const PriceListsIndexPendingView = createCollectionIndexPendingView(4);
const PriceListCreatePendingView = createRouteSurfacePendingView(6);
const PriceListEditPendingView = createRouteSurfacePendingView(6);
const PriceListDetailPendingView = CollectionDetailSkeleton;
const PriceListPriceCreatePendingView = createRouteSurfacePendingView(6);
const CampaignsIndexPendingView = createCollectionIndexPendingView(5);
const CampaignCreatePendingView = createRouteSurfacePendingView(7);
const CampaignEditPendingView = createRouteSurfacePendingView(7);
const CampaignDetailPendingView = CollectionDetailSkeleton;
const StoreCreditAccountsIndexPendingView = createCollectionIndexPendingView(5);
const StoreCreditAccountCreatePendingView = createRouteSurfacePendingView(4);
const StoreCreditAccountDetailPendingView = CollectionDetailSkeleton;
const StoreCreditAccountAdjustPendingView = createRouteSurfacePendingView(4);
const GiftCardsIndexPendingView = createCollectionIndexPendingView(5);
const GiftCardCreatePendingView = createRouteSurfacePendingView(5);
const GiftCardDetailPendingView = CollectionDetailSkeleton;
const GiftCardAdjustPendingView = createRouteSurfacePendingView(4);
const GiftCardEditPendingView = createRouteSurfacePendingView(3);

export const Marketing: CollectionGroup = {
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
        prefetch: async ({
          queryClient,
          params,
          search,
        }: CollectionLoadContext) => {
          if (!params.id) return;
          const {
            normalizeOrderFulfillmentListParams,
            normalizeOrderItemListParams,
            normalizeOrderReturnListParams,
            orderQueries,
          } = await import("@queries/marketing.queries");
          void queryClient.prefetchQuery(orderQueries.detail(params.id));
          void queryClient.prefetchQuery(
            orderQueries.items(normalizeOrderItemListParams(params.id, search)),
          );
          void queryClient.prefetchQuery(
            orderQueries.fulfillments(
              normalizeOrderFulfillmentListParams(params.id, search),
            ),
          );
          void queryClient.prefetchQuery(
            orderQueries.returns(
              normalizeOrderReturnListParams(params.id, search),
            ),
          );
          void queryClient.prefetchQuery(
            orderQueries.returnableItems(params.id),
          );
          void queryClient.prefetchQuery(orderQueries.claims(params.id));
          void queryClient.prefetchQuery(orderQueries.exchanges(params.id));
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
        refund: {
          view: lazyView(
            () => import("@views/global/marketing/orders/order-refund"),
          ),
          pendingView: OrderRefundPendingView,
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const { orderQueries } = await import("@queries/marketing.queries");
            void queryClient.prefetchQuery(orderQueries.detail(params.id));
          },
        },
        fulfill: {
          view: lazyView(
            () => import("@views/global/marketing/orders/order-fulfill"),
          ),
          pendingView: OrderFulfillPendingView,
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const { orderQueries } = await import("@queries/marketing.queries");
            const { normalizeStockLocationListParams, stockLocationQueries } =
              await import("@queries/stock-location.queries");
            void Promise.all([
              queryClient.prefetchQuery(orderQueries.detail(params.id)),
              queryClient.prefetchQuery(
                orderQueries.fulfillableItems(params.id),
              ),
              queryClient.prefetchQuery(
                stockLocationQueries.list(
                  normalizeStockLocationListParams({
                    limit: 100,
                    sortBy: "name",
                  }),
                ),
              ),
            ]);
          },
        },
        return: {
          view: lazyView(
            () => import("@views/global/marketing/orders/order-return-create"),
          ),
          pendingView: OrderReturnPendingView,
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const { orderQueries } = await import("@queries/marketing.queries");
            const { normalizeReferenceDataListParams, referenceDataQueries } =
              await import("@queries/reference-data.queries");
            void Promise.all([
              queryClient.prefetchQuery(orderQueries.detail(params.id)),
              queryClient.prefetchQuery(
                orderQueries.returnableItems(params.id),
              ),
              queryClient.prefetchQuery(
                referenceDataQueries.list(
                  normalizeReferenceDataListParams("return-reasons", {
                    limit: 100,
                  }),
                ),
              ),
            ]);
          },
        },
        claim: {
          view: lazyView(
            () => import("@views/global/marketing/orders/order-claim-create"),
          ),
          pendingView: OrderClaimCreatePendingView,
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const { orderQueries } = await import("@queries/marketing.queries");
            const { normalizeStockLocationListParams, stockLocationQueries } =
              await import("@queries/stock-location.queries");
            void Promise.all([
              queryClient.prefetchQuery(orderQueries.detail(params.id)),
              queryClient.prefetchQuery(
                orderQueries.returnableItems(params.id),
              ),
              queryClient.prefetchQuery(
                stockLocationQueries.list(
                  normalizeStockLocationListParams({
                    limit: 100,
                    sortBy: "name",
                  }),
                ),
              ),
            ]);
          },
        },
        "refund-claim": {
          view: lazyView(
            () =>
              import("@views/global/marketing/orders/order-refund-claim-create"),
          ),
          pendingView: OrderClaimCreatePendingView,
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const { orderQueries } = await import("@queries/marketing.queries");
            const { normalizeStockLocationListParams, stockLocationQueries } =
              await import("@queries/stock-location.queries");
            void Promise.all([
              queryClient.prefetchQuery(orderQueries.detail(params.id)),
              queryClient.prefetchQuery(
                orderQueries.returnableItems(params.id),
              ),
              queryClient.prefetchQuery(
                stockLocationQueries.list(
                  normalizeStockLocationListParams({
                    limit: 100,
                    sortBy: "name",
                  }),
                ),
              ),
            ]);
          },
        },
        exchange: {
          view: lazyView(
            () =>
              import("@views/global/marketing/orders/order-exchange-create"),
          ),
          pendingView: OrderExchangeCreatePendingView,
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const { orderQueries } = await import("@queries/marketing.queries");
            const { normalizeStockLocationListParams, stockLocationQueries } =
              await import("@queries/stock-location.queries");
            void Promise.all([
              queryClient.prefetchQuery(orderQueries.detail(params.id)),
              queryClient.prefetchQuery(
                orderQueries.returnableItems(params.id),
              ),
              queryClient.prefetchQuery(
                stockLocationQueries.list(
                  normalizeStockLocationListParams({
                    limit: 100,
                    sortBy: "name",
                  }),
                ),
              ),
            ]);
          },
        },
        "receive-return": {
          view: lazyView(
            () => import("@views/global/marketing/orders/order-return-receive"),
          ),
          pendingView: OrderReceiveReturnPendingView,
          prefetch: async ({
            queryClient,
            params,
            search,
          }: CollectionLoadContext) => {
            if (!params.id || !search.returnId) return;
            const { orderQueries } = await import("@queries/marketing.queries");
            const { normalizeStockLocationListParams, stockLocationQueries } =
              await import("@queries/stock-location.queries");
            void Promise.all([
              queryClient.prefetchQuery(orderQueries.detail(params.id)),
              queryClient.prefetchQuery(
                orderQueries.returnDetail(search.returnId),
              ),
              queryClient.prefetchQuery(
                stockLocationQueries.list(
                  normalizeStockLocationListParams({
                    limit: 100,
                    sortBy: "name",
                  }),
                ),
              ),
            ]);
          },
        },
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
      title: "Price Lists",
      slug: "price-lists",
      icon: "Tags",
      label: "Price Lists",
      index: {
        view: lazyView(() => import("@views/global/marketing/price-lists")),
        pendingView: PriceListsIndexPendingView,
        prefetch: async ({ queryClient, search }: CollectionLoadContext) => {
          const { priceListQueries, normalizePriceListParams } =
            await import("@queries/price-list.queries");
          void queryClient.prefetchQuery(
            priceListQueries.list(normalizePriceListParams(search)),
          );
        },
      },
      create: {
        view: lazyView(
          () => import("@views/global/marketing/price-list-create"),
        ),
        pendingView: PriceListCreatePendingView,
        prefetch: async ({ queryClient }: CollectionLoadContext) => {
          const { customerGroupQueries, normalizeCustomerGroupListParams } =
            await import("@queries/customer.queries");
          void queryClient.prefetchQuery(
            customerGroupQueries.list(
              normalizeCustomerGroupListParams({ limit: 100 }),
            ),
          );
        },
      },
      detail: {
        view: lazyView(
          () => import("@views/global/marketing/price-list-detail"),
        ),
        pendingView: PriceListDetailPendingView,
        breadcrumb: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return null;
          const { priceListQueries } =
            await import("@queries/price-list.queries");
          const result = await queryClient.ensureQueryData(
            priceListQueries.detail(params.id),
          );
          return result.success ? result.data.title : null;
        },
        prefetch: async ({
          queryClient,
          params,
          search,
        }: CollectionLoadContext) => {
          if (!params.id) return;
          const { priceListQueries, normalizePriceListPriceParams } =
            await import("@queries/price-list.queries");
          void queryClient.prefetchQuery(priceListQueries.detail(params.id));
          void queryClient.prefetchQuery(
            priceListQueries.prices(
              normalizePriceListPriceParams(params.id, search),
            ),
          );
        },
      },
      edit: {
        view: lazyView(() => import("@views/global/marketing/price-list-edit")),
        pendingView: PriceListEditPendingView,
        prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return;
          const { priceListQueries } =
            await import("@queries/price-list.queries");
          void queryClient.prefetchQuery(priceListQueries.detail(params.id));
          const { customerGroupQueries, normalizeCustomerGroupListParams } =
            await import("@queries/customer.queries");
          void queryClient.prefetchQuery(
            customerGroupQueries.list(
              normalizeCustomerGroupListParams({ limit: 100 }),
            ),
          );
        },
      },
      pages: {
        "add-price": {
          view: lazyView(
            () => import("@views/global/marketing/price-list-add-price"),
          ),
          presentation: "replace",
          pendingView: PriceListPriceCreatePendingView,
          breadcrumb: async ({
            queryClient,
            params,
          }: CollectionLoadContext) => {
            if (!params.id) return null;
            const { priceListQueries } =
              await import("@queries/price-list.queries");
            const result = await queryClient.ensureQueryData(
              priceListQueries.detail(params.id),
            );
            return result.success ? `Add price to ${result.data.title}` : null;
          },
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const { priceListQueries } =
              await import("@queries/price-list.queries");
            void queryClient.prefetchQuery(priceListQueries.detail(params.id));
            const { currencyQueries } =
              await import("@queries/currency.queries");
            void queryClient.prefetchQuery(currencyQueries.store());
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
          const { remoteOptionQueries } =
            await import("@queries/remote-options.queries");
          void queryClient.prefetchInfiniteQuery(
            remoteOptionQueries.pages({ source: "promotion-campaigns" }),
          );
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
    {
      title: "Campaigns",
      slug: "campaigns",
      icon: "Megaphone",
      label: "Campaigns",
      index: {
        view: lazyView(() => import("@views/global/marketing/campaigns")),
        pendingView: CampaignsIndexPendingView,
        prefetch: async ({ queryClient, search }: CollectionLoadContext) => {
          const { campaignQueries, normalizeCampaignListParams } =
            await import("@queries/campaign.queries");
          void queryClient.prefetchQuery(
            campaignQueries.list(normalizeCampaignListParams(search)),
          );
        },
      },
      create: {
        view: lazyView(() => import("@views/global/marketing/campaign-create")),
        pendingView: CampaignCreatePendingView,
      },
      detail: {
        view: lazyView(() => import("@views/global/marketing/campaign-detail")),
        pendingView: CampaignDetailPendingView,
        breadcrumb: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return null;
          const { campaignQueries } = await import("@queries/campaign.queries");
          const result = await queryClient.ensureQueryData(
            campaignQueries.detail(params.id),
          );
          return result.success ? result.data.name : null;
        },
        prefetch: async ({
          queryClient,
          params,
          search,
        }: CollectionLoadContext) => {
          if (!params.id) return;
          const { campaignQueries } = await import("@queries/campaign.queries");
          const { normalizePromotionListParams, promotionQueries } =
            await import("@queries/marketing.queries");
          void Promise.all([
            queryClient.prefetchQuery(campaignQueries.detail(params.id)),
            queryClient.prefetchQuery(
              promotionQueries.list(
                normalizePromotionListParams(search, {
                  campaignId: params.id,
                }),
              ),
            ),
          ]);
        },
      },
      edit: {
        view: lazyView(() => import("@views/global/marketing/campaign-edit")),
        pendingView: CampaignEditPendingView,
        prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return;
          const { campaignQueries } = await import("@queries/campaign.queries");
          void queryClient.prefetchQuery(campaignQueries.detail(params.id));
        },
      },
      pages: {
        "add-promotions": {
          view: lazyView(
            () => import("@views/global/marketing/campaign-add-promotions"),
          ),
          presentation: "replace",
          pendingView: createRouteSurfacePendingView(5),
          breadcrumb: async ({
            queryClient,
            params,
          }: CollectionLoadContext) => {
            if (!params.id) return null;
            const { campaignQueries } =
              await import("@queries/campaign.queries");
            const result = await queryClient.ensureQueryData(
              campaignQueries.detail(params.id),
            );
            return result.success
              ? `Add promotions to ${result.data.name}`
              : null;
          },
          prefetch: async ({ queryClient, search }: CollectionLoadContext) => {
            const { normalizePromotionListParams, promotionQueries } =
              await import("@queries/marketing.queries");
            void queryClient.prefetchQuery(
              promotionQueries.list(
                normalizePromotionListParams(search, { unassigned: true }),
              ),
            );
          },
        },
      },
    },
    {
      title: "Store Credits",
      slug: "store-credits",
      icon: "WalletCards",
      label: "Store Credits",
      index: {
        view: lazyView(() => import("@views/global/marketing/store-credits")),
        pendingView: StoreCreditAccountsIndexPendingView,
        prefetch: async ({ queryClient, search }: CollectionLoadContext) => {
          const { normalizeStoreCreditListParams, storeCreditQueries } =
            await import("@queries/store-credit.queries");
          void queryClient.prefetchQuery(
            storeCreditQueries.list(normalizeStoreCreditListParams(search)),
          );
        },
      },
      create: {
        view: lazyView(
          () => import("@views/global/marketing/store-credit-create"),
        ),
        pendingView: StoreCreditAccountCreatePendingView,
      },
      detail: {
        view: lazyView(
          () => import("@views/global/marketing/store-credit-detail"),
        ),
        pendingView: StoreCreditAccountDetailPendingView,
        breadcrumb: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return null;
          const { storeCreditQueries } =
            await import("@queries/store-credit.queries");
          const result = await queryClient.ensureQueryData(
            storeCreditQueries.detail(params.id),
          );
          return result.success
            ? `${result.data.account.customerEmail ?? "Unclaimed"} · ${result.data.account.id.slice(0, 8)}`
            : null;
        },
        prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return;
          const { storeCreditQueries } =
            await import("@queries/store-credit.queries");
          void queryClient.prefetchQuery(storeCreditQueries.detail(params.id));
        },
      },
      pages: {
        adjust: {
          view: lazyView(
            () => import("@views/global/marketing/store-credit-adjust"),
          ),
          presentation: "replace",
          pendingView: StoreCreditAccountAdjustPendingView,
          breadcrumb: async ({
            queryClient,
            params,
          }: CollectionLoadContext) => {
            if (!params.id) return null;
            const { storeCreditQueries } =
              await import("@queries/store-credit.queries");
            const result = await queryClient.ensureQueryData(
              storeCreditQueries.detail(params.id),
            );
            return result.success ? "Adjust balance" : null;
          },
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const { storeCreditQueries } =
              await import("@queries/store-credit.queries");
            void queryClient.prefetchQuery(
              storeCreditQueries.detail(params.id),
            );
          },
        },
      },
    },
    {
      title: "Gift Cards",
      slug: "gift-cards",
      icon: "Gift",
      label: "Gift Cards",
      index: {
        view: lazyView(() => import("@views/global/marketing/gift-cards")),
        pendingView: GiftCardsIndexPendingView,
        prefetch: async ({ queryClient, search }: CollectionLoadContext) => {
          const { giftCardQueries, normalizeGiftCardListParams } =
            await import("@queries/gift-card.queries");
          void queryClient.prefetchQuery(
            giftCardQueries.list(normalizeGiftCardListParams(search)),
          );
        },
      },
      create: {
        view: lazyView(
          () => import("@views/global/marketing/gift-card-create"),
        ),
        pendingView: GiftCardCreatePendingView,
      },
      detail: {
        view: lazyView(
          () => import("@views/global/marketing/gift-card-detail"),
        ),
        pendingView: GiftCardDetailPendingView,
        breadcrumb: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return null;
          const { giftCardQueries } = await import("@queries/gift-card.queries");
          const result = await queryClient.ensureQueryData(
            giftCardQueries.detail({ id: params.id, offset: 0, limit: 20 }),
          );
          return result.success
            ? `Gift card · ${result.data.giftCard.id.slice(0, 8)}`
            : null;
        },
        prefetch: async ({ queryClient, params, search }: CollectionLoadContext) => {
          if (!params.id) return;
          const {
            giftCardQueries,
            normalizeGiftCardTransactionParams,
          } = await import("@queries/gift-card.queries");
          void queryClient.prefetchQuery(
            giftCardQueries.detail(
              normalizeGiftCardTransactionParams(params.id, search),
            ),
          );
        },
      },
      edit: {
        view: lazyView(
          () => import("@views/global/marketing/gift-card-edit"),
        ),
        pendingView: GiftCardEditPendingView,
        prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return;
          const { giftCardQueries } = await import("@queries/gift-card.queries");
          void queryClient.prefetchQuery(
            giftCardQueries.detail({ id: params.id, offset: 0, limit: 1 }),
          );
        },
      },
      pages: {
        adjust: {
          view: lazyView(
            () => import("@views/global/marketing/gift-card-adjust"),
          ),
          presentation: "replace",
          pendingView: GiftCardAdjustPendingView,
          breadcrumb: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return null;
            const { giftCardQueries } = await import("@queries/gift-card.queries");
            const result = await queryClient.ensureQueryData(
              giftCardQueries.detail({ id: params.id, offset: 0, limit: 20 }),
            );
            return result.success ? "Adjust balance" : null;
          },
          prefetch: async ({ queryClient, params, search }: CollectionLoadContext) => {
            if (!params.id) return;
            const {
              giftCardQueries,
              normalizeGiftCardTransactionParams,
            } = await import("@queries/gift-card.queries");
            void queryClient.prefetchQuery(
              giftCardQueries.detail(
                normalizeGiftCardTransactionParams(params.id, search),
              ),
            );
          },
        },
      },
    },
  ],
};
