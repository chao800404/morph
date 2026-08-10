import type { CollectionLoadContext } from "@/lib/config/create-config";
import { lazyView } from "@/lib/config/lazy-view";
import { AssetsPageSkeleton } from "@views/global/contents/assets/component/assets-card-skeleton";
import { ProductDetailSkeleton } from "@views/global/contents/products/detail/product-detail-skeleton";
import { ProductVariantDetailSkeleton } from "@views/global/contents/products/detail/product-variant-detail-skeleton";

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
};

export const Contents = {
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
        // The wizard suspends on store currencies, and its Organize step reads
        // three more lists. Priming them all is what keeps the whole flow to a
        // single skeleton.
        prefetch: async ({ queryClient }: CollectionLoadContext) => {
          const [product, currency] = await Promise.all([
            import("@queries/product.queries"),
            import("@queries/currency.queries"),
          ]);
          void queryClient.prefetchQuery(currency.currencyQueries.store());
          void queryClient.prefetchQuery(
            product.collectionQueries.list(
              product.normalizeCollectionListParams({}),
            ),
          );
          void queryClient.prefetchQuery(product.productTaxonomyQueries.list());
          void queryClient.prefetchQuery(
            product.productOptionQueries.list(
              product.normalizeProductOptionListParams(),
            ),
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
        prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
          if (!params.id) return;
          const { productQueries } = await import("@queries/product.queries");
          void queryClient.prefetchQuery(productQueries.detail(params.id));
        },
      },
      edit: {
        view: lazyView(
          () => import("@views/global/contents/products/detail/product-edit"),
        ),
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
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const {
              productQueries,
              collectionQueries,
              normalizeCollectionListParams,
              productTaxonomyQueries,
            } = await import("@queries/product.queries");
            void queryClient.prefetchQuery(productQueries.detail(params.id));
            // The form's three pickers: collection, type/tags, categories.
            void queryClient.prefetchQuery(
              collectionQueries.list({
                ...normalizeCollectionListParams({}),
                limit: 100,
              }),
            );
            void queryClient.prefetchQuery(productTaxonomyQueries.list());
          },
        },
        media: {
          view: lazyView(
            () =>
              import("@views/global/contents/products/detail/product-media"),
          ),
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
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const {
              productQueries,
              productOptionQueries,
              normalizeProductOptionListParams,
            } = await import("@queries/product.queries");
            void queryClient.prefetchQuery(productQueries.detail(params.id));
            // The picker offers the whole option library.
            void queryClient.prefetchQuery(
              productOptionQueries.list(normalizeProductOptionListParams()),
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
            const { productQueries, productVariantQueries } =
              await import("@queries/product.queries");
            void queryClient.prefetchQuery(productQueries.detail(params.id));
            void queryClient.prefetchQuery(
              productVariantQueries.detail(variantId),
            );
          },
        },
        "variant-edit": {
          view: lazyView(
            () =>
              import("@views/global/contents/products/detail/product-variant"),
          ),
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const [{ productQueries }, { currencyQueries }] = await Promise.all(
              [
                import("@queries/product.queries"),
                import("@queries/currency.queries"),
              ],
            );
            // Both, because the form renders a price field per store currency
            // and would otherwise show its own spinner after the chunk lands.
            void queryClient.prefetchQuery(productQueries.detail(params.id));
            void queryClient.prefetchQuery(currencyQueries.store());
          },
        },
        "variant-metadata": {
          view: lazyView(
            () =>
              import("@views/global/contents/products/detail/product-variant-metadata"),
          ),
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
        attributes: {
          view: lazyView(
            () =>
              import("@views/global/contents/products/detail/product-attributes"),
          ),
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
          prefetch: async ({ queryClient, params }: CollectionLoadContext) => {
            if (!params.id) return;
            const { productQueries } = await import("@queries/product.queries");
            void queryClient.prefetchQuery(productQueries.detail(params.id));
          },
        },
      },
      index: {
        view: lazyView(() => import("@views/global/contents/products")),
        prefetch: async ({ queryClient, search }: CollectionLoadContext) => {
          const { productQueries, normalizeProductListParams } =
            await import("@queries/product.queries");
          // Prefetch with the same params the view normalizes to, so the loader
          // primes the exact cache entry the component reads.
          void queryClient.prefetchQuery(
            productQueries.list(normalizeProductListParams(search)),
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
          },
          detail: {
            view: lazyView(
              () =>
                import("@views/global/contents/products/collections/collection-detail"),
            ),
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
            // The parent picker lists the whole category tree.
            prefetch: async ({ queryClient }: CollectionLoadContext) => {
              const { productTaxonomyQueries } =
                await import("@queries/product.queries");
              void queryClient.prefetchQuery(productTaxonomyQueries.list());
            },
          },
          detail: {
            view: lazyView(
              () =>
                import("@views/global/contents/products/categories/category-detail"),
            ),
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
          create: {
            view: lazyView(
              () =>
                import("@views/global/contents/products/inventory/inventory-create"),
            ),
          },
          index: {
            view: lazyView(
              () => import("@views/global/contents/products/inventory"),
            ),
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
          },
          detail: {
            view: lazyView(
              () =>
                import("@views/global/contents/products/options/option-detail"),
            ),
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
        // Both variants render the destination `folder-select`, which lists the
        // whole folder tree.
        prefetch: async ({ queryClient }: CollectionLoadContext) => {
          const { assetQueries } = await import("@queries/asset.queries");
          void queryClient.prefetchQuery(assetQueries.folders());
        },
      },
      preview: {
        view: lazyView(
          () => import("@views/global/contents/assets/asset-preview"),
        ),
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
          void queryClient.prefetchQuery(assetQueries.folders());
        },
      },
    },
  ],
};
