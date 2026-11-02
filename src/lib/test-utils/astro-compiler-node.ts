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
 * The product preview locate plugin (`astroPreviewLocatePluginSource`) run on
 * one source, unchanged except that its `import("@astrojs/compiler-rs")` is
 * given this compiler. `file` is workspace-relative.
 */
export async function runAstroPreviewLocatePlugin(
  source: string,
  file: string,
  nonce: string,
): Promise<string | null> {
  const text = astroPreviewLocatePluginSource(nonce);
  const needle = 'await import("@astrojs/compiler-rs")';
  if (!text.includes(needle))
    throw new Error("the plugin's compiler import moved");
  const plugin = new Function(
    "path",
    "fs",
    "crypto",
    "workspaceRoot",
    "__compiler",
    `return ${text.replace(needle, "__compiler")};`,
  )(path.posix, { promises: { readFile: async () => source } }, crypto, "/ws", {
    parse: parseAstroInNode,
  }) as { load(id: string): Promise<string | null> };
  return plugin.load(`/ws/${file}`);
}

/** A full compile of one `.astro` source to its JavaScript module. */
export function compileAstroInNode(
  source: string,
  filename = "src/pages/index.astro",
): { code: string; diagnostics: CompilerDiagnostic[] } {
  return load().compileAstroSync(source, { filename });
}
