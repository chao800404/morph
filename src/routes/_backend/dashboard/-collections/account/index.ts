import type { CollectionLoadContext } from "@/lib/config/create-config";
import { lazyView } from "@/lib/config/lazy-view";

export const Account = {
  slug: "settings",
  title: "My Account",
  collections: [
    {
      title: "Profile",
      slug: "profile",
      icon: "UserRoundCog",
      label: "Profile",
      index: {
        view: lazyView(() => import("@views/settings/profile")),
        prefetch: async ({ queryClient }: CollectionLoadContext) => {
          // Imported here rather than at module scope. A static import would pull
          // `auth.queries` — and through it `list-sessions.serverFn` and the auth
          // middleware — into `cms.config`'s eager graph. Server functions import
          // `get-config`, so the middleware module would then have several entry
          // points that Vite re-evaluates in parallel during HMR, and one of them
          // reads the namespace before it is bound, leaving `middleware` as
          // `undefined`. The sibling collections already import this way.
          const { sessionQueries } = await import("@queries/auth.queries");
          await queryClient.ensureQueryData(sessionQueries.list());
        },
      },
    },
  ],
};
