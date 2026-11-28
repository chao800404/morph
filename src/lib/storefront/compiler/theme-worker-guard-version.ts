/**
 * The Web Worker guard's version (theme-worker-graph-guard.ts and the
 * worker wiring of the managed Start config, the local runner and the native
 * Astro integration), folded into the compiler identity of every build that
 * carries it, so a build records whether, and which, worker policy it was
 * built under. Change it whenever what a worker bundle may import or read
 * changes.
 *
 * wg-1 (2026-11-28): worker bundles get the import guard (first, ordered
 * "pre"), the worker bundle guard (entries, physical placement, stylesheets
 * and `new URL(…, import.meta.url)` refused or checked), and a build before
 * it held its workers to nothing.
 *
 * Short on purpose: a Start compiler version is
 * `<toolchain>+morph-sdk.<16 hex>.<hide>.<this>` and the column holds 50.
 * Kept apart from the guard so the identity can be read without loading it.
 */
export const THEME_WORKER_GUARD_VERSION = "wg-1";

/**
 * Compiler ids whose builds carry the worker guard: the managed (platform)
 * Start build and the native Astro build. The native Start build does not
 * carry it yet and is not listed.
 */
export const THEME_WORKER_GUARDED_COMPILER_IDS: ReadonlySet<string> = new Set([
  "tailwind-v4-build",
  "astro-native",
]);

/** A compiler version with the worker guard's version appended. */
export function withThemeWorkerGuardIdentity(compilerVersion: string): string {
  return `${compilerVersion}.${THEME_WORKER_GUARD_VERSION}`;
}

/**
 * The worker guard version a build records in its compiler version, or null
 * when it records none (a build from before the guard).
 */
export function buildWorkerGuardVersion(
  compilerVersion: string | null | undefined,
): string | null {
  const metadata = compilerVersion?.split("+")[1];
  if (!metadata) return null;
  return (
    metadata.split(".").find((identifier) => /^wg-\d+$/.test(identifier)) ??
    null
  );
}

/**
 * Why a build may not be published under the current worker policy, or
 * null when it may: a build of a guarded compiler that records an older
 * worker guard, or none. Its record stays as it was frozen; only a new build
 * carries the current guard.
 */
export function workerGuardPublishProblem(build: {
  compilerId: string | null | undefined;
  compilerVersion: string | null | undefined;
}): string | null {
  if (
    !build.compilerId ||
    !THEME_WORKER_GUARDED_COMPILER_IDS.has(build.compilerId)
  ) {
    return null;
  }
  const recorded = buildWorkerGuardVersion(build.compilerVersion);
  if (recorded === THEME_WORKER_GUARD_VERSION) return null;
  return `it was built under ${recorded ? `worker guard ${recorded}` : "no worker guard"}, not the current ${THEME_WORKER_GUARD_VERSION}`;
}
