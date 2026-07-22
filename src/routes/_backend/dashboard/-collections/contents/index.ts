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
      items: [
        {
          title: "Collections",
          slug: "collections",
          label: "Collections",
        },
        {
          title: "Inventory",
          slug: "inventory",
          label: "Inventory",
        },
        {
          title: "Tags",
          slug: "tags",
          label: "Tags",
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
