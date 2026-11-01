// Types for the two imports the parser loader needs and that ship none.

/**
 * The compiler's precompiled module, imported through Wrangler's
 * `CompiledWasm` rule: workerd refuses to compile Wasm from bytes at runtime.
 */
declare module "@astrojs/compiler-binding-wasm32-wasi/astro.wasm32-wasi.wasm" {
  const module: WebAssembly.Module;
  export default module;
}

/**
 * The part of `@napi-rs/wasm-runtime` 1.2.5 the loader uses, as the official
 * `astro.wasi-browser.js` loader calls it. The package publishes no types.
 */
declare module "@napi-rs/wasm-runtime" {
  export class WASI {
    constructor(options: { version: "preview1" });
  }
  export function getDefaultContext(): unknown;
  export function instantiateNapiModuleSync(
    wasm: WebAssembly.Module,
    options: {
      context: unknown;
      asyncWorkPoolSize: number;
      wasi: WASI;
      onCreateWorker(): never;
      overwriteImports(importObject: {
        env?: Record<string, unknown>;
        napi?: Record<string, unknown>;
        emnapi?: Record<string, unknown>;
      }): unknown;
      beforeInit(options: { instance: WebAssembly.Instance }): void;
    },
  ): { napiModule: { exports: unknown } };
}
