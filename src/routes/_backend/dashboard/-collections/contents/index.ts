import type { CollectionLoadContext } from "@/lib/config/create-config";
import { AssetsPageSkeleton } from "@views/global/contents/assets/component/assets-card-skeleton";
import { lazy } from "react";

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
      // real work, so it gets its own page.
      create: { mode: "route", to: "/dashboard/products/new" },
      component: lazy(() => import("@views/global/contents/products")),
      loadData: async ({ queryClient, search }: CollectionLoadContext) => {
        const { productQueries, normalizeProductListParams } = await import(
          "@queries/product.queries"
        );
        // Prefetch with the same params the view normalizes to, so the loader
        // primes the exact cache entry the component reads.
        void queryClient.prefetchQuery(
          productQueries.list(normalizeProductListParams(search)),
        );
      },
      items: [
        {
          title: "Collections",
          slug: "collections",
          label: "Collections",
          create: { mode: "dialog" },
          component: lazy(
            () => import("@views/global/contents/products/collections"),
          ),
          loadData: async ({ queryClient, search }: CollectionLoadContext) => {
            const { collectionQueries, normalizeCollectionListParams } =
              await import("@queries/product.queries");
            void queryClient.prefetchQuery(
              collectionQueries.list(normalizeCollectionListParams(search)),
            );
          },
        },
        {
          title: "Inventory",
          slug: "inventory",
          label: "Inventory",
          component: lazy(
            () => import("@views/global/contents/products/inventory"),
          ),
        },
        {
          title: "Options",
          slug: "options",
          label: "Options",
          create: { mode: "dialog" },
          component: lazy(
            () => import("@views/global/contents/products/options"),
          ),
          loadData: async ({ queryClient, search }: CollectionLoadContext) => {
            const {
              productOptionQueries,
              normalizeProductOptionListParams,
            } = await import("@queries/product.queries");
            void queryClient.prefetchQuery(
              productOptionQueries.list(
                normalizeProductOptionListParams(search),
              ),
            );
          },
        },
      ],
    },
    {
      title: "Assets",
      slug: "assets",
      icon: "Inbox",
      label: "Assets",
      // No `create`: uploading targets the folder currently being viewed, and
      // drag-and-drop onto the explorer is the main entry point. That control
      // belongs in the view, where the folder context lives.
      component: lazy(() => import("@views/global/contents/assets")),
      // The explorer shows a skeleton while its query runs, so the chunk wait
      // uses the same shape instead of a spinner that then swaps to a skeleton.
      loader: AssetsPageSkeleton,
      loadData: async ({ queryClient, search }: CollectionLoadContext) => {
        const { assetQueries, normalizeAssetListParams } = await import(
          "@queries/asset.queries"
        );
        // Keep the active Assets view mounted while the next folder loads.
        // The page's useQuery observes these in-flight cache entries and keeps
        // its previous result visible instead of letting the route suspend.
        void queryClient.prefetchQuery(
          assetQueries.list(normalizeAssetListParams(search)),
        );
        void queryClient.prefetchQuery(assetQueries.folders());
      },
    },
  ],
};
