import type { Plugin } from "vite";

/**
 * Keeps Code mode's Monaco out of the server build, and fails a build that
 * lets it in.
 *
 * Monaco runs in the browser only: the editor core touches `document` and
 * `self` as it loads, its CSS and workers mean nothing in a Worker, and
 * `@monaco-editor/react` carries the jsDelivr loader the editor no longer
 * uses. Wrangler uploads every `.js` under `dist/server` as a module, so
 * Monaco there would also be several megabytes of Worker upload.
 *
 * Three things put it there, each handled here:
 *
 * - The runtime is reached through one dynamic import behind
 *   `import.meta.env.SSR` (`editor-code-monaco-loader.ts`). Rollup still
 *   resolves and loads a dynamic import's target before it drops the dead
 *   branch, and loading the runtime runs Vite's CSS and worker plugins. So the
 *   server environment resolves the runtime to a stub that throws if it is
 *   ever evaluated, and Monaco never enters the server's module graph.
 * - Vite's worker plugin keeps one cache of bundled workers per config and
 *   emits all of it in every environment that emits assets, the Worker's
 *   included: the five Monaco workers the client build bundled arrive in the
 *   server bundle with nothing referring to them. They are dropped from it;
 *   one that a server chunk does name fails the build instead.
 * - Anything else: the server's module graph is checked for Monaco, the React
 *   wrapper and the runtime, because `tsc` and a passing build stay green when
 *   the guards above regress.
 */
const RUNTIME_MODULE = /[\\/]editor-code-monaco-runtime(?:\.ts)?$/;

const BROWSER_ONLY_MODULES: ReadonlyArray<{ label: string; pattern: RegExp }> =
  [
    { label: "monaco-editor", pattern: /[\\/]node_modules[\\/]monaco-editor[\\/]/ },
    {
      label: "@monaco-editor/*",
      pattern: /[\\/]node_modules[\\/]@monaco-editor[\\/]/,
    },
    {
      label: "editor-code-monaco-runtime",
      pattern: /[\\/]editor-code-monaco-runtime\.ts$/,
    },
  ];

/** Files Monaco's build emits, by the names Vite gives them. */
const BROWSER_ONLY_FILES: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  {
    label: "Monaco worker",
    pattern: /(?:^|\/)(?:editor|ts|css|html|json)\.worker-[\w-]+\.js$/,
  },
  { label: "Monaco codicon font", pattern: /(?:^|\/)codicon-[\w-]+\.ttf$/ },
];

const STUB_ID = "\0morph:browser-only-stub:editor-code-monaco-runtime";

type Finding = { id: string; label: string };

/** The module ids, out of `moduleIds`, that are browser-only. */
export function findBrowserOnlyModules(moduleIds: Iterable<string>): Finding[] {
  const found: Finding[] = [];
  for (const raw of moduleIds) {
    // Virtual and query-suffixed ids (`?worker`, `?inline`) name the same file.
    const id = raw.replace(/^\0/, "").split("?")[0]!;
    const match = BROWSER_ONLY_MODULES.find(({ pattern }) => pattern.test(id));
    if (match) found.push({ id, label: match.label });
  }
  return found;
}

/** The emitted file names, out of `fileNames`, that are Monaco's. */
export function findBrowserOnlyFiles(fileNames: Iterable<string>): Finding[] {
  const found: Finding[] = [];
  for (const fileName of fileNames) {
    const match = BROWSER_ONLY_FILES.find(({ pattern }) =>
      pattern.test(fileName),
    );
    if (match) found.push({ id: fileName, label: match.label });
  }
  return found;
}

type BundleEntry =
  | { type: "chunk"; code: string; moduleIds: readonly string[] }
  | { type: "asset" };

/**
 * Checks a server bundle, removing the Monaco files no server chunk names.
 *
 * `graph` is every module the server build loaded, tree-shaken or not.
 * Returns what must fail the build, and what was dropped.
 */
export function checkServerBundle(
  graph: Iterable<string>,
  bundle: Record<string, BundleEntry>,
): { found: Finding[]; dropped: string[] } {
  const found = findBrowserOnlyModules(graph);
  const dropped: string[] = [];
  const chunks = Object.values(bundle).filter(
    (entry): entry is Extract<BundleEntry, { type: "chunk" }> =>
      entry.type === "chunk",
  );
  for (const file of findBrowserOnlyFiles(Object.keys(bundle))) {
    const name = file.id.split("/").pop()!;
    if (chunks.some((chunk) => chunk.code.includes(name))) {
      found.push({ id: file.id, label: `${file.label}, named by a server chunk` });
    } else {
      delete bundle[file.id];
      dropped.push(file.id);
    }
  }
  return { found, dropped };
}

export function browserOnlyServerGuard(): Plugin[] {
  return [
    {
      // Dev and build: the server environment never loads the runtime.
      name: "morph:browser-only-server-stub",
      enforce: "pre",
      applyToEnvironment: (environment) => environment.name === "ssr",
      resolveId(source) {
        if (RUNTIME_MODULE.test(source.split("?")[0]!)) return STUB_ID;
        return null;
      },
      load(id) {
        if (id !== STUB_ID) return null;
        return 'throw new Error("editor-code-monaco-runtime is browser-only and was evaluated on the server.");\n';
      },
    },
    {
      name: "morph:browser-only-server-guard",
      apply: "build",
      applyToEnvironment: (environment) => environment.name === "ssr",
      // Last, so the worker files Vite emits while generating are seen too.
      generateBundle: {
        order: "post",
        handler(_options, bundle) {
          const { found } = checkServerBundle(
            this.getModuleIds(),
            bundle as unknown as Record<string, BundleEntry>,
          );
          if (found.length === 0) return;
          const listed = found
            .slice(0, 10)
            .map(({ id, label }) => `  ${label}: ${id}`)
            .join("\n");
          this.error(
            `${found.length} browser-only module(s) or file(s) reached the server build. Code mode's Monaco must stay behind the browser-only import in editor-code-monaco-loader.ts.\n${listed}`,
          );
        },
      },
    },
  ];
}
