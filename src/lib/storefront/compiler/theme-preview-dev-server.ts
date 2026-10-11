/**
 * Root of the TanStack Start toolchain in `Dockerfile.sandbox`: only a default,
 * for callers that name no root (tests). Sandbox builds and previews always
 * pass the root from the toolchain registry (theme-toolchains.ts), and a test
 * keeps this literal equal to the registry's Start root. A literal, because
 * this module stays self-contained.
 *
 * Theme source can never install packages during a request, so every module a
 * Theme is allowed to import already lives in its toolchain when the
 * container starts.
 */
import type { Plugin } from "vite";

export const SANDBOX_TOOLCHAIN_ROOT =
  "/opt/morph-toolchain/tanstack-start-1.168";

/** Browser HTTP access must not expose server-only source, including Vite's
 * inline sourcesContent maps and ?raw responses. SSR module-runner transforms
 * do not pass through this HTTP middleware and remain available to Start.
 * Keep this factory self-contained: the container config emits the same code.
 */
export function themePreviewServerSourcePlugin(): Plugin {
  return {
    name: "morph-preview-server-source-boundary",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        let pathname: string;
        try {
          pathname = decodeURIComponent(
            (request.url ?? "").split(/[?#]/, 1)[0]!,
          );
        } catch {
          response.statusCode = 400;
          response.end("Invalid request path");
          return;
        }
        if (!/\.server\.[cm]?[jt]sx?(?:\.map)?$/i.test(pathname)) {
          next();
          return;
        }
        response.statusCode = 403;
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.end("Server-only source is not available over HTTP");
      });
    },
  };
}

export function themePreviewServerSourcePluginSource(): string {
  return `(${themePreviewServerSourcePlugin.toString()})()`;
}

/**
 * URL namespace owned by the Theme's Vite server.
 *
 * In local development the Morph app and the exposed container both enter
 * through the same outer Vite process on port 3000. A root-relative Vite URL
 * such as `/node_modules/.vite/deps/react.js` is otherwise consumed by that
 * outer server before the hostname-aware Worker proxy can see it. The result
 * is a page from the Theme server importing React from Morph's optimizer.
 * Keeping every Theme dev asset under one prefix lets the outer server pass
 * the request through to the preview-host proxy as intended.
 */
export const THEME_PREVIEW_SERVER_BASE_PATH = "/__morph-theme-preview__/";

/**
 * HMR path relative to the preview base. Vite prefixes `server.hmr.path` with
 * `base`, so passing the full namespace here would duplicate it.
 */
export const THEME_PREVIEW_SERVER_HMR_PATH = "hmr";

/**
 * Module specifiers Vite's own dev server asks for, which a build never does.
 *
 * A dev server injects its HMR client and the React Refresh runtime into the
 * page, and serves them from the toolchain through Vite's `/@fs/` prefix. To
 * the dependency enforcer that reads as a Theme reaching into `node_modules`
 * by absolute path, which is exactly what it exists to refuse — so the Live
 * Preview server dies on its own infrastructure before a Theme renders.
 *
 * The allowance is deliberately narrow. It matches `/@fs/` paths under the
 * pinned toolchain only, so it cannot become a general filesystem escape: a
 * Theme asking for `/@fs/etc/passwd`, or for any path outside the toolchain,
 * still hits the containment check. It applies only while Vite is serving;
 * `vite build` must keep refusing every one of these.
 */
export function isPreviewDevInfrastructureSpecifier(source: string): boolean {
  if (typeof source !== "string") return false;
  return source.startsWith(`/@fs${SANDBOX_TOOLCHAIN_ROOT}/node_modules/`);
}

/**
 * The same predicate, emitted as source for a config generated in a container.
 *
 * The generated `vite.config.ts` cannot import Morph's modules, so the rule
 * has to travel as text. Built from the same constant as the in-process
 * predicate above, because two copies of a security boundary drift silently.
 *
 * The toolchain root is a parameter because it is the one thing here that is a
 * property of *where* the server runs; the rule itself is identical in a
 * container and on a checkout.
 */
export function previewDevInfrastructureGuardSource(
  toolchainRoot: string = SANDBOX_TOOLCHAIN_ROOT,
): string {
  return `(source) =>
  typeof source === "string" &&
  source.startsWith(${JSON.stringify(`/@fs${toolchainRoot}/node_modules/`)})`;
}

/**
 * The only roots a dev server may serve files from.
 *
 * `/@fs/` is a dev-server URL, not an import the dependency enforcer can
 * judge: by the time it appears, the question is which files Vite will read
 * off disk. Vite answers that with `server.fs`, so containment for this class
 * of request belongs there and nowhere else. Left unset it falls back to a
 * search for the workspace root, which is a guess — and a guess is not a
 * boundary. Pinned to the workspace plus the toolchain's `node_modules`, so
 * the rest of the image, `/etc` included, is unreachable over HTTP.
 */
export const THEME_PREVIEW_FS_ALLOW_ROOTS: readonly string[] =
  themePreviewFsAllowRoots();

/**
 * Both roots of the same rule, for a server that is not the container.
 *
 * The guard above and this list answer "where does this server run", not "what
 * may it reach": a local server has the workspace in a checkout directory and
 * the pinned packages in that checkout's own `node_modules`, and the boundary
 * it needs is the same shape — the workspace, plus the toolchain, and nothing
 * else. One function so the two roots cannot be half-updated, and so the
 * container's answer above is this call with no arguments rather than a second
 * copy of it.
 */
export function themePreviewFsAllowRoots({
  hostWorkspaceRoot = "/workspace",
  toolchainRoot = SANDBOX_TOOLCHAIN_ROOT,
}: {
  hostWorkspaceRoot?: string;
  toolchainRoot?: string;
} = {}): readonly string[] {
  return [hostWorkspaceRoot, `${toolchainRoot}/node_modules`];
}

/**
 * Packages the dev server must not hand to esbuild for dependency
 * pre-bundling.
 *
 * Pre-bundling runs esbuild directly and never calls a Rollup plugin's
 * `resolveId`, so the preview's server-API stubs do not apply to anything
 * pre-bundled. Start's storage context then reaches a real `node:async_hooks`,
 * Vite externalizes it for the browser, and the preview dies on
 * `AsyncLocalStorage is not a constructor` — a module the preview never runs.
 *
 * Excluding these keeps them on the normal resolve path, where the stub plugin
 * is the thing that answers. Ignored by `vite build`, which has no
 * pre-bundling step for them.
 */
export const THEME_PREVIEW_DEP_OPTIMIZE_EXCLUDES: readonly string[] = [
  "@tanstack/react-start",
  "@tanstack/react-start/server",
  "@tanstack/start-client-core",
  "@tanstack/start-fn-stubs",
  // The packages that actually reach for `node:async_hooks`. Listing only the
  // entry point a Theme imports was not enough: these are pulled in
  // transitively, pre-bundled on their own, and the stub never saw them — the
  // preview then failed on a module it had a replacement for all along.
  "@tanstack/start-storage-context",
  "@tanstack/start-server-core",
];

/**
 * Dependencies the Live Preview pre-bundles although nothing a Theme imports
 * names them, because excluded packages reach them.
 *
 * `@tanstack/start-client-core` and `@tanstack/react-start-client` import
 * `@tanstack/router-core`. With those excluded, Vite never discovered it, and
 * the browser fetched its 34 internal modules one by one through the preview
 * proxy — the last requests to finish, 45-54 s into opening the editor, in
 * three measured runs (see the progress log). Pre-bundled, they are one
 * module. `@tanstack/react-router`, which Vite does discover, also carried a
 * copy of it inside its own bundle; with an entry of its own, both are meant
 * to share one.
 *
 * Only the entries the preview's browser code uses. `ssr/server` is left out:
 * it is the one that reaches Node built-ins, and nothing in the preview loads
 * it. None of these is on the stubbed path above — router-core imports no
 * Start server API — so pre-bundling them cannot bypass a stub. One package
 * at a time, measured before and after; add others only on the same evidence.
 */
export const THEME_PREVIEW_DEP_OPTIMIZE_INCLUDES: readonly string[] = [
  "@tanstack/router-core",
  "@tanstack/router-core/ssr/client",
  "@tanstack/router-core/isServer",
];

/**
 * Window event the preview's Vite client fires when a hot update could not be
 * applied — a module it fetched answered with an error, usually because it no
 * longer compiles.
 *
 * Vite's own answer is to keep the previous page and raise its overlay from
 * the error it broadcasts. Here that broadcast reaches the page only through
 * the HTTP relay, which is read when the editor writes, so the overlay never
 * comes and the page would go on showing source that no longer exists. The
 * page's first script reloads it instead (theme-preview-diagnostic-script):
 * the module it then cannot load is reported like any page that cannot come
 * up, which the editor explains and recovers from once a fix is written.
 */
export const THEME_PREVIEW_HMR_FAILED_EVENT =
  "morph:storefront-preview-hmr-failed";

/**
 * Source of the Live Preview's HTTP HMR relay, a Vite plugin object
 * expression for a generated config.
 *
 * Cloudflare's local preview-port bridge cannot carry Vite's HMR WebSocket
 * reliably. The relay keeps Vite's own update calculation and browser
 * handler, but moves each payload across an HTTP request on the
 * already-isolated preview origin; the browser still applies the native
 * payload, so component state survives source edits. Shared by every
 * framework's preview config, so each relays the same way.
 */
export function previewHttpHmrPluginSource(): string {
  return `{
  name: "morph-preview-http-hmr",
  enforce: "post",
  configureServer(server) {
    let sequence = 0;
    const entries = [];
    const waiters = new Set();
    let quietTimer = null;
    const wakeAfterQuiet = () => {
      if (quietTimer !== null) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        quietTimer = null;
        for (const wake of waiters) wake();
        waiters.clear();
      }, 120);
    };
    const hot = server.environments.client.hot;
    const send = hot.send.bind(hot);
    hot.send = (payload, ...rest) => {
      if (payload && typeof payload === "object" && payload.type !== "connected") {
        sequence += 1;
        entries.push({ sequence, payload });
        if (entries.length > 100) entries.splice(0, entries.length - 100);
        wakeAfterQuiet();
      }
      return send(payload, ...rest);
    };
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url || "/", "http://preview.invalid");
      if (
        url.pathname !== "/__morph-theme-preview__/_morph/hmr" &&
        url.pathname !== "/_morph/hmr"
      ) return next();
      const after = Number(url.searchParams.get("after") || "0");
      const respond = () => {
        if (res.writableEnded) return;
        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(JSON.stringify({
          sequence,
          entries: entries.filter((entry) => entry.sequence > after),
        }));
      };
      if (url.searchParams.has("cursor") || entries.some((entry) => entry.sequence > after)) {
        setTimeout(respond, quietTimer === null ? 0 : 140);
        return;
      }
      waiters.add(respond);
      setTimeout(() => {
        waiters.delete(respond);
        respond();
      }, 5_000);
    });
  },
  transform(code, id) {
    if (!id.replace(/\\\\/g, "/").endsWith("/vite/dist/client/client.mjs")) return null;
    const connect = "transport.connect(createHMRHandler(handleMessage));";
    const failedUpdate = "warnFailedUpdate(err, path) {";
    // Each edit lands on exactly one place it was written for. A client that
    // lost either, or grew a second, is not the one these edits fit: serving
    // it refuses loudly instead of editing the wrong line.
    const once = (needle) => code.split(needle).length === 2;
    if (!once(connect) || !once(failedUpdate)) {
      throw new Error("MORPH_PREVIEW_HMR_CLIENT_CONTRACT_CHANGED");
    }
    return {
      code: code
        .replace(
          connect,
          "globalThis.__morphApplyViteHmrPayload = (payload) => handleMessage(payload);",
        )
        .replace(
          failedUpdate,
          failedUpdate +
            ' try { globalThis.dispatchEvent(new Event(${JSON.stringify(THEME_PREVIEW_HMR_FAILED_EVENT)})); } catch {}',
        ),
      map: null,
    };
  },
}`;
}
