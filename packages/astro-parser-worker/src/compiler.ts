/**
 * The `.astro` compiler in this isolate: `@astrojs/compiler-rs` 0.5.1 through
 * its official `wasm32-wasi` binding, loaded the way R1, M1 and M1c did.
 *
 * Why not the official browser loader (`astro.wasi-browser.js`): it compiles
 * the `.wasm` from bytes, which workerd refuses ("Wasm code generation
 * disallowed by embedder"), asks for 4000 pages (250 MiB) of shared memory,
 * which alone exceeds the 128 MB isolate, and starts a Web Worker pool workerd
 * does not have. This loader takes the module precompiled, uses the module's
 * own minimum of 981 pages and no threads; the rest is the official loader's
 * (docs/astro-theme-plan.md 3.1, adoption condition 1). Only the synchronous
 * `parseAstroSync` is used: the async API needs threads.
 *
 * Instantiated on first use, not at load, and at most once per isolate. A
 * trap poisons the isolate for good (see `parse`).
 */
import wasmModule from "@astrojs/compiler-binding-wasm32-wasi/astro.wasm32-wasi.wasm";
import {
  getDefaultContext,
  instantiateNapiModuleSync,
  WASI,
} from "@napi-rs/wasm-runtime";

/** The `.wasm`'s declared minimum, 61.3 MiB. */
const INITIAL_PAGES = 981;
const MAXIMUM_PAGES = 65_536;

interface DiagnosticLabel {
  start: number;
  end: number;
}
export interface CompilerDiagnostic {
  severity: string;
  text: string;
  labels?: DiagnosticLabel[];
}
interface Binding {
  parseAstroSync(source: string): {
    ast: string;
    diagnostics: CompilerDiagnostic[];
  };
}

let binding: Binding | undefined;
let memory: WebAssembly.Memory | undefined;
let poisonedBy: string | undefined;

function load(): Binding {
  if (binding) return binding;
  const shared = new WebAssembly.Memory({
    initial: INITIAL_PAGES,
    maximum: MAXIMUM_PAGES,
    shared: true,
  });
  const { napiModule } = instantiateNapiModuleSync(wasmModule, {
    context: getDefaultContext(),
    asyncWorkPoolSize: 0,
    wasi: new WASI({ version: "preview1" }),
    onCreateWorker() {
      throw new Error("the compiler tried to start a thread; workerd has none");
    },
    overwriteImports(importObject) {
      importObject.env = {
        ...importObject.env,
        ...importObject.napi,
        ...importObject.emnapi,
        memory: shared,
      };
      return importObject;
    },
    beforeInit({ instance }) {
      for (const name of Object.keys(instance.exports)) {
        if (name.startsWith("__napi_register__")) {
          (instance.exports[name] as () => void)();
        }
      }
    },
  });
  memory = shared;
  binding = napiModule.exports as Binding;
  return binding;
}

export class CompilerTrapped extends Error {}
export class CompilerPoisoned extends Error {}

export interface ParsedAstro {
  /** The AST as compiler-rs emits it (ESTree-shaped, UTF-16 positions). */
  ast: unknown;
  diagnostics: CompilerDiagnostic[];
}

/**
 * Parses one source. Anything the compiler throws, including a failure to
 * instantiate, poisons this isolate: this call throws `CompilerTrapped`, every
 * later one `CompilerPoisoned`, and nothing is rebuilt. Reusing the instance
 * after a trap returned wrong answers from the 94th trap on, and rebuilding
 * kept 13-22 MiB of RSS per rebuild (M1c report 3.8).
 */
export function parse(source: string): ParsedAstro {
  if (poisonedBy !== undefined) throw new CompilerPoisoned(poisonedBy);
  let raw: ReturnType<Binding["parseAstroSync"]>;
  try {
    raw = load().parseAstroSync(source);
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    const message = error instanceof Error ? error.message : String(error);
    poisonedBy = `${name}: ${message.slice(0, 120)}`;
    throw new CompilerTrapped(poisonedBy);
  }
  return { ast: JSON.parse(raw.ast) as unknown, diagnostics: raw.diagnostics };
}

/** The shared Wasm memory's current size; 0 before the first parse. */
export function compilerMemoryBytes(): number {
  return memory ? memory.buffer.byteLength : 0;
}

export function compilerPoisoned(): boolean {
  return poisonedBy !== undefined;
}
