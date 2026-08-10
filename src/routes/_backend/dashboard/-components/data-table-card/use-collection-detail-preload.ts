import { viewPreloader } from "@/lib/config/lazy-view";
import { findCollection } from "@/lib/config/navigation";
import { getConfig } from "@/server/get-config";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

/** Preloads both halves of a config-backed detail route: chunk and loader. */
export const useCollectionDetailPreload = (slug: string) => {
  const router = useRouter();
  const view = useMemo(
    () =>
      findCollection(getConfig().client.collections.global, slug)?.detail?.view,
    [slug],
  );

  return useCallback(
    (id: string) => {
      void viewPreloader(view)?.();
      void router.preloadRoute({
        to: "/dashboard/$slug/$id",
        params: { slug, id },
      });
    },
    [router, slug, view],
  );
};
