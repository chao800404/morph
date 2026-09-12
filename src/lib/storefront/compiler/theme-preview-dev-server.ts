/**
 * Root of the pinned toolchain baked into `Dockerfile.sandbox`.
 *
 * Theme source can never install packages during a request, so every module a
 * Theme is allowed to import already lives here when the container starts.
 */
export const SANDBOX_TOOLCHAIN_ROOT = "/opt/morph-toolchain";

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
 */
export function previewDevInfrastructureGuardSource(): string {
  return `(source) =>
  typeof source === "string" &&
  source.startsWith(${JSON.stringify(`/@fs${SANDBOX_TOOLCHAIN_ROOT}/node_modules/`)})`;
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
export const THEME_PREVIEW_FS_ALLOW_ROOTS: readonly string[] = [
  "/workspace",
  `${SANDBOX_TOOLCHAIN_ROOT}/node_modules`,
];

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
  // The packages that actually reach for `node:async_hooks`. Listing only the
  // entry point a Theme imports was not enough: these are pulled in
  // transitively, pre-bundled on their own, and the stub never saw them — the
  // preview then failed on a module it had a replacement for all along.
  "@tanstack/start-storage-context",
  "@tanstack/start-server-core",
];
