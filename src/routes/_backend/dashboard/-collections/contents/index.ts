import type { CollectionLoadContext } from "@/lib/config/create-config";
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
          component: lazy(
            () => import("@views/global/contents/products/options"),
          ),
          loadData: async ({ queryClient, search }: CollectionLoadContext) => {
            const {
              optionTemplateQueries,
              normalizeOptionTemplateListParams,
            } = await import("@queries/product.queries");
            void queryClient.prefetchQuery(
              optionTemplateQueries.list(
                normalizeOptionTemplateListParams(search),
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
      component: lazy(() => import("@views/global/contents/assets")),
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
