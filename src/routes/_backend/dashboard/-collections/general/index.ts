import type { CollectionLoadContext } from "@/lib/config/create-config";
import { CurrencyAddPendingView } from "@views/settings/store/currency-add-skeleton";
import { lazy } from "react";

export const General = {
  slug: "settings",
  title: "General",
  collections: [
    {
      title: "Store",
      slug: "store",
      icon: "Store",
      label: "Store",
      index: {
        view: lazy(() => import("@views/settings/store")),
        prefetch: async ({ queryClient }: CollectionLoadContext) => {
          const { currencyQueries } =
            await import("@queries/currency.queries");
          await queryClient.prefetchQuery(currencyQueries.store());
        },
      },
      create: {
        label: "Add currencies",
        view: lazy(() => import("@views/settings/store/currency-add")),
        pendingView: CurrencyAddPendingView,
      },
      edit: {
        view: lazy(() => import("@views/settings/store/store-edit")),
      },
    },
    {
      title: "Users",
      slug: "users",
      icon: "UsersRound",
      label: "Users",
      index: {
        view: lazy(() => import("@views/settings/users")),
      },
    },
  ],
};
