import type { CollectionLoadContext } from "@/lib/config/create-config";
import { CurrencyAddPendingView } from "@views/settings/store/currency-add-skeleton";
import { lazyView } from "@/lib/config/lazy-view";

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
        view: lazyView(() => import("@views/settings/store")),
        prefetch: async ({ queryClient }: CollectionLoadContext) => {
          const { currencyQueries } =
            await import("@queries/currency.queries");
          await queryClient.prefetchQuery(currencyQueries.store());
        },
      },
      create: {
        label: "Add currencies",
        view: lazyView(() => import("@views/settings/store/currency-add")),
        pendingView: CurrencyAddPendingView,
        prefetch: async ({ queryClient }: CollectionLoadContext) => {
          const { currencyQueries } = await import("@queries/currency.queries");
          // The table lists every currency and ticks the enabled ones.
          void queryClient.prefetchQuery(currencyQueries.store());
          void queryClient.prefetchQuery(currencyQueries.available());
        },
      },
      edit: {
        view: lazyView(() => import("@views/settings/store/store-edit")),
        prefetch: async ({ queryClient }: CollectionLoadContext) => {
          const { currencyQueries } = await import("@queries/currency.queries");
          void queryClient.prefetchQuery(currencyQueries.store());
        },
      },
    },
    {
      title: "Users",
      slug: "users",
      icon: "UsersRound",
      label: "Users",
      index: {
        view: lazyView(() => import("@views/settings/users")),
      },
    },
  ],
};
