/**
 * Stops the isolated session a build is running in.
 *
 * Cloudflare Queues cannot revoke a message that a consumer already holds, so a
 * cancel cannot work by removing queued work. What makes it take effect is
 * destroying the build's Sandbox: the session is addressed by build id, so a
 * separate request reaches the same container and ends it.
 *
 * Implementations must be safe to call for a build that never started or has
 * already finished — there is no way to know which from the outside without
 * racing the runner.
 */
export type ThemeBuildTerminator = {
  /** Destroys the session for one build. Resolves even when none exists. */
  terminate(buildId: string): Promise<void>;
};
