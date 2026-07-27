import type { CollectionLoadContext } from "@/lib/config/create-config";
import { AssetsPageSkeleton } from "@views/global/contents/assets/component/assets-card-skeleton";
import { lazy } from "react";

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
        view: lazy(() =>
          import("@views/global/contents/products/create/product-create-wizard").then(
            (m) => ({ default: m.ProductCreateWizard }),
          ),
        ),
      },
      detail: {
        view: lazy(() => import("@views/global/contents/products/detail")),
      },
      index: {
        view: lazy(() => import("@views/global/contents/products")),
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
            view: lazy(() =>
              import("@views/global/contents/products/collections/collection-create").then(
                (m) => ({ default: m.CollectionCreate }),
              ),
            ),
          },
          edit: {
            view: lazy(() =>
              import("@views/global/contents/products/collections/collection-edit").then(
                (m) => ({ default: m.CollectionEdit }),
              ),
            ),
          },
          index: {
            view: lazy(
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
            view: lazy(() =>
              import("@views/global/contents/products/categories/category-create").then(
                (m) => ({ default: m.CategoryCreate }),
              ),
            ),
          },
          detail: {
            view: lazy(() =>
              import("@views/global/contents/products/categories/category-detail").then(
                (m) => ({ default: m.CategoryDetail }),
              ),
            ),
            prefetch: async ({
              queryClient,
              params,
            }: CollectionLoadContext) => {
              if (!params.id) return;
              const { productCategoryQueries } = await import(
                "@queries/product.queries"
              );
              void queryClient.prefetchQuery(
                productCategoryQueries.detail(params.id),
              );
            },
          },
          edit: {
            view: lazy(() =>
              import("@views/global/contents/products/categories/category-edit").then(
                (m) => ({ default: m.CategoryEdit }),
              ),
            ),
          },
          index: {
            view: lazy(
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
            view: lazy(() =>
              import("@views/global/contents/products/inventory/inventory-create").then(
                (m) => ({ default: m.InventoryCreate }),
              ),
            ),
          },
          index: {
            view: lazy(
              () => import("@views/global/contents/products/inventory"),
            ),
          },
        },
        {
          title: "Options",
          slug: "product-options",
          label: "Options",
          create: {
            view: lazy(() =>
              import("@views/global/contents/products/options/option-create").then(
                (m) => ({ default: m.OptionCreate }),
              ),
            ),
          },
          edit: {
            view: lazy(() =>
              import("@views/global/contents/products/options/option-edit").then(
                (m) => ({ default: m.OptionEdit }),
              ),
            ),
          },
          index: {
            view: lazy(() => import("@views/global/contents/products/options")),
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
        view: lazy(() =>
          import("@views/global/contents/assets/asset-create").then((m) => ({
            default: m.AssetCreate,
          })),
        ),
      },
      preview: {
        view: lazy(() =>
          import("@views/global/contents/assets/asset-preview").then((m) => ({
            default: m.AssetPreview,
          })),
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
        view: lazy(() =>
          import("@views/global/contents/assets/asset-edit").then((m) => ({
            default: m.AssetEdit,
          })),
        ),
        prefetch: prefetchAssetItem,
      },
      index: {
        view: lazy(() => import("@views/global/contents/assets")),
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
