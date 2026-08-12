import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import {
  DASHBOARD_CACHE_GC_TIME,
  DASHBOARD_CACHE_STALE_TIME,
} from "@/lib/query/cache-policy";

// Import the generated route tree
import { routeTree } from "./routeTree.gen";

// Create a new router instance
export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DASHBOARD_CACHE_STALE_TIME,
        gcTime: DASHBOARD_CACHE_GC_TIME,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: {
      queryClient,
    },
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultStaleTime: DASHBOARD_CACHE_STALE_TIME,
    defaultPreloadStaleTime: DASHBOARD_CACHE_STALE_TIME,
    defaultGcTime: DASHBOARD_CACHE_GC_TIME,
    defaultPreloadGcTime: DASHBOARD_CACHE_GC_TIME,
    defaultStaleReloadMode: "background",
  });

  setupRouterSsrQueryIntegration({
    router,
    queryClient,
  });

  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
