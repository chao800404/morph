import type {
  CollectionGroup,
  CollectionLoadContext,
} from "@/lib/config/create-config";
import { lazyView } from "@/lib/config/lazy-view";
import { AssetsPageSkeleton } from "@views/global/contents/assets/component/assets-card-skeleton";
import { ProductDetailSkeleton } from "@views/global/contents/products/detail/product-detail-skeleton";
import { ProductVariantDetailSkeleton } from "@views/global/contents/products/detail/product-variant-detail-skeleton";
import { ProductIndexSkeleton } from "@views/global/contents/products/product-index-skeleton";
import {
  createCollectionIndexPendingView,
  SimpleDetailSkeleton,
  TableDetailSkeleton,
} from "@/routes/_backend/dashboard/-components/loading/collection-page-skeletons";
import { createRouteSurfacePendingView } from "@/components/dialog/route-surface-pending";
import { referenceDataCollections } from "../general";

const ProductCreatePendingView = createRouteSurfacePendingView(8);
const ProductEditPendingView = createRouteSurfacePendingView(8);
const ProductOrganizationPendingView = createRouteSurfacePendingView(5);
const ProductMediaPendingView = createRouteSurfacePendingView(1);
const ProductOptionsPendingView = createRouteSurfacePendingView(2);
const ProductVariantEditPendingView = createRouteSurfacePendingView(8);
const ProductVariantMetadataPendingView = createRouteSurfacePendingView(3);
const ProductVariantPricingPendingView = createRouteSurfacePendingView(4);
const ProductVariantPricesPendingView = createRouteSurfacePendingView(2);
const ProductVariantInventoryPendingView = createRouteSurfacePendingView(1);
const ProductAttributesPendingView = createRouteSurfacePendingView(9);
const ProductMetadataPendingView = createRouteSurfacePendingView(3);
const CollectionsIndexPendingView = createCollectionIndexPendingView(3);
const CollectionCreatePendingView = createRouteSurfacePendingView(2);
const CollectionEditPendingView = createRouteSurfacePendingView(2);
const CollectionMetadataPendingView = createRouteSurfacePendingView(3);
const CategoriesIndexPendingView = createCollectionIndexPendingView(4);
const CategoryCreatePendingView = createRouteSurfacePendingView(4);
const CategoryDetailPendingView = TableDetailSkeleton;
const CategoryEditPendingView = createRouteSurfacePendingView(4);
const CategoryMetadataPendingView = createRouteSurfacePendingView(3);
const InventoryIndexPendingView = createCollectionIndexPendingView(5);
const OptionsIndexPendingView = createCollectionIndexPendingView(3);
const OptionCreatePendingView = createRouteSurfacePendingView(3);
const OptionEditPendingView = createRouteSurfacePendingView(3);
const OptionMetadataPendingView = createRouteSurfacePendingView(3);
const AssetCreatePendingView = createRouteSurfacePendingView(3);
const AssetPreviewPendingView = AssetsPageSkeleton;
const AssetEditPendingView = createRouteSurfacePendingView(5);

const prefetchAssetItem = async ({
  queryClient,
  params,
  search,
}: CollectionLoadContext) => {
  if (!params.id || !search.itemType) return;
  const { parseAssetEditSelection } =
    await import("@/lib/asset/edit-selection");
  const items = parseAssetEditSelection(search.editItems, {
    id: params.id,
    itemType: search.itemType,
  });
  if (items.length === 0) return;
  const { assetQueries } = await import("@queries/asset.queries");
  void queryClient.prefetchQuery(assetQueries.items({ items }));
  const { remoteOptionQueries } =
    await import("@queries/remote-options.queries");
  void queryClient.prefetchInfiniteQuery(
    remoteOptionQueries.pages({
      source: "asset-folders",
    }),
  );
};

export const Contents: CollectionGroup = {
  slug: "/",
  title: "Content",
  collections: [
    {
      title: "Products",
      slug: "products",
      icon: "Package",
      label: "Products",
      // Multi-step, and it generates variants: losing it half-filled costs
      // real work, so it gets its own page at /dashboard/products/create.
      create: {
        view: lazyView(
          () =>
            import("@views/global/contents/products/create/product-create-wizard"),
        ),
        pendingView: ProductCreatePendingView,
        // The wizard suspends on store currencies, and its later steps read
        // four more lists. Priming them all is what keeps the whole flow to a
        // single skeleton.
        prefetch: async ({ queryClient }: CollectionLoadContext) => {
          const [product, currency, salesChannel] = await Promise.all([
            import("@queries/product.queries"),
            import("@queries/currency.queries"),
            import("@queries/sales-channel.queries"),
          ]);
          void queryClient.prefetchQuery(currency.currencyQueries.store());
          void queryClient.prefetchQuery(
            product.collectionQueries.list(
              product.normalizeCollectionListParams({}),
            ),
          );
          const { remoteOptionQueries } =
            await import("@queries/remote-options.queries");
          for (const source of [
            "product-types",
            "product-tags",
            "product-categories",
          ] as const) {
            void queryClient.prefetchInfiniteQuery(
              remoteOptionQueries.pages({ source }),
            );
          }
          void queryClient.prefetchQuery(
            product.productOptionQueries.list(
              product.normalizeProductOptionListParams(),
            ),
          );
          void queryClient.prefetchQuery(
            salesChannel.salesChannelQueries.list({
              ...salesChannel.normalizeSalesChannelListParams({
                sortBy: "name",
                sortOrder: "asc",
              }),
              limit: 100,
            }),
          );
        },
      },
      detail: {
        view: lazyView(() => import("@views/global/contents/products/detail")),
        breadcrumb: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return null;
          const { productQueries } = await import("@queries/product.queries");
          const result = await queryClient.ensureQueryData(
            productQueries.detail(params.id),
          );
          return result.success ? result.data.title : null;
        },
        // Both columns and all seven cards; the page draws the same component
        // while its query runs, so the chunk wait and the fetch wait are one
        // continuous state.
        pendingView: ProductDetailSkeleton,
        prefetch: async ({
          queryClient,
          params,
          search,
        }: CollectionLoadContext) => {
          if (!params.id) return;
          const {
            normalizeProductVariantListParams,
            productQueries,
            productVariantQueries,
          } = await import("@queries/product.queries");
          void queryClient.prefetchQuery(productQueries.detail(params.id));
          void queryClient.prefetchQuery(
            productVariantQueries.list(
              normalizeProductVariantListParams(params.id, search),
            ),
          );
        },
      },
      edit: {
        view: lazyView(
          () => import("@views/global/contents/products/detail/product-edit"),
        ),
        pendingView: ProductEditPendingView,
        prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return;
          const { productQueries } = await import("@queries/product.queries");
          void queryClient.prefetchQuery(productQueries.detail(params.id));
        },
      },
      // One page per card on the detail view. Each replaces a whole link set,
      // so they cannot be merged into the details form without clearing what
      // that form does not render.
      pages: {
        organization: {
          view: lazyView(
            () =>
              import("@views/global/contents/products/detail/product-organization"),
          ),
          pendingView: ProductOrganizationPendingView,
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const {
              productQueries,
              collectionQueries,
              normalizeCollectionListParams,
            } = await import("@queries/product.queries");
            void queryClient.prefetchQuery(productQueries.detail(params.id));
            // The form's three pickers: collection, type/tags, categories.
            void queryClient.prefetchQuery(
              collectionQueries.list({
                ...normalizeCollectionListParams({}),
                limit: 100,
              }),
            );
            const { remoteOptionQueries } =
              await import("@queries/remote-options.queries");
            for (const source of [
              "product-types",
              "product-tags",
              "product-categories",
            ] as const) {
              void queryClient.prefetchInfiniteQuery(
                remoteOptionQueries.pages({ source }),
              );
            }
          },
        },
        media: {
          view: lazyView(
            () =>
              import("@views/global/contents/products/detail/product-media"),
          ),
          pendingView: ProductMediaPendingView,
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const { productQueries } = await import("@queries/product.queries");
            void queryClient.prefetchQuery(productQueries.detail(params.id));
          },
        },
        options: {
          view: lazyView(
            () =>
              import("@views/global/contents/products/detail/product-options"),
          ),
          pendingView: ProductOptionsPendingView,
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const {
              productQueries,
              productOptionQueries,
              productVariantQueries,
              normalizeProductOptionListParams,
            } = await import("@queries/product.queries");
            void queryClient.prefetchQuery(productQueries.detail(params.id));
            // The picker offers the whole option library.
            void queryClient.prefetchQuery(
              productOptionQueries.list(normalizeProductOptionListParams()),
            );
            void queryClient.prefetchQuery(
              productVariantQueries.bulk(params.id),
            );
          },
        },
        // Which variant is `?variantId`: the page names the surface, the search
        // param names the record inside it.
        variant: {
          presentation: "replace" as const,
          breadcrumb: async ({
            queryClient,
            params,
            search,
          }: CollectionLoadContext) => {
            const variantId = params.childId ?? search.variantId;
            if (!variantId) return null;
            const { productVariantQueries } =
              await import("@queries/product.queries");
            const result = await queryClient.ensureQueryData(
              productVariantQueries.detail(variantId),
            );
            return result.success ? result.data.variant.title : null;
          },
          view: lazyView(
            () =>
              import("@views/global/contents/products/detail/product-variant-detail"),
          ),
          pendingView: ProductVariantDetailSkeleton,
          prefetch: async ({
            queryClient,
            params,
            search,
          }: CollectionLoadContext) => {
            const variantId = params.childId ?? search.variantId;
            if (!params.id || !variantId) return;
            const {
              normalizeVariantPriceHistoryListParams,
              productQueries,
              productVariantQueries,
            } = await import("@queries/product.queries");
            void queryClient.prefetchQuery(productQueries.detail(params.id));
            void queryClient.prefetchQuery(
              productVariantQueries.detail(variantId),
            );
            void queryClient.prefetchQuery(
              productVariantQueries.priceHistory(
                normalizeVariantPriceHistoryListParams(variantId, search),
              ),
            );
          },
        },
        "variant-edit": {
          view: lazyView(
            () =>
              import("@views/global/contents/products/detail/product-variant"),
          ),
          pendingView: ProductVariantEditPendingView,
          prefetch: async ({
            queryClient,
            params,
            search,
          }: CollectionLoadContext) => {
            if (!params.id) return;
            const [
              { productQueries, productVariantQueries },
              { currencyQueries },
            ] = await Promise.all([
              import("@queries/product.queries"),
              import("@queries/currency.queries"),
            ]);
            // Both, because the form renders a price field per store currency
            // and would otherwise show its own spinner after the chunk lands.
            void queryClient.prefetchQuery(productQueries.detail(params.id));
            if (search.variantId) {
              void queryClient.prefetchQuery(
                productVariantQueries.detail(search.variantId),
              );
            }
            void queryClient.prefetchQuery(currencyQueries.store());
          },
        },
        "variant-metadata": {
          view: lazyView(
            () =>
              import("@views/global/contents/products/detail/product-variant-metadata"),
          ),
          pendingView: ProductVariantMetadataPendingView,
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.childId) return;
            const { productVariantQueries } =
              await import("@queries/product.queries");
            void queryClient.prefetchQuery(
              productVariantQueries.detail(params.childId),
            );
          },
        },
        "variant-pricing": {
          view: lazyView(
            () =>
              import("@views/global/contents/products/detail/product-variant-pricing"),
          ),
          pendingView: ProductVariantPricingPendingView,
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.childId) return;
            const [{ productVariantQueries }, { currencyQueries }] =
              await Promise.all([
                import("@queries/product.queries"),
                import("@queries/currency.queries"),
              ]);
            void queryClient.prefetchQuery(
              productVariantQueries.detail(params.childId),
            );
            void queryClient.prefetchQuery(currencyQueries.store());
          },
        },
        "variant-prices": {
          view: lazyView(
            () =>
              import("@views/global/contents/products/detail/product-variants-bulk-prices"),
          ),
          pendingView: ProductVariantPricesPendingView,
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const [
              { productQueries, productVariantQueries },
              { currencyQueries },
            ] = await Promise.all([
              import("@queries/product.queries"),
              import("@queries/currency.queries"),
            ]);
            void queryClient.prefetchQuery(productQueries.detail(params.id));
            void queryClient.prefetchQuery(
              productVariantQueries.bulk(params.id),
            );
            void queryClient.prefetchQuery(currencyQueries.store());
          },
        },
        "variant-inventory": {
          view: lazyView(
            () =>
              import("@views/global/contents/products/detail/product-variants-bulk-inventory"),
          ),
          pendingView: ProductVariantInventoryPendingView,
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const { productQueries, productVariantQueries } =
              await import("@queries/product.queries");
            void queryClient.prefetchQuery(productQueries.detail(params.id));
            void queryClient.prefetchQuery(
              productVariantQueries.bulk(params.id),
            );
          },
        },
        attributes: {
          view: lazyView(
            () =>
              import("@views/global/contents/products/detail/product-attributes"),
          ),
          pendingView: ProductAttributesPendingView,
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const { productQueries } = await import("@queries/product.queries");
            void queryClient.prefetchQuery(productQueries.detail(params.id));
          },
        },
        metadata: {
          view: lazyView(
            () =>
              import("@views/global/contents/products/detail/product-metadata"),
          ),
          pendingView: ProductMetadataPendingView,
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const { productQueries } = await import("@queries/product.queries");
            void queryClient.prefetchQuery(productQueries.detail(params.id));
          },
        },
      },
      index: {
        view: lazyView(() => import("@views/global/contents/products")),
        pendingView: ProductIndexSkeleton,
        prefetch: async ({ queryClient, search }: CollectionLoadContext) => {
          const { productQueries, normalizeProductListParams } =
            await import("@queries/product.queries");
          const { tableViewQueries } =
            await import("@queries/table-view.queries");
          // Prefetch with the same params the view normalizes to, so the loader
          // primes the exact cache entry the component reads.
          void queryClient.prefetchQuery(
            productQueries.list(normalizeProductListParams(search)),
          );
          // Column order is part of the first table frame. Await it so SSR and
          // client navigation never paint the default order before the user's.
          await queryClient.ensureQueryData(
            tableViewQueries.detail("products"),
          );
        },
      },
      items: [
        {
          title: "Collections",
          slug: "collections",
          label: "Collections",
          create: {
            view: lazyView(
              () =>
                import("@views/global/contents/products/collections/collection-create"),
            ),
            pendingView: CollectionCreatePendingView,
          },
          detail: {
            view: lazyView(
              () =>
                import("@views/global/contents/products/collections/collection-detail"),
            ),
            pendingView: SimpleDetailSkeleton,
            breadcrumb: async ({
              queryClient,
              params,
            }: CollectionLoadContext) => {
              if (!params.id) return null;
              const { collectionQueries } =
                await import("@queries/product.queries");
              const result = await queryClient.ensureQueryData(
                collectionQueries.detail(params.id),
              );
              return result.success ? result.data.title : null;
            },
            prefetch: async ({
              queryClient,
              params,
              search,
            }: CollectionLoadContext) => {
              if (!params.id) return;
              const {
                collectionQueries,
                productQueries,
                normalizeProductListParams,
              } = await import("@queries/product.queries");
              void queryClient.prefetchQuery(
                collectionQueries.detail(params.id),
              );
              // Same params the page's Products card uses, so it primes that
              // cache entry rather than a second one.
              void queryClient.prefetchQuery(
                productQueries.list({
                  ...normalizeProductListParams(search),
                  collectionId: params.id,
                }),
              );
            },
          },
          edit: {
            view: lazyView(
              () =>
                import("@views/global/contents/products/collections/collection-edit"),
            ),
            pendingView: CollectionEditPendingView,

            prefetch: async ({
              queryClient,
              params,
            }: CollectionLoadContext) => {
              if (!params.id) return;
              const { collectionQueries } =
                await import("@queries/product.queries");
              void queryClient.prefetchQuery(
                collectionQueries.detail(params.id),
              );
            },
          },
          pages: {
            metadata: {
              view: lazyView(
                () =>
                  import("@views/global/contents/products/collections/collection-metadata"),
              ),
              pendingView: CollectionMetadataPendingView,

              prefetch: async ({
                queryClient,
                params,
              }: CollectionLoadContext) => {
                if (!params.id) return;
                const { collectionQueries } =
                  await import("@queries/product.queries");
                void queryClient.prefetchQuery(
                  collectionQueries.detail(params.id),
                );
              },
            },
          },
          index: {
            view: lazyView(
              () => import("@views/global/contents/products/collections"),
            ),
            pendingView: CollectionsIndexPendingView,
            prefetch: async ({
              queryClient,
              search,
            }: CollectionLoadContext) => {
              const { collectionQueries, normalizeCollectionListParams } =
                await import("@queries/product.queries");
              void queryClient.prefetchQuery(
                collectionQueries.list(normalizeCollectionListParams(search)),
              );
            },
          },
        },
        {
          title: "Categories",
          slug: "categories",
          label: "Categories",
          create: {
            view: lazyView(
              () =>
                import("@views/global/contents/products/categories/category-create"),
            ),
            pendingView: CategoryCreatePendingView,
            prefetch: async ({ queryClient }: CollectionLoadContext) => {
              const { remoteOptionQueries } =
                await import("@queries/remote-options.queries");
              void queryClient.prefetchInfiniteQuery(
                remoteOptionQueries.pages({ source: "product-categories" }),
              );
            },
          },
          detail: {
            view: lazyView(
              () =>
                import("@views/global/contents/products/categories/category-detail"),
            ),
            pendingView: CategoryDetailPendingView,
            breadcrumb: async ({
              queryClient,
              params,
            }: CollectionLoadContext) => {
              if (!params.id) return null;
              const { productCategoryQueries } =
                await import("@queries/product.queries");
              const result = await queryClient.ensureQueryData(
                productCategoryQueries.detail(params.id),
              );
              return result.success ? result.data.name : null;
            },
            prefetch: async ({
              queryClient,
              params,
              search,
            }: CollectionLoadContext) => {
              if (!params.id) return;
              const {
                productCategoryQueries,
                productQueries,
                normalizeProductListParams,
              } = await import("@queries/product.queries");
              void queryClient.prefetchQuery(
                productCategoryQueries.detail(params.id),
              );
              void queryClient.prefetchQuery(
                productQueries.list({
                  ...normalizeProductListParams(search),
                  categoryId: params.id,
                }),
              );
            },
          },
          edit: {
            view: lazyView(
              () =>
                import("@views/global/contents/products/categories/category-edit"),
            ),
            pendingView: CategoryEditPendingView,

            prefetch: async ({
              queryClient,
              params,
            }: CollectionLoadContext) => {
              if (!params.id) return;
              const { productCategoryQueries } =
                await import("@queries/product.queries");
              void queryClient.prefetchQuery(
                productCategoryQueries.detail(params.id),
              );
            },
          },
          pages: {
            metadata: {
              view: lazyView(
                () =>
                  import("@views/global/contents/products/categories/category-metadata"),
              ),
              pendingView: CategoryMetadataPendingView,

              prefetch: async ({
                queryClient,
                params,
              }: CollectionLoadContext) => {
                if (!params.id) return;
                const { productCategoryQueries } =
                  await import("@queries/product.queries");
                void queryClient.prefetchQuery(
                  productCategoryQueries.detail(params.id),
                );
              },
            },
          },
          index: {
            view: lazyView(
              () => import("@views/global/contents/products/categories"),
            ),
            pendingView: CategoriesIndexPendingView,
            prefetch: async ({
              queryClient,
              search,
            }: CollectionLoadContext) => {
              const {
                productCategoryQueries,
                normalizeProductCategoryListParams,
              } = await import("@queries/product.queries");
              void queryClient.prefetchQuery(
                productCategoryQueries.list(
                  normalizeProductCategoryListParams(search),
                ),
              );
            },
          },
        },
        {
          title: "Inventory",
          slug: "inventory",
          label: "Inventory",
          index: {
            view: lazyView(
              () => import("@views/global/contents/products/inventory"),
            ),
            pendingView: InventoryIndexPendingView,
            prefetch: async ({
              queryClient,
              search,
            }: CollectionLoadContext) => {
              const { inventoryQueries, normalizeInventoryListParams } =
                await import("@queries/inventory.queries");
              void queryClient.prefetchQuery(
                inventoryQueries.list(normalizeInventoryListParams(search)),
              );
            },
          },
        },
        {
          title: "Options",
          slug: "product-options",
          label: "Options",
          create: {
            view: lazyView(
              () =>
                import("@views/global/contents/products/options/option-create"),
            ),
            pendingView: OptionCreatePendingView,
          },
          detail: {
            view: lazyView(
              () =>
                import("@views/global/contents/products/options/option-detail"),
            ),
            pendingView: TableDetailSkeleton,
            breadcrumb: async ({
              queryClient,
              params,
            }: CollectionLoadContext) => {
              if (!params.id) return null;
              const { productOptionQueries } =
                await import("@queries/product.queries");
              const result = await queryClient.ensureQueryData(
                productOptionQueries.detail(params.id),
              );
              return result.success ? result.data.title : null;
            },
            prefetch: async ({
              queryClient,
              params,
              search,
            }: CollectionLoadContext) => {
              if (!params.id) return;
              const {
                productOptionQueries,
                productQueries,
                normalizeProductListParams,
              } = await import("@queries/product.queries");
              void queryClient.prefetchQuery(
                productOptionQueries.detail(params.id),
              );
              void queryClient.prefetchQuery(
                productQueries.list({
                  ...normalizeProductListParams(search),
                  optionId: params.id,
                }),
              );
            },
          },
          edit: {
            view: lazyView(
              () =>
                import("@views/global/contents/products/options/option-edit"),
            ),
            pendingView: OptionEditPendingView,

            prefetch: async ({
              queryClient,
              params,
            }: CollectionLoadContext) => {
              if (!params.id) return;
              const { productOptionQueries } =
                await import("@queries/product.queries");
              void queryClient.prefetchQuery(
                productOptionQueries.detail(params.id),
              );
            },
          },
          pages: {
            metadata: {
              view: lazyView(
                () =>
                  import("@views/global/contents/products/options/option-metadata"),
              ),
              pendingView: OptionMetadataPendingView,

              prefetch: async ({
                queryClient,
                params,
              }: CollectionLoadContext) => {
                if (!params.id) return;
                const { productOptionQueries } =
                  await import("@queries/product.queries");
                void queryClient.prefetchQuery(
                  productOptionQueries.detail(params.id),
                );
              },
            },
          },
          index: {
            view: lazyView(
              () => import("@views/global/contents/products/options"),
            ),
            pendingView: OptionsIndexPendingView,
            prefetch: async ({
              queryClient,
              search,
            }: CollectionLoadContext) => {
              const { productOptionQueries, normalizeProductOptionListParams } =
                await import("@queries/product.queries");
              void queryClient.prefetchQuery(
                productOptionQueries.list(
                  normalizeProductOptionListParams(search),
                ),
              );
            },
          },
        },
        ...referenceDataCollections.filter(
          ({ slug }) => slug === "product-types" || slug === "product-tags",
        ),
      ],
    },
    {
      title: "Assets",
      slug: "assets",
      icon: "Inbox",
      label: "Assets",
      // Two variants — folder and upload — served by one page that reads
      // `?variant`. The header's Create menu navigates here; drag-and-drop onto
      // the explorer remains a separate, faster path.
      create: {
        view: lazyView(
          () => import("@views/global/contents/assets/asset-create"),
        ),
        pendingView: AssetCreatePendingView,
        prefetch: async ({ queryClient }: CollectionLoadContext) => {
          const { remoteOptionQueries } =
            await import("@queries/remote-options.queries");
          void queryClient.prefetchInfiniteQuery(
            remoteOptionQueries.pages({ source: "asset-folders" }),
          );
        },
      },
      preview: {
        view: lazyView(
          () => import("@views/global/contents/assets/asset-preview"),
        ),
        pendingView: AssetPreviewPendingView,
        prefetch: async ({ queryClient, search }: CollectionLoadContext) => {
          const { assetQueries, normalizeAssetListParams } =
            await import("@queries/asset.queries");
          void queryClient.prefetchQuery(
            assetQueries.list(normalizeAssetListParams(search)),
          );
        },
      },
      edit: {
        view: lazyView(
          () => import("@views/global/contents/assets/asset-edit"),
        ),
        pendingView: AssetEditPendingView,
        prefetch: prefetchAssetItem,
      },
      index: {
        view: lazyView(() => import("@views/global/contents/assets")),
        // The explorer shows a skeleton while its query runs, so the chunk wait
        // uses the same shape instead of a spinner that then swaps to a skeleton.
        pendingView: AssetsPageSkeleton,
        prefetch: async ({ queryClient, search }: CollectionLoadContext) => {
          const { assetQueries, normalizeAssetListParams } =
            await import("@queries/asset.queries");
          // Keep the active Assets view mounted while the next folder loads.
          // The page's useQuery observes these in-flight cache entries and keeps
          // its previous result visible instead of letting the route suspend.
          void queryClient.prefetchQuery(
            assetQueries.list(normalizeAssetListParams(search)),
          );
        },
      },
    },
  ],
};
