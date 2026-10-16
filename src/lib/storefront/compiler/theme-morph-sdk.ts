import { GENERATED_MORPH_SDK_SOURCES } from "./morph-sdk-sources.generated";

/**
 * How a TanStack Start Theme reads Morph content through the SDK (SPIKE,
 * M1b/M1c).
 *
 * Theme code imports two bare names:
 *
 * - `@morph/sdk`: the framework-agnostic core (`packages/morph-sdk/src`);
 * - `@morph/sdk/start`: the platform's thin entry, which names the request's
 *   content source from Start's `getRequest()` on each call
 *   (`packages/morph-sdk/start`).
 *
 * Neither is a package the Theme installs or a file it owns. Every build
 * workspace — Morph's own preview and build config
 * (theme-sandbox-workspace.ts) and a native project's wrapper
 * (tanstack-start-native-wrapper.ts) — gets the platform's copy under
 * `.morph/sdk/` and a Vite alias from each name to it. The copy is generated
 * from the package (scripts/generate-morph-sdk-sources.mjs), so the code a
 * Theme runs is the code the SDK's tests ran.
 */

/** Where the copy lives in a workspace, relative to its root. */
export const THEME_MORPH_SDK_ROOT = ".morph/sdk";

/** Each bare name a Theme may import, and the workspace file it resolves to. */
export const THEME_MORPH_SDK_MODULES: Readonly<Record<string, string>> = {
  "@morph/sdk": `${THEME_MORPH_SDK_ROOT}/src/index.ts`,
  "@morph/sdk/start": `${THEME_MORPH_SDK_ROOT}/start/index.ts`,
};

/** The SDK files a workspace carries, at paths relative to its root. */
export function themeMorphSdkFiles(): ReadonlyArray<{
  path: string;
  content: string;
}> {
  return GENERATED_MORPH_SDK_SOURCES;
}

/**
 * The aliases, as JavaScript source for a generated Vite config: an array of
 * `{ find, replacement }` with exact-match patterns, so `@morph/sdk/other`
 * is not quietly mapped into the copy. `rootExpression` is source evaluating
 * to the workspace's root on the filesystem the toolchain runs on.
 */
export function themeMorphSdkAliasesSource(rootExpression: string): string {
  const entries = Object.entries(THEME_MORPH_SDK_MODULES).map(
    ([name, file]) =>
      `{ find: new RegExp(${JSON.stringify(
        `^${name.replace(/[/]/g, "\\/")}$`,
      )}), replacement: path.join(${rootExpression}, ${JSON.stringify(file)}) }`,
  );
  return `[\n  ${entries.join(",\n  ")},\n]`;
}
