import { storefrontThemeSyncCapabilityDal } from "@/lib/storefront/dal/storefront-theme-sync-capability.dal";
import { themeSourceStore } from "@/lib/storefront/storage/theme-storage.server";
import { handleThemeSyncRequest } from "@/server/storefront/theme-sync-api";
import { createFileRoute } from "@tanstack/react-router";

const handle = ({ request }: { request: Request }) =>
  handleThemeSyncRequest(request, {
    dal: storefrontThemeSyncCapabilityDal,
    getSourceGeneration: (...args) =>
      themeSourceStore.getSourceGeneration(...args),
    getWorkspaceSnapshot: (...args) =>
      themeSourceStore.getWorkspaceSnapshot(...args),
    saveFilesBatch: (...args) => themeSourceStore.saveFilesBatch(...args),
  });

/** `morph-sync`'s API; see `theme-sync-api.ts`. */
export const Route = createFileRoute("/_backend/api/storefront/theme-sync/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
    },
  },
});
