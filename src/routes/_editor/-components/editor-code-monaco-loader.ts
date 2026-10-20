import { useEffect, useSyncExternalStore } from "react";

/**
 * Loads the bundled Monaco runtime for Code mode, and says so when it cannot.
 *
 * Before this, `@monaco-editor/react` fetched Monaco from jsDelivr with no
 * timeout and no error: a request that never answered left "Loading..." on
 * screen for good (CI run 39389278872). The runtime now ships with Morph and
 * is imported here, on demand, and the state is one of loading, ready or
 * error, so a failure is visible and can be retried.
 *
 * The import is browser-only. `import.meta.env.SSR` is replaced at build
 * time, so the server build drops the `import()` and never contains Monaco;
 * `vite.config.ts` fails a server build that does. `load` is also only called
 * from an effect, which never runs on the server.
 *
 * Unsaved Code mode drafts are not held here. They live in the workspace store
 * and the workspace's own draft refs, which a load failure or a retry does not
 * touch; the editor mounts with them once the runtime is ready.
 */
export type EditorCodeMonacoRuntime =
  typeof import("./editor-code-monaco-runtime");

export type EditorCodeMonacoState =
  | { status: "loading" }
  | { status: "ready"; runtime: EditorCodeMonacoRuntime }
  | {
      status: "error";
      /** `timeout`: no answer yet, still waiting. `failed`: the import threw. */
      reason: "timeout" | "failed";
    };

/**
 * How long a load may take before the error, with Retry, is shown.
 *
 * Twenty seconds is several times what the runtime takes to arrive and start
 * on a normal connection, so a slow but working load does not flash an error,
 * and well short of the 30 s the CDN request hung for. Reaching it does not
 * abandon the request: if the import still settles, the editor appears.
 */
export const EDITOR_CODE_MONACO_TIMEOUT_MS = 20_000;

export type EditorCodeMonacoLoader = {
  getState: () => EditorCodeMonacoState;
  subscribe: (listener: () => void) => () => void;
  /** Starts a load unless one is running or Monaco is ready. */
  load: () => void;
  /** A new attempt after an error; a no-op otherwise. */
  retry: () => void;
};

function importRuntimeInBrowser(): Promise<EditorCodeMonacoRuntime> {
  if (import.meta.env.SSR || typeof window === "undefined") {
    return Promise.reject(new Error("Monaco only runs in the browser."));
  }
  return import("./editor-code-monaco-runtime");
}

export function createEditorCodeMonacoLoader({
  importRuntime = importRuntimeInBrowser,
  timeoutMs = EDITOR_CODE_MONACO_TIMEOUT_MS,
}: {
  importRuntime?: () => Promise<EditorCodeMonacoRuntime>;
  timeoutMs?: number;
} = {}): EditorCodeMonacoLoader {
  let state: EditorCodeMonacoState = { status: "loading" };
  let started = false;
  let attempt = 0;
  const listeners = new Set<() => void>();

  const set = (next: EditorCodeMonacoState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const start = () => {
    started = true;
    attempt += 1;
    const current = attempt;
    if (state.status !== "loading") set({ status: "loading" });
    const timer = setTimeout(() => {
      if (current === attempt && state.status === "loading") {
        set({ status: "error", reason: "timeout" });
      }
    }, timeoutMs);
    importRuntime().then(
      (runtime) => {
        clearTimeout(timer);
        // A late answer from any attempt is still Monaco: take it.
        if (state.status !== "ready") set({ status: "ready", runtime });
      },
      (error: unknown) => {
        clearTimeout(timer);
        if (current !== attempt || state.status === "ready") return;
        console.error("[code editor] Monaco failed to load", error);
        set({ status: "error", reason: "failed" });
      },
    );
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load: () => {
      if (!started) start();
    },
    retry: () => {
      if (state.status === "error") start();
    },
  };
}

const LOADING: EditorCodeMonacoState = { status: "loading" };

/** Subscribes to `loader` and starts it once the component has mounted. */
export function useEditorCodeMonacoFrom(loader: EditorCodeMonacoLoader) {
  const state = useSyncExternalStore(
    loader.subscribe,
    loader.getState,
    () => LOADING,
  );
  useEffect(() => {
    loader.load();
  }, [loader]);
  return { state, retry: loader.retry };
}

/** The page's one Monaco: every Code workspace shares the same runtime. */
const editorCodeMonacoLoader = createEditorCodeMonacoLoader();

export function useEditorCodeMonaco() {
  return useEditorCodeMonacoFrom(editorCodeMonacoLoader);
}
