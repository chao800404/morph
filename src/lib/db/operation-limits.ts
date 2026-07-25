import type { CloudflarePlan } from "@/lib/config/create-config";

/**
 * Ceilings for how much one bulk operation may touch.
 *
 * These are deliberately **not** Zod rules. Zod validates the request before any
 * database access, so it can only cap how many items the caller selected — it
 * cannot know that one selected folder contains 5,000 files. The real cost is
 * only known after descendants are resolved, so the check runs in the handler,
 * after expansion and before the first write.
 *
 * Sizing comes from the Workers per-invocation budget, which differs by an
 * order of magnitude between plans:
 *
 * - Free: 50 external subrequests, 1,000 to Cloudflare services.
 * - Paid: 10,000 by default, raisable via `limits.subrequests` in Wrangler.
 *
 * R2, D1 and KV binding calls all count. Archiving one asset costs three R2
 * calls (`get` + `put` + `delete`).
 *
 * The presets stay well under those ceilings because subrequests are rarely the
 * first thing to run out: streaming file bodies burns CPU time, and the free
 * plan's CPU allowance is far tighter than its subrequest allowance. Raise them
 * only against measurements from a real deployment.
 *
 * Cloudflare exposes no runtime API for the account plan, so it is declared in
 * `cms.config.ts` rather than detected.
 */
interface BulkOperationLimits {
  maxAssets: number;
  maxFolders: number;
}

const LIMITS_BY_PLAN: Record<CloudflarePlan, BulkOperationLimits> = {
  // ~75 R2 calls, comfortably inside the tighter CPU allowance too.
  free: { maxAssets: 25, maxFolders: 100 },
  // ~600 R2 calls against a 10,000 budget.
  paid: { maxAssets: 200, maxFolders: 500 },
};

/** Defaults to the paid presets when the config omits a plan. */
export const bulkOperationLimits = (
  plan: CloudflarePlan = "paid",
): BulkOperationLimits => LIMITS_BY_PLAN[plan];
