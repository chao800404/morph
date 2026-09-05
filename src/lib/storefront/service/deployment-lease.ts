/**
 * Mutual exclusion over a storefront's deployments.
 *
 * The activation CAS guards one write — the moment `active_release_id` moves —
 * and the deploy that follows sits outside it. Two publishes therefore
 * interleave: A claims the pointer and stalls uploading, B reads the pointer A
 * just wrote, passes its own CAS on that value, deploys and finishes, then A's
 * upload lands. The pointer names B's release and the Worker runs A's. Nothing
 * fails, and nothing in D1 records the disagreement.
 *
 * Fencing the deploy sink would be the other answer, but the sink is
 * Cloudflare's Worker upload API and it will not reject a stale writer. So the
 * exclusion has to happen before the deploy starts.
 */

/** Diagnostic stale threshold, never permission for a second upload. */
export const DEPLOYMENT_LEASE_TTL_MS = 10 * 60 * 1000;

export type DeploymentLeasePorts = Readonly<{
  /**
   * Claims the storefront's deployment slot, returning whether it was taken.
   *
   * Must be a single conditional write: reading the current holder and then
   * overwriting it reintroduces exactly the race this exists to close.
   * An existing owner MUST NOT be displaced even past expiresAt: the external
   * deployment sink cannot fence it. Crashed holders need verified recovery.
   */
  acquire(args: {
    storefrontId: string;
    owner: string;
    expiresAt: number;
    now: number;
  }): Promise<boolean>;
  /** Releases only if still held by `owner`, so an expired holder cannot. */
  release(args: { storefrontId: string; owner: string }): Promise<void>;
}>;

export type DeploymentLeaseResult<T> =
  { acquired: true; value: T } | { acquired: false };

/**
 * Runs `operation` while holding the storefront's deployment lease.
 *
 * The lease is released even when the operation throws: a deployment that
 * settles still has to hand the storefront back. A process crash instead
 * leaves the owner in place, deliberately blocking until verified recovery.
 */
export async function withDeploymentLease<T>({
  storefrontId,
  owner,
  ports,
  now = Date.now(),
  ttlMs = DEPLOYMENT_LEASE_TTL_MS,
  operation,
}: {
  storefrontId: string;
  owner: string;
  ports: DeploymentLeasePorts;
  now?: number;
  ttlMs?: number;
  operation: () => Promise<T>;
}): Promise<DeploymentLeaseResult<T>> {
  const acquired = await ports.acquire({
    storefrontId,
    owner,
    expiresAt: now + ttlMs,
    now,
  });
  if (!acquired) return { acquired: false };

  try {
    return { acquired: true, value: await operation() };
  } finally {
    await ports.release({ storefrontId, owner });
  }
}
