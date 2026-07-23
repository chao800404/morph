import { assetQueries } from "@queries/asset.queries";
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
      loadData: async ({
        queryClient,
        search,
      }: {
        queryClient: any;
        search: any;
      }) => {
        await Promise.all([
          queryClient.ensureQueryData(assetQueries.list(search)),
          queryClient.ensureQueryData(assetQueries.folders()),
        ]);
      },
    },
  ],
};
