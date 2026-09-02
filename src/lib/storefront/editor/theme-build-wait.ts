import type { StorefrontThemeBuildDTO } from "@/lib/storefront/dto/storefront-theme-build.dto";

/** Build states that are still going to change. */
export function isThemeBuildPending(status: string): boolean {
  return status === "queued" || status === "building";
}

export type ThemeBuildWaitOutcome =
  /** The build reached `succeeded` or `failed`. */
  | { outcome: "settled"; build: StorefrontThemeBuildDTO }
  /** The caller stopped waiting. Says nothing about the build. */
  | { outcome: "aborted"; build: StorefrontThemeBuildDTO; reason: unknown }
  /** Ran out of polls while the build was still going. Also not a failure. */
  | { outcome: "timeout"; build: StorefrontThemeBuildDTO };

export type ThemeBuildWaitArgs = {
  build: StorefrontThemeBuildDTO;
  /** Returns the current build, or null when the poll could not be read. */
  poll: (buildId: string) => Promise<StorefrontThemeBuildDTO | null>;
  signal: AbortSignal;
  maxAttempts?: number;
  /** Resolves after `ms`, or immediately once aborted. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  intervalMs?: number;
};

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Waits for a build to settle, and reports why it stopped waiting.
 *
 * The three endings are kept apart because only one of them is about the build.
 * Collapsing "we stopped looking" into a failure is what previously told an
 * author their build had failed while it was still running, with no way to pick
 * the result back up. The compiler bounds its own run, so abandoning the wait
 * cannot leave work running indefinitely.
 */
export async function waitForThemeBuild({
  build: initialBuild,
  poll,
  signal,
  maxAttempts = 30,
  sleep = defaultSleep,
  intervalMs = 1000,
}: ThemeBuildWaitArgs): Promise<ThemeBuildWaitOutcome> {
  let build = initialBuild;

  if (signal.aborted) {
    return { outcome: "aborted", build, reason: signal.reason };
  }

  let attempts = 0;
  while (isThemeBuildPending(build.status) && attempts < maxAttempts) {
    attempts++;
    await sleep(intervalMs, signal);
    if (signal.aborted) {
      return { outcome: "aborted", build, reason: signal.reason };
    }

    const polled = await poll(build.id);
    if (signal.aborted) {
      return { outcome: "aborted", build, reason: signal.reason };
    }
    // A poll that could not be read is not evidence about the build, so the
    // last known state is kept and the next attempt decides.
    if (polled) build = polled;
  }

  return isThemeBuildPending(build.status)
    ? { outcome: "timeout", build }
    : { outcome: "settled", build };
}
