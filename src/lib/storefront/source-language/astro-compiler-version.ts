/**
 * The `@astrojs/compiler-rs` version Morph's own `.astro` parser is pinned to:
 * the parser Worker of docs/astro-theme-plan.md 0.3 (measured as M1c and
 * M1c-C with this version), through its `wasm32-wasi` binding.
 *
 * The Astro build toolchain loads the same package through a native binding
 * (`@astrojs/compiler-binding-linux-x64-gnu` in the Sandbox image). Positions
 * Morph reads with its parser have to match what Astro compiles, so the two
 * are kept to one version: a test checks this against the Astro toolchain's
 * lockfile (sandbox/toolchains/astro-7.3), both the version installed and the
 * range `astro` itself requires.
 */
export const MORPH_ASTRO_COMPILER_RS_VERSION = "0.5.1";
