/**
 * Test support, Node only: compiler-rs 0.5.1 through the same `wasm32-wasi`
 * module the parser Worker bundles (packages/astro-parser-worker), loaded the
 * way that Worker's `compiler.ts` does (module minimum of 981 pages, no
 * threads, synchronous calls). Lets the preview locate plugin, which runs on
 * compiler-rs in the container, run here on the same compiler version.
 *
 * Not the container's native binding: native and Wasm agreeing is U1 of the
 * PR-I design and is checked in the container, not by this helper.
 */
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path, { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { astroPreviewLocatePluginSource } from "@/lib/storefront/theme-framework/astro-preview-locate";

const HERE = dirname(fileURLToPath(import.meta.url));
const requireFromParser = createRequire(
  join(HERE, "../../../packages/astro-parser-worker/package.json"),
);

type CompilerDiagnostic = { severity: string; text: string };
type Binding = {
  parseAstroSync(source: string): {
    ast: string;
    diagnostics: CompilerDiagnostic[];
  };
  compileAstroSync(
    source: string,
    options: Record<string, unknown>,
  ): { code: string; diagnostics: CompilerDiagnostic[] };
};

let binding: Binding | undefined;

function load(): Binding {
  if (binding) return binding;
  const runtime = requireFromParser("@napi-rs/wasm-runtime") as {
    getDefaultContext: () => unknown;
    instantiateNapiModuleSync: (
      module: WebAssembly.Module,
      options: unknown,
    ) => { napiModule: { exports: unknown } };
    WASI: new (options: unknown) => unknown;
  };
  const wasm = new WebAssembly.Module(
    readFileSync(
      requireFromParser.resolve(
        "@astrojs/compiler-binding-wasm32-wasi/astro.wasm32-wasi.wasm",
      ),
    ),
  );
  const memory = new WebAssembly.Memory({
    initial: 981,
    maximum: 65_536,
    shared: true,
  });
  const { napiModule } = runtime.instantiateNapiModuleSync(wasm, {
    context: runtime.getDefaultContext(),
    asyncWorkPoolSize: 0,
    wasi: new runtime.WASI({ version: "preview1" }),
    onCreateWorker() {
      throw new Error("no threads");
    },
    overwriteImports(imports: Record<string, Record<string, unknown>>) {
      imports.env = {
        ...imports.env,
        ...imports.napi,
        ...imports.emnapi,
        memory,
      };
      return imports;
    },
    beforeInit({ instance }: { instance: WebAssembly.Instance }) {
      for (const name of Object.keys(instance.exports)) {
        if (name.startsWith("__napi_register__")) {
          (instance.exports[name] as () => void)();
        }
      }
    },
  });
  binding = napiModule.exports as Binding;
  return binding;
}

export function astroCompilerVersion(): string {
  return (
    JSON.parse(
      readFileSync(
        requireFromParser.resolve(
          "@astrojs/compiler-binding-wasm32-wasi/package.json",
        ),
        "utf8",
      ),
    ) as { version: string }
  ).version;
}

/** `parse` as the plugin calls it: the AST as an object. */
export function parseAstroInNode(source: string): {
  ast: Record<string, unknown>;
  diagnostics: CompilerDiagnostic[];
} {
  const raw = load().parseAstroSync(source);
  return {
    ast: JSON.parse(raw.ast) as Record<string, unknown>,
    diagnostics: raw.diagnostics,
  };
}

/**
 * `magic-string` for the plugin in tests. The product loads it through the
 * `astro` package (astro-preview-workspace.ts); this repository has no
 * `astro`, so it is loaded through `vitest`, which also depends on it. Same
 * API (`remove`, `appendLeft`, `toString`, `generateMap`); the toolchain's
 * version is Astro's.
 */
export function loadMagicStringForTests(): unknown {
  const require = createRequire(
    createRequire(import.meta.url).resolve("vitest/package.json"),
  );
  const loaded = require("magic-string") as {
    default?: unknown;
    MagicString?: unknown;
  };
  return loaded.default ?? loaded.MagicString ?? loaded;
}

export type AstroPreviewLocateResult = {
  code: string;
  map: {
    version: number;
    sources: string[];
    sourcesContent?: (string | null)[];
    mappings: string;
    names: string[];
  };
};

/** The plugin's `load` hook, created exactly as the integration creates it. */
function previewLocatePlugin(
  source: string,
  nonce: string,
  loadMagicString: () => unknown,
): {
  buildStart(): void;
  load(id: string): Promise<AstroPreviewLocateResult | null>;
} {
  const text = astroPreviewLocatePluginSource(nonce);
  const needle = 'await import("@astrojs/compiler-rs")';
  if (!text.includes(needle))
    throw new Error("the plugin's compiler import moved");
  return new Function(
    "path",
    "fs",
    "crypto",
    "workspaceRoot",
    "loadMagicString",
    "__compiler",
    `return ${text.replace(needle, "__compiler")};`,
  )(
    path.posix,
    { promises: { readFile: async () => source } },
    crypto,
    "/ws",
    loadMagicString,
    { parse: parseAstroInNode },
  ) as ReturnType<typeof previewLocatePlugin>;
}

/**
 * The product preview locate plugin (`astroPreviewLocatePluginSource`) run on
 * one source, unchanged except that its `import("@astrojs/compiler-rs")` is
 * given this compiler: what `load` returns, the annotated code and the map of
 * its edits (the map's source is `/ws/<file>`). `file` is workspace-relative.
 */
export async function runAstroPreviewLocatePluginWithMap(
  source: string,
  file: string,
  nonce: string,
  loadMagicString: () => unknown = loadMagicStringForTests,
): Promise<AstroPreviewLocateResult | null> {
  return previewLocatePlugin(source, nonce, loadMagicString).load(
    `/ws/${file}`,
  );
}

/** As `runAstroPreviewLocatePluginWithMap`, the annotated code only. */
export async function runAstroPreviewLocatePlugin(
  source: string,
  file: string,
  nonce: string,
): Promise<string | null> {
  return (
    (await runAstroPreviewLocatePluginWithMap(source, file, nonce))?.code ??
    null
  );
}

/** The plugin's `buildStart`, for its refusal without magic-string. */
export function startAstroPreviewLocatePlugin(
  nonce: string,
  loadMagicString: () => unknown,
): void {
  previewLocatePlugin("", nonce, loadMagicString).buildStart();
}

/** A full compile of one `.astro` source to its JavaScript module. */
export function compileAstroInNode(
  source: string,
  filename = "src/pages/index.astro",
): { code: string; diagnostics: CompilerDiagnostic[] } {
  return load().compileAstroSync(source, { filename });
}

/**
 * A compile as Astro's own runs it in dev for this purpose: the module and
 * its source map, `sourcemap: "external"` (Astro passes `"both"`; the map is
 * the same, here not inlined).
 */
export function compileAstroWithMapInNode(
  source: string,
  filename = "src/pages/index.astro",
): { code: string; map: string; diagnostics: CompilerDiagnostic[] } {
  return load().compileAstroSync(source, {
    filename,
    sourcemap: "external",
  }) as { code: string; map: string; diagnostics: CompilerDiagnostic[] };
}
