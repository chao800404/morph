import type { CollectionLoadContext } from "@/lib/config/create-config";
import { lazyView } from "@/lib/config/lazy-view";
import { AssetsPageSkeleton } from "@views/global/contents/assets/component/assets-card-skeleton";

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
            import(
              "@views/global/contents/products/create/product-create-wizard"
            ),
        ),
      },
      detail: {
        view: lazyView(() => import("@views/global/contents/products/detail")),
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
      },
      // One page per card on the detail view. Each replaces a whole link set,
      // so they cannot be merged into the details form without clearing what
      // that form does not render.
      pages: {
        organization: {
          view: lazyView(
            () =>
              import(
                "@views/global/contents/products/detail/product-organization"
              ),
          ),
        },
        media: {
          view: lazyView(
            () => import("@views/global/contents/products/detail/product-media"),
          ),
        },
        // Which variant is `?variantId`: the page names the surface, the search
        // param names the record inside it.
        variant: {
          view: lazyView(
            () =>
              import("@views/global/contents/products/detail/product-variant"),
          ),
        },
        metadata: {
          view: lazyView(
            () =>
              import("@views/global/contents/products/detail/product-metadata"),
          ),
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
                import(
                  "@views/global/contents/products/collections/collection-create"
                ),
            ),
          },
          detail: {
            view: lazyView(
              () =>
                import(
                  "@views/global/contents/products/collections/collection-detail"
                ),
            ),
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
                import(
                  "@views/global/contents/products/collections/collection-edit"
                ),
            ),
          },
          pages: {
            metadata: {
              view: lazyView(
                () =>
                  import(
                    "@views/global/contents/products/collections/collection-metadata"
                  ),
              ),
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
          slug: "product-categories",
          label: "Categories",
          create: {
            view: lazyView(
              () =>
                import(
                  "@views/global/contents/products/categories/category-create"
                ),
            ),
          },
          detail: {
            view: lazyView(
              () =>
                import(
                  "@views/global/contents/products/categories/category-detail"
                ),
            ),
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
                import(
                  "@views/global/contents/products/categories/category-edit"
                ),
            ),
          },
          pages: {
            metadata: {
              view: lazyView(
                () =>
                  import(
                    "@views/global/contents/products/categories/category-metadata"
                  ),
              ),
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
                import(
                  "@views/global/contents/products/inventory/inventory-create"
                ),
            ),
          },
          index: {
            view: lazyView(
              () => import("@views/global/contents/products/inventory"),
            ),
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
          },
          pages: {
            metadata: {
              view: lazyView(
                () =>
                  import(
                    "@views/global/contents/products/options/option-metadata"
                  ),
              ),
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
        view: lazyView(() => import("@views/global/contents/assets/asset-edit")),
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
