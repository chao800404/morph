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
 * Stub the preview build substitutes for the Start server module.
 *
 * Every export throws: the preview never calls them, and a silent no-op would
 * let server-only code appear to work in a build that cannot support it.
 */
const STUB_SOURCE = `const unavailable = (name) => () => {
  throw new Error(
    "Theme preview cannot call " + name + "(): server APIs run only in the deployed Theme Worker.",
  );
};
export const getRequest = unavailable("getRequest");
export const getRequestHeaders = unavailable("getRequestHeaders");
export const getRequestHeader = unavailable("getRequestHeader");
export const getRequestIP = unavailable("getRequestIP");
export const setResponseHeader = unavailable("setResponseHeader");
export const setResponseStatus = unavailable("setResponseStatus");
export default {};
`;

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
    return null;
  },
  load(id) {
    if (id === ${JSON.stringify(VIRTUAL_ID)}) return ${JSON.stringify(STUB_SOURCE)};
    if (id === ${JSON.stringify(ASYNC_HOOKS_VIRTUAL_ID)}) {
      return ${JSON.stringify(ASYNC_HOOKS_STUB_SOURCE)};
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
      return null;
    },
    load(id: string) {
      if (id === VIRTUAL_ID) return STUB_SOURCE;
      if (id === ASYNC_HOOKS_VIRTUAL_ID) return ASYNC_HOOKS_STUB_SOURCE;
      return null;
    },
  };
}
