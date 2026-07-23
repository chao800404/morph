import {
  assetQueries,
  normalizeAssetListParams,
} from "@queries/asset.queries";
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
      items: [
        {
          title: "Collections",
          slug: "collections",
          label: "Collections",
          component: lazy(
            () => import("@views/global/contents/products/collections"),
          ),
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
          title: "Tags",
          slug: "tags",
          label: "Tags",
          component: lazy(
            () => import("@views/global/contents/products/tags"),
          ),
        },
      ],
    },
    {
      title: "Assets",
      slug: "assets",
      icon: "Inbox",
      label: "Assets",
      component: lazy(() => import("@views/global/contents/assets")),
      loadData: ({
        queryClient,
        search,
      }: {
        queryClient: any;
        search: any;
      }) => {
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
