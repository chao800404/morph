/**
 * Release/Worker build match (render plan v2 step 1, PR 3; dormant).
 *
 * Core reaches a storefront's Theme Worker through one stable service
 * binding, and states the release and build it resolved in request headers.
 * The binding answers with whichever Worker version is deployed, so during a
 * deploy swap, or after a failed deploy, release B's request can reach build
 * A's code: stale HTML, or a POST run by the wrong Theme.
 *
 * The check is a refusal that happens before any Theme code handles the
 * request, and nothing else:
 *
 * - **Worker.** When the switch is on, the deployer makes a Morph-owned
 *   module the Worker's `main` (`themeBuildMatchModuleSource`), writes the
 *   build id into the Worker's vars, and routes every request through the
 *   Worker first (`assets.run_worker_first`), so the old build's static
 *   assets cannot answer either. The module compares the deployed build id
 *   with the one Core expects and, on a mismatch, answers a non-cacheable 503
 *   without loading or invoking the Theme. A request without Core's
 *   expectation passes through untouched.
 * - **Core.** When the switch is on, Core sends its expectation on every
 *   request and reads the module's refusal as a runtime mismatch (logged,
 *   never cached).
 *
 * Threat model. The module runs in the same isolate as Theme code, so it
 * holds only against what Theme code can do *after* the module has read what
 * it needs. It therefore reads the build id and captures every intrinsic it
 * uses before the Theme's entry is first imported (lazily, on the first
 * request it lets through), and never trusts anything the Theme can write
 * afterwards. It sends no positive confirmation back: anything the module
 * could send, Theme code in the same isolate could send too, so Core never
 * accepts an answer *because* of a header. What Core learns is only the
 * refusal, which a Theme could at most forge against itself. A Worker
 * deployed without the module (before the check, or with the switch off)
 * cannot be told apart and is served as before; see the PR body's
 * transition table.
 *
 * Off (the default, and always in production until PR 6), the deployer
 * writes the deploy config byte for byte as before, Core sends and reads
 * nothing new, and a Worker that already carries the module passes every
 * request through.
 */
import { isProductionEnvironment } from "./storefront-domain-provider";

/** The Worker var holding the build id the Worker was deployed with. */
export const THEME_BUILD_ID_VAR = "MORPH_THEME_BUILD_ID";

/** Core to Worker: the build id Core resolved for this request. */
export const EXPECTED_THEME_BUILD_HEADER = "x-morph-expected-theme-build-id";

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
 * Source of the Morph-owned Worker entry in front of the build's own entry.
 *
 * Platform code, constant but for the entry's path; never Theme code. It
 * has no static import of the build, so its own top level runs first: it
 * captures the intrinsics it uses before any Theme module is evaluated, and
 * reads the deployed build id on the first request, before it imports the
 * build. The build's entry is imported once, on the first request the module
 * lets through. Its default export may be an object with `fetch` (Start's
 * and Astro's entries) or a `WorkerEntrypoint`-style class.
 *
 * Only `fetch` is forwarded. The deploy config this module is written for
 * declares no cron triggers, queue consumers, Durable Objects or named
 * entrypoints (the Wrangler key contract refuses them), so the runtime never
 * calls any other handler or named export.
 */
export function themeBuildMatchModuleSource(mainModule: string): string {
  const entry = JSON.stringify(`./${mainModule}`);
  const expected = JSON.stringify(EXPECTED_THEME_BUILD_HEADER);
  const mismatch = JSON.stringify(THEME_BUILD_MISMATCH_HEADER);
  const variable = JSON.stringify(THEME_BUILD_ID_VAR);
  const retryAfter = JSON.stringify(
    String(THEME_BUILD_MISMATCH_RETRY_AFTER_SECONDS),
  );
  return `// Morph release/Worker build match. Written by Morph's deployer; not Theme code.
// Everything below is captured before the Theme's entry is imported.
const apply = Reflect.apply;
const HeadersC = Headers;
const RequestC = Request;
const ResponseC = Response;
const getHeader = Headers.prototype.get;
const deleteHeader = Headers.prototype.delete;
const requestHeaders = Object.getOwnPropertyDescriptor(Request.prototype, "headers").get;
const EXPECTED = ${expected};

let deployed = null;
let theme = null;

function refuse() {
  return new ResponseC("Theme Worker build mismatch.", {
    status: 503,
    headers: new HeadersC({
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": ${retryAfter},
      "X-Content-Type-Options": "nosniff",
      [${mismatch}]: "1",
    }),
  });
}

async function invoke(request, env, ctx) {
  if (theme === null) theme = import(${entry});
  const handler = (await theme).default;
  if (
    typeof handler === "function" &&
    handler.prototype &&
    typeof handler.prototype.fetch === "function"
  ) {
    return new handler(ctx, env).fetch(request);
  }
  return handler.fetch(request, env, ctx);
}

export default {
  async fetch(request, env, ctx) {
    // Read once, before the Theme is ever imported, and kept: nothing the
    // Theme later does to env changes the build this Worker was deployed with.
    if (deployed === null) {
      const value = env ? env[${variable}] : undefined;
      deployed = typeof value === "string" ? value : "";
    }
    const headers = apply(requestHeaders, request, []);
    const want = apply(getHeader, headers, [EXPECTED]);
    if (want === null) return invoke(request, env, ctx);
    if (deployed === "" || want !== deployed) return refuse();
    const forwarded = new HeadersC(headers);
    apply(deleteHeader, forwarded, [EXPECTED]);
    return invoke(new RequestC(request, { headers: forwarded }), env, ctx);
  },
};
`;
}

/** The module refused: the Worker carries another build. Theme not run. */
export type ThemeWorkerBuildMismatchCode = "WORKER_BUILD_MISMATCH";

/**
 * Core's reading of a Theme Worker's answer while the check is on: the
 * module's refusal is a mismatch, every other answer is the Theme's and
 * passes exactly as it came.
 */
export function themeWorkerBuildMismatch(
  response: Response,
): ThemeWorkerBuildMismatchCode | null {
  return response.status === 503 &&
    response.headers.get(THEME_BUILD_MISMATCH_HEADER) !== null
    ? "WORKER_BUILD_MISMATCH"
    : null;
}
