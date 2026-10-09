import {
  NATIVE_PRERENDER_REFUSED_READS_PATH,
  NATIVE_PRERENDER_WITHOUT_SNAPSHOT,
  THEME_PRERENDER_CONTENT_FILE,
  answerSealedContentRead,
  type NativePrerenderContent,
} from "../compiler/theme-prerender-content";
import type {
  ThemeRouteRecord,
  ThemeRouteRegistry,
} from "../compiler/theme-route-registry";
import { normalizeRoutePath } from "../theme-template-routes";
import { nativeImportGuardPluginSource } from "./tanstack-start-native-wrapper";

/**
 * How an Astro build's prerendered pages read the build's sealed content.
 *
 * docs/astro-theme-plan.md 4.3 (A3). `@astrojs/cloudflare` prerenders inside
 * workerd, through a Vite preview server it starts with `configFile: false`,
 * so no plugin of the project's or Morph's reaches that server and the page's
 * request carries no `x-morph-content-origin`. Morph therefore:
 *
 * - starts a loopback-only **sealed content server** in the build's own Node
 *   process, from `astro:build:start` to `astro:build:done`. It answers
 *   `GET /_morph/content` from the sealed `NativePrerenderContent` only,
 *   through the same `answerSealedContentRead` Start's middleware uses, and
 *   keys each read with Core's own `normalizeRoutePath`, so a page reads what
 *   the same path serves at runtime;
 * - wraps the adapter's Worker entry in the `prerender` environment only: each
 *   prerendered page's request gets the server's origin, every read of it is
 *   recorded, and a stamp goes back to the server (workerd cannot write files);
 * - binds every record to a nonce Morph makes for the build, and fails the
 *   build from the records (`astroPrerenderRecordsFailure`), not from
 *   `astro build`'s exit code or the HTML: a Theme that catches a failed read
 *   renders its defaults and the build still exits 0.
 *
 * A read that fails also fails its page at once (fail-fast), through the
 * adapter's own `x-astro-prerender-error` path. The two defences are each
 * sufficient on their own; the build-time tests switch one off to prove it.
 *
 * Nothing here is in the deployable Worker: the wrapper is only in the
 * `prerender` environment's bundle, which Astro deletes after a successful
 * prerender, and `astroArtifactLeaks` refuses an artifact that has any of it.
 */

/** The config the build runs with: the project's, plus Morph's integration. */
export const ASTRO_WRAPPER_CONFIG_PATH = ".morph/astro.build.config.mjs";
/** Morph's build integration: content server, prerender wrapper, records. */
export const ASTRO_BUILD_INTEGRATION_PATH = ".morph/astro-build-integration.mjs";
/** One line per prerendered page whose render reached the wrapper. */
export const NATIVE_PRERENDER_STAMPS_PATH = ".morph/prerender-stamped.ndjson";
/** The pages Astro says it prerendered, and a closing line when it is done. */
export const NATIVE_PRERENDER_PAGES_PATH = ".morph/prerender-pages.ndjson";
/** In the wrapper's source, so a leak into the deployable Worker is found. */
export const ASTRO_PRERENDER_SHIM_MARKER = "__MORPH_ASTRO_PRERENDER_WRAPPER__";
/**
 * The entry `@astrojs/cloudflare` writes into its prerender Worker config
 * (`experimental.prerenderWorker.config.main`, `dist/index.js`). If an adapter
 * release changes it, the wrapper no longer applies, and the build says so
 * (`ASTRO_ADAPTER_INCOMPATIBLE`) instead of prerendering without content.
 */
export const ASTRO_PRERENDER_ENTRY = "@astrojs/cloudflare/entrypoints/server";

const STAMP_PATH = "/_morph/prerender-stamp";
const MAX_STAMP_BYTES = 256 * 1024;

/**
 * Faults the build-time tests inject, one defence at a time. Never set by a
 * caller that builds a Theme: absent, every defence is on.
 */
export type AstroPrerenderTestFaults = Readonly<{
  /** The content server answers every read with 500, or never listens. */
  contentServer?: "http-500" | "absent";
  /** The wrapper looks for another entry, as after an adapter change. */
  entry?: string;
  /** Only the records decide: no fail-fast, no in-build adapter check. */
  failFast?: false;
}>;

/** Morph's files for an Astro build, beside the project's own. */
export function astroPrerenderWorkspaceFiles(options: {
  /** The project's Astro config, workspace-relative (`astro.config.mjs`). */
  themeConfigPath: string;
  /** What the prerender may read; absent, every read is refused. */
  prerenderContent?: NativePrerenderContent;
  /** This build's nonce; every record it accepts carries it. */
  nonce: string;
  /**
   * Packages the build may import (the import guard); absent, no guard —
   * the prerender-content tests, which build a fixed Theme.
   */
  allowedPackages?: readonly string[];
  testFaults?: AstroPrerenderTestFaults;
}): readonly Readonly<{ path: string; content: string }>[] {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(options.nonce)) {
    throw new Error("ASTRO_PRERENDER_NONCE_INVALID");
  }
  return [
    {
      path: ASTRO_WRAPPER_CONFIG_PATH,
      content: astroWrapperConfigSource(options.themeConfigPath),
    },
    {
      path: ASTRO_BUILD_INTEGRATION_PATH,
      content: astroBuildIntegrationSource({
        nonce: options.nonce,
        allowedPackages: options.allowedPackages,
        testFaults: options.testFaults ?? {},
      }),
    },
    {
      path: THEME_PRERENDER_CONTENT_FILE,
      content: JSON.stringify(
        options.prerenderContent ?? NATIVE_PRERENDER_WITHOUT_SNAPSHOT,
      ),
    },
  ];
}

/**
 * The project's config, imported unchanged, with Morph's integration last.
 * Nothing of the author's is overridden; the root is the workspace, because
 * this file is not at the root.
 */
export function astroWrapperConfigSource(themeConfigPath: string): string {
  return `// Written by Morph for this build (astro-native-prerender.ts). The
// project's own config is imported unchanged; Morph adds only its
// integration, last.
import { fileURLToPath } from "node:url";
import themeConfig from ${JSON.stringify(`../${themeConfigPath}`)};
import { morphAstroBuild } from ${JSON.stringify(`./${ASTRO_BUILD_INTEGRATION_PATH.split("/").pop()}`)};

const own = (await themeConfig) ?? {};

export default {
  ...own,
  root: own.root ?? fileURLToPath(new URL("..", import.meta.url)),
  integrations: [...(own.integrations ?? []), morphAstroBuild()],
};
`;
}

/** The integration's source; reads nothing from this process at build time. */
export function astroBuildIntegrationSource(options: {
  nonce: string;
  allowedPackages?: readonly string[];
  testFaults: AstroPrerenderTestFaults;
}): string {
  const faults = options.testFaults;
  const guard = options.allowedPackages
    ? `const allowedPackages = new Set(${JSON.stringify([...new Set(options.allowedPackages)].sort())});
const workspaceRoot = root;
const importGuard = ${nativeImportGuardPluginSource()};`
    : "const importGuard = null;";
  return `// Written by Morph for this build (astro-native-prerender.ts).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const NONCE = ${JSON.stringify(options.nonce)};
const FAIL_FAST = ${JSON.stringify(faults.failFast !== false)};
const CONTENT_SERVER_FAULT = ${JSON.stringify(faults.contentServer ?? null)};
const ENTRY = ${JSON.stringify(faults.entry ?? ASTRO_PRERENDER_ENTRY)};
const ADAPTER_ENTRY = ${JSON.stringify(ASTRO_PRERENDER_ENTRY)};
const CONTENT_FILE = ${JSON.stringify(THEME_PRERENDER_CONTENT_FILE)};
const REFUSED_READS = ${JSON.stringify(NATIVE_PRERENDER_REFUSED_READS_PATH)};
const STAMPS = ${JSON.stringify(NATIVE_PRERENDER_STAMPS_PATH)};
const PAGES = ${JSON.stringify(NATIVE_PRERENDER_PAGES_PATH)};
const STAMP_PATH = ${JSON.stringify(STAMP_PATH)};
const MAX_STAMP_BYTES = ${MAX_STAMP_BYTES};
const WITHOUT_SNAPSHOT = ${JSON.stringify(NATIVE_PRERENDER_WITHOUT_SNAPSHOT)};
const VIRTUAL_ENTRY = "\\0morph-astro-prerender-entry";

// Core's own key for a content path, and the one answer every content
// server of a native build gives (theme-template-routes.ts,
// theme-prerender-content.ts), by source.
const normalizeRoutePath = (${normalizeRoutePath.toString()});
const answerSealedContentRead = (${answerSealedContentRead.toString()});

// A page path as a URL path: Astro names prerendered pages decoded ("/關於")
// and requests them encoded, as Astro.url.pathname is.
const pageKey = (page) => normalizeRoutePath(new URL(String(page), "http://astro.invalid").pathname);

const root = fs.realpathSync(process.cwd());

// Judged on where an import resolves, as Start's build judges it
// (tanstack-start-native-wrapper.ts): inside the workspace, or inside an
// approved package; Astro's virtual modules resolve to plugin-made ids.
${guard}
const record = (file, entry) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.appendFileSync(target, JSON.stringify({ nonce: NONCE, ...entry }) + "\\n");
};

function readSealed() {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, CONTENT_FILE), "utf8"));
  } catch {
    return WITHOUT_SNAPSHOT;
  }
}

function startContentServer() {
  const sealed = readSealed();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/_morph/content") {
      if (CONTENT_SERVER_FAULT === "http-500") {
        res.writeHead(500, { "content-type": "text/plain" }).end("content server fault");
        return;
      }
      const key = normalizeRoutePath(url.searchParams.get("path") || "/");
      const answer = answerSealedContentRead(sealed, key);
      if ("refused" in answer) {
        record(REFUSED_READS, { path: key, reason: answer.refused });
        res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ refused: answer.refused }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(answer.content));
      return;
    }
    if (req.method === "POST" && url.pathname === STAMP_PATH) {
      const chunks = [];
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_STAMP_BYTES) req.destroy();
        else chunks.push(chunk);
      });
      req.on("end", () => {
        let stamp;
        try {
          stamp = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          stamp = null;
        }
        if (!stamp || stamp.nonce !== NONCE || typeof stamp.path !== "string") {
          res.writeHead(400).end();
          return;
        }
        record(STAMPS, {
          path: pageKey(stamp.path),
          status: stamp.status,
          reads: stamp.reads,
          failures: stamp.failures,
          refused: stamp.refused,
          detail: stamp.detail,
        });
        res.writeHead(204).end();
      });
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

export function morphAstroBuild() {
  let server = null;
  let origin = null;
  let entryHits = 0;

  const prerenderPlugin = {
    name: "morph:astro-prerender-content",
    enforce: "pre",
    applyToEnvironment(environment) {
      return environment.name === "prerender";
    },
    resolveId(id, importer) {
      if (importer === VIRTUAL_ENTRY || id !== ENTRY) return null;
      entryHits += 1;
      return VIRTUAL_ENTRY;
    },
    load(id) {
      if (id !== VIRTUAL_ENTRY) return null;
      if (!origin) this.error("ASTRO_PRERENDER_CONTENT_SERVER_UNAVAILABLE: the sealed content server has no address.");
      return prerenderWrapperSource(origin);
    },
    buildEnd(error) {
      if (error || !FAIL_FAST || entryHits === 1) return;
      this.error(
        "ASTRO_ADAPTER_INCOMPATIBLE: the prerender Worker's entry " + JSON.stringify(ENTRY) +
          " was resolved " + entryHits + " times, not once; this @astrojs/cloudflare is not one Morph can give prerendered pages their content.",
      );
    },
  };

  return {
    name: "morph:astro-build",
    hooks: {
      "astro:config:setup": ({ updateConfig }) => {
        updateConfig({ vite: { plugins: importGuard ? [importGuard, prerenderPlugin] : [prerenderPlugin] } });
      },
      "astro:config:done": ({ config }) => {
        // Under "file" or "preserve" a prerendered page asks for its content
        // as "/about.html", a key Core never serves; mapping it would be a
        // second normalisation beside Core's, so it is refused instead.
        const format = config.build && config.build.format;
        if (format && format !== "directory") {
          throw new Error("ASTRO_BUILD_FORMAT_UNSUPPORTED: build.format " + JSON.stringify(format) + " is not supported yet; remove it from astro.config to use the default, \\"directory\\".");
        }
      },
      "astro:build:start": async () => {
        try {
          import.meta.resolve(ADAPTER_ENTRY);
        } catch {
          throw new Error("ASTRO_ADAPTER_INCOMPATIBLE: " + JSON.stringify(ADAPTER_ENTRY) + " does not resolve; the project does not build with an @astrojs/cloudflare Morph can give prerendered pages their content.");
        }
        server = await startContentServer();
        origin = "http://127.0.0.1:" + server.address().port;
        if (CONTENT_SERVER_FAULT === "absent") {
          await new Promise((resolve) => server.close(resolve));
          server = null;
        }
      },
      "astro:build:done": async ({ pages }) => {
        for (const page of pages ?? []) {
          const name = typeof page === "string" ? page : page.pathname;
          record(PAGES, { path: pageKey("/" + String(name).replace(/^\\/+/, "")) });
        }
        record(PAGES, { done: true });
        if (server) await new Promise((resolve) => server.close(resolve));
        server = null;
      },
    },
  };
}

function prerenderWrapperSource(contentOrigin) {
  return [
    'import { AsyncLocalStorage } from "node:async_hooks";',
    "import server from " + JSON.stringify(ADAPTER_ENTRY) + ";",
    "const MARKER = " + JSON.stringify(${JSON.stringify(ASTRO_PRERENDER_SHIM_MARKER)}) + ";",
    "const NONCE = " + JSON.stringify(NONCE) + ";",
    "const CONTENT_ORIGIN = " + JSON.stringify(contentOrigin) + ";",
    "const FAIL_FAST = " + JSON.stringify(FAIL_FAST) + ";",
    "const STAMP_PATH = " + JSON.stringify(STAMP_PATH) + ";",
    "(" + prerenderWrapper.toString() + ")();",
    "export default globalThis[Symbol.for(MARKER)];",
  ].join("\\n");
}

// Runs in the prerender Worker, from the wrapper's own constants.
function prerenderWrapper() {
  const pageScope = new AsyncLocalStorage();
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async function morphPrerenderFetch(input, init) {
    const scope = pageScope.getStore();
    if (!scope) return realFetch(input, init);
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== CONTENT_ORIGIN || url.pathname !== "/_morph/content") {
      // Only so the error says what happened; isolating the build is the
      // container's job (docs/astro-theme-plan.md 7.1).
      scope.blocked.push(url.origin);
      throw new Error("morph prerender: a request to " + url.origin + " is not allowed while prerendering");
    }
    const read = { path: url.searchParams.get("path"), outcome: "pending", status: null };
    scope.reads.push(read);
    let response;
    try {
      response = await realFetch(request);
    } catch (error) {
      read.outcome = "connect-failed";
      read.error = String((error && error.message) || error);
      throw error;
    }
    read.status = response.status;
    if (response.status === 404) read.outcome = "refused";
    else if (!response.ok) read.outcome = "non-2xx";
    else {
      try {
        await response.clone().json();
        read.outcome = "ok";
      } catch {
        read.outcome = "unparseable";
      }
    }
    return response;
  };
  globalThis[Symbol.for(MARKER)] = {
    async fetch(request, env, ctx) {
      const { pathname } = new URL(request.url);
      if (request.method !== "POST" || pathname !== "/__astro_prerender") {
        return server.fetch(request, env, ctx);
      }
      const body = await request.text();
      let page;
      try {
        page = new URL(JSON.parse(body).url).pathname;
      } catch {
        page = null;
      }
      const headers = new Headers(request.headers);
      headers.set("x-morph-content-origin", CONTENT_ORIGIN);
      const scope = { reads: [], blocked: [] };
      const response = await pageScope.run(scope, () =>
        server.fetch(new Request(request.url, { method: "POST", headers, body }), env, ctx),
      );
      const failed = scope.reads.filter((read) => read.outcome !== "ok" && read.outcome !== "refused");
      const refused = scope.reads.filter((read) => read.outcome === "refused");
      let stampError = null;
      if (page === null) stampError = "the prerender request names no page";
      else {
        try {
          const sent = await realFetch(CONTENT_ORIGIN + STAMP_PATH, {
            method: "POST",
            body: JSON.stringify({
              nonce: NONCE,
              path: page,
              status: response.status,
              reads: scope.reads.length,
              failures: failed.length,
              refused: refused.length,
              detail: scope.reads.slice(0, 20),
            }),
          });
          if (sent.status !== 204) stampError = "the content server answered the stamp with " + sent.status;
        } catch (error) {
          stampError = String((error && error.message) || error);
        }
      }
      if (FAIL_FAST && (stampError || failed.length || refused.length)) {
        const reasons = scope.reads
          .filter((read) => read.outcome !== "ok")
          .map((read) =>
            read.outcome === "non-2xx"
              ? "non-2xx " + read.status + " for " + read.path
              : read.outcome + " for " + read.path,
          );
        if (stampError) reasons.push("stamp-lost: " + stampError);
        const message = "MORPH_PRERENDER_CONTENT_FAILED " + page + ": " + reasons.join("; ");
        return new Response(message, { status: 500, headers: { "x-astro-prerender-error": message } });
      }
      return response;
    },
  };
}
`;
}

/** A failed Astro prerender, by the records alone. */
export type AstroPrerenderFailure = Readonly<{ code: string; message: string }>;

type PrerenderRecord = Record<string, unknown> & { nonce?: unknown };

function readRecords(
  outputs: ReadonlyMap<string, Uint8Array | string>,
  file: string,
  nonce: string,
): { records: PrerenderRecord[]; invalid: number } | null {
  const raw = outputs.get(file);
  if (raw === undefined) return null;
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  const records: PrerenderRecord[] = [];
  let invalid = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        (parsed as PrerenderRecord).nonce === nonce
      ) {
        records.push(parsed as PrerenderRecord);
      } else invalid += 1;
    } catch {
      invalid += 1;
    }
  }
  return { records, invalid };
}

function refusedReadsFailure(
  refused: readonly PrerenderRecord[],
): AstroPrerenderFailure {
  const reasons = new Map<string, string>();
  for (const read of refused) {
    const path = String(read.path);
    if (!reasons.has(path)) reasons.set(path, String(read.reason));
  }
  const detail = [...reasons]
    .slice(0, 10)
    .map(([path, reason]) => `${path} (${reason})`)
    .join(", ");
  return {
    code: "NATIVE_PRERENDER_CONTENT_UNAVAILABLE",
    message: `NATIVE_PRERENDER_CONTENT_UNAVAILABLE: prerendering read Morph content this build has not sealed: ${detail}. Build from the editor so the content is sealed with the build, or stop prerendering pages that read content.`,
  };
}

/**
 * Whether a build that stopped early — fail-fast ends it at the first failed
 * read, before any page list exists — stopped on a refused read of this
 * build's: `NATIVE_PRERENDER_CONTENT_UNAVAILABLE`, or null. A torn record
 * or one of another build is not evidence of anything, so it is null too.
 */
export function astroRefusedReadsFailure(
  outputs: ReadonlyMap<string, Uint8Array | string>,
  nonce: string,
): AstroPrerenderFailure | null {
  const refused = readRecords(
    outputs,
    NATIVE_PRERENDER_REFUSED_READS_PATH,
    nonce,
  );
  if (!refused || refused.invalid > 0 || refused.records.length === 0) {
    return null;
  }
  return refusedReadsFailure(refused.records);
}

/**
 * Whether an Astro build's prerender read only sealed content, from the
 * records its content server wrote, bound to this build's nonce.
 *
 * - a refused read: `NATIVE_PRERENDER_CONTENT_UNAVAILABLE`;
 * - a read that failed (no connection, non-2xx, unparseable):
 *   `NATIVE_PRERENDER_CONTENT_READ_FAILED` — the page may have rendered its
 *   defaults and the build exited 0;
 * - a prerendered page without a stamp, or stamps that are not exactly the
 *   prerendered pages: `NATIVE_PRERENDER_CONTENT_ORIGIN_MISSING`. A page that
 *   reads nothing needs no read, only its stamp: the stamp is the one proof
 *   the content origin reached it. A content server that was never there
 *   loses the stamps too, so this also covers it;
 * - a record missing, torn, or of another nonce: `NATIVE_PRERENDER_RECORD_INVALID`.
 */
export function astroPrerenderRecordsFailure(
  outputs: ReadonlyMap<string, Uint8Array | string>,
  nonce: string,
): AstroPrerenderFailure | null {
  const fail = (code: string, detail: string): AstroPrerenderFailure => ({
    code,
    message: `${code}: ${detail}`,
  });
  const pages = readRecords(outputs, NATIVE_PRERENDER_PAGES_PATH, nonce);
  const stamps = readRecords(outputs, NATIVE_PRERENDER_STAMPS_PATH, nonce) ?? {
    records: [],
    invalid: 0,
  };
  const refused = readRecords(
    outputs,
    NATIVE_PRERENDER_REFUSED_READS_PATH,
    nonce,
  ) ?? { records: [], invalid: 0 };
  if (!pages || !pages.records.some((entry) => entry.done === true)) {
    return fail(
      "NATIVE_PRERENDER_RECORD_INVALID",
      "the build did not record which pages it prerendered.",
    );
  }
  const invalid = pages.invalid + stamps.invalid + refused.invalid;
  if (invalid > 0) {
    return fail(
      "NATIVE_PRERENDER_RECORD_INVALID",
      `${invalid} prerender record(s) are torn or belong to another build.`,
    );
  }
  if (refused.records.length > 0) return refusedReadsFailure(refused.records);
  const failed = stamps.records.filter(
    (stamp) => typeof stamp.failures !== "number" || stamp.failures > 0,
  );
  if (failed.length > 0) {
    return fail(
      "NATIVE_PRERENDER_CONTENT_READ_FAILED",
      `a content read failed while prerendering ${failed
        .slice(0, 10)
        .map((stamp) => String(stamp.path))
        .join(", ")}; the page may hold component defaults.`,
    );
  }
  const prerendered = pages.records
    .filter((entry) => entry.done !== true)
    .map((entry) => String(entry.path));
  const stamped = stamps.records.map((stamp) => String(stamp.path));
  const unstamped = prerendered.filter((path) => !stamped.includes(path));
  if (unstamped.length > 0 || stamped.length !== prerendered.length) {
    return fail(
      "NATIVE_PRERENDER_CONTENT_ORIGIN_MISSING",
      `${prerendered.length} page(s) prerendered, ${stamped.length} stamp(s) recorded${
        unstamped.length
          ? `; no stamp for ${unstamped.slice(0, 10).join(", ")}`
          : ""
      }. The content origin did not reach every prerendered page.`,
    );
  }
  return null;
}

/**
 * Anything of the prerender machinery in an Astro build's output: the
 * wrapper in the deployable server bundle, the prerender bundle directory
 * Astro leaves when prerendering fails, or Morph's records. Paths are the
 * workspace's (`dist/…`).
 */
export function astroArtifactLeaks(
  outputs: ReadonlyMap<string, Uint8Array | string>,
): readonly string[] {
  const leaks: string[] = [];
  for (const [path, content] of outputs) {
    if (!path.startsWith("dist/")) continue;
    if (path.includes("/.prerender/")) {
      leaks.push(`${path} (prerender bundle)`);
      continue;
    }
    if (path.includes(".morph/") || path.includes("prerender-stamped")) {
      leaks.push(`${path} (Morph record)`);
      continue;
    }
    const text =
      typeof content === "string" ? content : new TextDecoder().decode(content);
    if (text.includes(ASTRO_PRERENDER_SHIM_MARKER)) {
      leaks.push(`${path} (prerender wrapper)`);
    }
  }
  return leaks;
}

const PAGE_EXTENSIONS = /\.(astro|md|mdx|html|js|ts)$/;

/**
 * An Astro project's routes, from its `src/pages/` file names, in the shape
 * the sealed content is made from (`createNativePrerenderContent`).
 *
 * `[param]` and `[...rest]` are dynamic; a name starting with `_` is not a
 * route. Paths are URL paths — percent-encoded as `Astro.url.pathname` is —
 * and Core's content keys (`normalizeRoutePath`). Whether a page prerenders is
 * the page's own `prerender` export, which the build records; this says only
 * which paths exist.
 */
export function astroRouteRegistry(
  files: readonly Readonly<{ path: string }>[],
): ThemeRouteRegistry {
  const routes: ThemeRouteRecord[] = [];
  for (const file of files) {
    if (!file.path.startsWith("src/pages/") || !PAGE_EXTENSIONS.test(file.path))
      continue;
    const segments = file.path
      .slice("src/pages/".length)
      .replace(PAGE_EXTENSIONS, "")
      .split("/");
    if (segments.some((segment) => segment.startsWith("_"))) continue;
    if (segments[segments.length - 1] === "index") segments.pop();
    const dynamic = segments.some((segment) => /\[.+\]/.test(segment));
    const path = normalizeRoutePath(
      new URL(`/${segments.join("/")}`, "http://astro.invalid").pathname,
    );
    routes.push({
      id: path,
      path,
      sourcePath: file.path,
      kind: "route",
      dynamic,
      routeType: "route",
      componentName: null,
    });
  }
  return { valid: true, routes, diagnostics: [] };
}
