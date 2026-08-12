import { viewPreloader } from "@/lib/config/lazy-view";
import { findCollection } from "@/lib/config/navigation";
import { getConfig } from "@/server/get-config";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

/** Preloads both halves of a config-backed detail route: chunk and loader. */
export const useCollectionDetailPreload = (
  slug: string,
  scope: "global" | "settings" = "global",
) => {
  const router = useRouter();
  const view = useMemo(
    () =>
      findCollection(getConfig().client.collections[scope], slug)?.detail?.view,
    [scope, slug],
  );

  return useCallback(
    (id: string) => {
      void viewPreloader(view)?.();
      if (scope === "settings") {
        void router.preloadRoute({
          to: "/dashboard/settings/$slug/$id",
          params: { slug, id },
        });
      } else {
        void router.preloadRoute({
          to: "/dashboard/$slug/$id",
          params: { slug, id },
        });
      }
    },
    [router, scope, slug, view],
  );
};
