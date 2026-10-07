/**
 * Specifier the editor preview build must not resolve for real.
 *
 * A Theme reads the request being served through this module during SSR. The
 * preview build is client-only — it has no Start plugin and never runs a
 * loader — so the specifier cannot resolve and the build fails outright.
 */
export const THEME_START_SERVER_SPECIFIER = "@tanstack/react-start/server";

const VIRTUAL_ID = "\0morph-theme-start-server-stub";

/**
 * Node builtin the preview build cannot bundle for the browser.
 *
 * `createIsomorphicFn` is how a Theme keeps a server-only branch out of client
 * code, but reaching it drags Start's storage context in, which imports
 * `AsyncLocalStorage`. Vite maps Node builtins to an empty browser shim, so the
 * named import fails and the whole preview build dies on a module the preview
 * never executes.
 */
const NODE_ASYNC_HOOKS_SPECIFIERS = ["node:async_hooks", "async_hooks"];

const ASYNC_HOOKS_VIRTUAL_ID = "\0morph-theme-preview-async-hooks-stub";

export const START_FN_STUBS_SPECIFIER = "@tanstack/start-fn-stubs";

const START_FN_STUBS_VIRTUAL_ID = "\0morph-theme-start-fn-stubs";

/**
 * Where a preview page asks Vite's dev server for each stub. Vite addresses a
 * `\0` ID as `/@id/__x00__<id>`, with no file extension, so the preview proxy
 * cannot recognise these as module reads by their path alone and has to be
 * told their names (preview-proxy-response.ts).
 */
export const THEME_PREVIEW_STUB_MODULE_PATHS: readonly string[] = [
  VIRTUAL_ID,
  ASYNC_HOOKS_VIRTUAL_ID,
  START_FN_STUBS_VIRTUAL_ID,
].map((id) => `/@id/__x00__${id.slice(1)}`);

/**
 * Single-threaded stand-in for `AsyncLocalStorage`.
 *
 * Correct for synchronous `run` calls, which is all the preview could ever
 * reach, and it stays a real implementation rather than a throw: this module
 * is pulled in transitively, so failing on import would break builds that
 * never call it.
 */
const ASYNC_HOOKS_STUB_SOURCE = `export class AsyncLocalStorage {
  #store = undefined;
  run(store, callback, ...args) {
    const previous = this.#store;
    this.#store = store;
    try {
      return callback(...args);
    } finally {
      this.#store = previous;
    }
  }
  getStore() {
    return this.#store;
  }
  enterWith(store) {
    this.#store = store;
  }
  exit(callback, ...args) {
    return this.run(undefined, callback, ...args);
  }
  disable() {
    this.#store = undefined;
  }
}
export class AsyncResource {
  runInAsyncScope(fn, thisArg, ...args) {
    return fn.apply(thisArg, args);
  }
  bind(fn) {
    return fn;
  }
  emitDestroy() {
    return this;
  }
}
export default { AsyncLocalStorage, AsyncResource };
`;

/**
 * Client-first stand-in for TanStack Start function stubs.
 *
 * In uncompiled client-only preview builds, the upstream stub's `.server()`
 * would overwrite `clientImpl` and execute server code in the browser, calling
 * `getRequest()` and throwing. Selecting `clientImpl` preserves browser data loading.
 */
const START_FN_STUBS_SOURCE = `function createRuntimeFn(fn, clientImpl, serverImpl) {
  return Object.assign(fn, {
    server: (nextServerImpl) => {
      const active = clientImpl ?? nextServerImpl;
      return createRuntimeFn(active, clientImpl, nextServerImpl);
    },
    client: (nextClientImpl) => {
      return createRuntimeFn(nextClientImpl, nextClientImpl, serverImpl);
    },
  });
}
export function createIsomorphicFn() {
  return createRuntimeFn(() => void 0);
}
export const createClientOnlyFn = (fn) => fn;
export const createServerOnlyFn = (fn) => () => {
  throw new Error(
    "Theme preview cannot call server-only functions: server APIs run only in the deployed Theme Worker.",
  );
};
export default { createIsomorphicFn, createClientOnlyFn, createServerOnlyFn };
`;

/**
 * What the Start server module exports, when the real module cannot be read.
 * Only a fallback: the stub takes its names from the module itself, so a name
 * added to Start cannot be missing from it.
 */
const FALLBACK_START_SERVER_EXPORTS = [
  "getRequest",
  "getRequestHeaders",
  "getRequestHeader",
  "getRequestIP",
  "setResponseHeader",
  "setResponseStatus",
  "getCookie",
  "getCookies",
  "setCookie",
  "deleteCookie",
] as const;

/**
 * Prelude of the Start server stub: what every export does when called.
 *
 * Every export throws: the preview never calls them, and a silent no-op would
 * let server-only code appear to work in a build that cannot support it. This
 * matters most for the request context — cookies, headers, the request — which
 * a browser cannot imitate: pretending to would hand back a value that is not
 * the request's.
 */
const STUB_PRELUDE = `const unavailable = (name) => () => {
  throw new Error(
    "Theme preview cannot call " + name + "(): server APIs run only in the deployed Theme Worker.",
  );
};
`;

const isExportName = (name: string) =>
  name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name);

/** The stub body for these export names. */
function startServerStubSource(names: readonly string[]): string {
  return (
    STUB_PRELUDE +
    names
      .map((name) => "export const " + name + " = unavailable(" + JSON.stringify(name) + ");\n")
      .join("") +
    "export default {};\n"
  );
}

/**
 * The stub for `@tanstack/react-start/server`, exporting every name the real
 * module does, each of which throws when called.
 *
 * A fixed list went stale: a Theme importing `getCookie` failed the whole
 * Theme build, because every build also runs this client-only preview build
 * and a name the stub lacked is a build error, not a runtime one. Names that
 * exist but are unsupported must fail when called, with a message that says
 * so, not when imported.
 */
let startServerStub: Promise<string> | null = null;
async function loadStartServerStub(): Promise<string> {
  startServerStub ??= import("@tanstack/react-start/server").then(
    (real) => startServerStubSource(Object.keys(real).filter(isExportName)),
    () => startServerStubSource(FALLBACK_START_SERVER_EXPORTS),
  );
  return startServerStub;
}

/**
 * The same stub, emitted as source for a config generated inside a container.
 *
 * The sandbox build writes its own `vite.config.ts` into an image that cannot
 * import Morph's source, so the plugin has to travel as text. Built from the
 * same constants as the in-process plugin: two copies of what to stub would
 * drift, and the preview build is exactly where that drift is invisible until
 * a customer's build fails.
 *
 * Every embedded value goes through `JSON.stringify`, so the result is safe to
 * interpolate into a template literal — no backtick or `${}` can escape it.
 */
export function themePreviewServerStubPluginSource(): string {
  return `{
  name: ${JSON.stringify("morph-theme-preview-server-stub")},
  enforce: "pre",
  resolveId(source) {
    if (source === ${JSON.stringify(THEME_START_SERVER_SPECIFIER)}) {
      return ${JSON.stringify(VIRTUAL_ID)};
    }
    if (${JSON.stringify(NODE_ASYNC_HOOKS_SPECIFIERS)}.includes(source)) {
      return ${JSON.stringify(ASYNC_HOOKS_VIRTUAL_ID)};
    }
    if (
      source === ${JSON.stringify(START_FN_STUBS_SPECIFIER)} ||
      source.startsWith(${JSON.stringify(START_FN_STUBS_SPECIFIER + "/")})
    ) {
      return ${JSON.stringify(START_FN_STUBS_VIRTUAL_ID)};
    }
    return null;
  },
  async load(id) {
    if (id === ${JSON.stringify(VIRTUAL_ID)}) {
      let names = ${JSON.stringify(FALLBACK_START_SERVER_EXPORTS)};
      try {
        const real = await import(${JSON.stringify(THEME_START_SERVER_SPECIFIER)});
        names = Object.keys(real).filter((name) => name !== "default" && /^[A-Za-z_$][\\w$]*$/.test(name));
      } catch {}
      return ${JSON.stringify(STUB_PRELUDE)} +
        names.map((name) => "export const " + name + " = unavailable(" + JSON.stringify(name) + ");\\n").join("") +
        "export default {};\\n";
    }
    if (id === ${JSON.stringify(ASYNC_HOOKS_VIRTUAL_ID)}) {
      return ${JSON.stringify(ASYNC_HOOKS_STUB_SOURCE)};
    }
    if (id === ${JSON.stringify(START_FN_STUBS_VIRTUAL_ID)}) {
      return ${JSON.stringify(START_FN_STUBS_SOURCE)};
    }
    return null;
  },
}`;
}

/**
 * Vite plugin that redirects the Start server module in preview builds only.
 *
 * The runtime build keeps the real module, so production SSR is unaffected.
 */
export function createThemePreviewServerStubPlugin() {
  return {
    name: "morph-theme-preview-server-stub",
    enforce: "pre" as const,
    resolveId(source: string) {
      if (source === THEME_START_SERVER_SPECIFIER) return VIRTUAL_ID;
      if (NODE_ASYNC_HOOKS_SPECIFIERS.includes(source)) {
        return ASYNC_HOOKS_VIRTUAL_ID;
      }
      if (
        source === START_FN_STUBS_SPECIFIER ||
        source.startsWith(START_FN_STUBS_SPECIFIER + "/")
      ) {
        return START_FN_STUBS_VIRTUAL_ID;
      }
      return null;
    },
    async load(id: string) {
      if (id === VIRTUAL_ID) return loadStartServerStub();
      if (id === ASYNC_HOOKS_VIRTUAL_ID) return ASYNC_HOOKS_STUB_SOURCE;
      if (id === START_FN_STUBS_VIRTUAL_ID) return START_FN_STUBS_SOURCE;
      return null;
    },
  };
}
