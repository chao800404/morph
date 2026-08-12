/**
 * Shared client-side cache policy for dashboard navigation and server data.
 *
 * A short freshness window makes back/forward navigation instant. Once data is
 * stale, TanStack Router and Query keep rendering the cached result while they
 * revalidate it in the background (stale-while-revalidate).
 */
export const DASHBOARD_CACHE_STALE_TIME = 30_000;

/** Keep inactive route/query data available for normal dashboard navigation. */
export const DASHBOARD_CACHE_GC_TIME = 5 * 60_000;
