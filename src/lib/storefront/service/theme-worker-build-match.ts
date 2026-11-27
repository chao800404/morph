/**
 * Release/Worker build match (render plan v2 step 1, PR 3; dormant).
 *
 * Core reaches a storefront's Theme Worker through one stable service
 * binding, and states the release and build it resolved in request headers.
 * The binding answers with whichever Worker version is deployed, so during a
 * deploy swap, or after a failed deploy, release B's request can reach build
 * A's code: stale HTML, or a POST run by the wrong Theme.
 *
 * The check has two halves, one contract:
 *
 * - **Worker.** When the switch is on, the deployer makes a Morph-owned
 *   module the Worker's `main` (`themeBuildMatchModuleSource`). It reads the
 *   build id the deployer wrote into the Worker's own vars and compares it
 *   with the id Core expects, before any Theme handler runs. A mismatch is a
 *   non-cacheable 503 and the Theme is never invoked. A request without
 *   Core's expectation passes through untouched, so the module enforces only
 *   while Core asks it to.
 * - **Core.** When the switch is on, Core sends its expectation on every
 *   request, reads the Worker's refusal as a runtime mismatch (logged, never
 *   cached), and, for a release whose last deploy installed the module,
 *   refuses an answer that does not confirm the build: such an answer came
 *   from a Worker without the module, which cannot have checked.
 *
 * Off (the default), the deployer writes the deploy config byte for byte as
 * before, Core sends and reads nothing new, and a Worker that already carries
 * the module passes every request through unchanged.
 */

import { isProductionEnvironment } from "./storefront-domain-provider";

/** The Worker var holding the build id the Worker was deployed with. */
export const THEME_BUILD_ID_VAR = "MORPH_THEME_BUILD_ID";

/** Core to Worker: the build id Core resolved for this request. */
export const EXPECTED_THEME_BUILD_HEADER = "x-morph-expected-theme-build-id";

/** Worker to Core: the build id that checked and served this request. */
export const SERVED_THEME_BUILD_HEADER = "x-morph-served-theme-build-id";

/** Worker to Core: set only on the module's own refusal. */
export const THEME_BUILD_MISMATCH_HEADER = "x-morph-theme-build-mismatch";

/**
 * The module's path in the deployed Worker's module graph. A build output
 * holding a file at this path is refused rather than overwritten.
 */
export const THEME_BUILD_MATCH_MODULE = "__morph_build_match.mjs";

/** How long a shopper's client is told to wait out a deploy swap. */
export const THEME_BUILD_MISMATCH_RETRY_AFTER_SECONDS = 5;

/** The server env var that turns the check on. */
export const RELEASE_WORKER_MATCH_ENV = "MORPH_RELEASE_WORKER_MATCH";

/**
 * Whether the check is on: only when the server sets
 * `MORPH_RELEASE_WORKER_MATCH=1`, and never in production until the native
 * build is enabled there (render plan v2 step 1, PR 6), the same rule as
 * `MORPH_NATIVE_START_BUILD` (`nativeStartBuildEnabled`). Deployer and Core
 * read the same value, so one switch decides both halves.
 */
export function releaseWorkerMatchEnabled(
  bindings: Record<string, unknown> | undefined,
): boolean {
  return (
    bindings?.[RELEASE_WORKER_MATCH_ENV] === "1" &&
    !isProductionEnvironment(bindings)
  );
}

/**
 * Source of the Morph-owned Worker entry wrapping the build's own entry.
 *
 * Platform code, constant but for the entry's path; never Theme code. It
 * re-exports everything the build's entry exports, and its default export is
 * the build's handler with `fetch` wrapped.
 */
export function themeBuildMatchModuleSource(mainModule: string): string {
  const entry = JSON.stringify(`./${mainModule}`);
  const expected = JSON.stringify(EXPECTED_THEME_BUILD_HEADER);
  const served = JSON.stringify(SERVED_THEME_BUILD_HEADER);
  const mismatch = JSON.stringify(THEME_BUILD_MISMATCH_HEADER);
  const variable = JSON.stringify(THEME_BUILD_ID_VAR);
  const retryAfter = JSON.stringify(
    String(THEME_BUILD_MISMATCH_RETRY_AFTER_SECONDS),
  );
  return `// Morph release/Worker build match. Written by Morph's deployer; not Theme code.
import * as themeEntry from ${entry};
export * from ${entry};

const theme = themeEntry.default;

function refuse() {
  return new Response("Theme Worker build mismatch.", {
    status: 503,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": ${retryAfter},
      "X-Content-Type-Options": "nosniff",
      [${mismatch}]: "1",
    },
  });
}

function confirm(response, deployed) {
  if (!(response instanceof Response)) return response;
  try {
    response.headers.set(${served}, deployed);
    return response;
  } catch {}
  if (response.status === 101 || response.webSocket) return response;
  const headers = new Headers(response.headers);
  headers.set(${served}, deployed);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  ...theme,
  async fetch(request, env, ctx) {
    const expected = request.headers.get(${expected});
    if (expected === null) return theme.fetch(request, env, ctx);
    const deployed =
      env && typeof env[${variable}] === "string" ? env[${variable}] : "";
    if (deployed === "" || expected !== deployed) return refuse();
    const headers = new Headers(request.headers);
    headers.delete(${expected});
    return confirm(
      await theme.fetch(new Request(request, { headers }), env, ctx),
      deployed,
    );
  },
};
`;
}

export type ThemeWorkerBuildMismatchCode =
  /** The Worker's module refused: it carries another build. Theme not run. */
  | "WORKER_BUILD_MISMATCH"
  /** The Worker confirmed another build than Core expected. */
  | "WORKER_BUILD_CONFIRMED_OTHER"
  /**
   * The release's last deploy installed the module, but the answer carries
   * no confirmation: a Worker without the module answered, and the Theme ran.
   */
  | "WORKER_BUILD_UNCONFIRMED";

export type ThemeWorkerBuildVerdict =
  | { ok: true; response: Response }
  | { ok: false; code: ThemeWorkerBuildMismatchCode };

/**
 * Core's reading of a Theme Worker's answer while the check is on.
 *
 * `releaseMarked` says the release's last successful deploy installed the
 * module (`readDeployedThemeBuildMatchId`). An unmarked release accepts an
 * answer without confirmation: it was deployed before the check, or with the
 * switch off, so its Worker may legitimately lack the module.
 *
 * A passing answer has the confirmation header removed; nothing else changes.
 */
export function verifyThemeWorkerBuild(args: {
  response: Response;
  expectedThemeBuildId: string;
  releaseMarked: boolean;
}): ThemeWorkerBuildVerdict {
  const { response } = args;
  if (
    response.status === 503 &&
    response.headers.get(THEME_BUILD_MISMATCH_HEADER) !== null
  ) {
    return { ok: false, code: "WORKER_BUILD_MISMATCH" };
  }
  const served = response.headers.get(SERVED_THEME_BUILD_HEADER);
  if (served !== null && served !== args.expectedThemeBuildId) {
    return { ok: false, code: "WORKER_BUILD_CONFIRMED_OTHER" };
  }
  if (served === null) {
    if (args.releaseMarked) return { ok: false, code: "WORKER_BUILD_UNCONFIRMED" };
    return { ok: true, response };
  }
  return { ok: true, response: withoutServedBuildHeader(response) };
}

function withoutServedBuildHeader(response: Response): Response {
  // A WebSocket upgrade cannot be rebuilt; its confirmation is left on.
  if (
    response.status === 101 ||
    (response as { webSocket?: unknown }).webSocket
  ) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.delete(SERVED_THEME_BUILD_HEADER);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
