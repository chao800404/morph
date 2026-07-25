/**
 * Cap for fanning out per-item database work.
 *
 * A bare `Promise.all(items.map(...))` opens one query per selected item, so a
 * bulk action on a large selection can exhaust the request's D1 budget. Wrap
 * those loops in `pLimit(DB_FANOUT_CONCURRENCY)` instead — the value matches
 * the cap the ZIP download already used for its R2 fetches, so bulk operations
 * behave consistently.
 */
export const DB_FANOUT_CONCURRENCY = 5;
