import {
  GENERATED_MORPH_SDK_SOURCES,
  MORPH_SDK_SOURCE_HASH,
} from "./morph-sdk-sources.generated";

/**
 * How a TanStack Start Theme reads Morph content through the SDK.
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
  "@morph/sdk/astro": `${THEME_MORPH_SDK_ROOT}/astro/index.ts`,
};

/**
 * The platform's Astro middleware in a workspace (`@morph/sdk/astro`'s
 * per-render request), which Morph's Astro integrations add with
 * `addMiddleware`. Workspace-relative.
 */
export const THEME_MORPH_SDK_ASTRO_MIDDLEWARE = `${THEME_MORPH_SDK_ROOT}/astro/middleware.ts`;

/**
 * How a build names the SDK it was built with.
 *
 * The copy is platform-injected, not part of the Theme's revision, so the
 * revision's files — and so `inputHash` over them — do not change when the
 * SDK does. Without this, a build of the same revision after an SDK change
 * would carry the same identity as one before it, and a reuse of a succeeded
 * build by identity (`findSucceededBuildByIdentity`) could hand back an
 * artifact bundling the old SDK.
 *
 * So the SDK is folded into the compiler version every TanStack Start build
 * records, as semver build metadata: `<toolchain>+morph-sdk.<first 16 hex of
 * MORPH_SDK_SOURCE_HASH>`. The compiler version is already part of the
 * identity in every place it is used — the `inputHash` payload, the reuse
 * match, the runner's identity check, the artifact store's check — and it is
 * frozen on the build record when the build starts, so a recorded build keeps
 * naming the SDK it was built with and re-verifying its hash later does not
 * depend on what the SDK is now. No schema change: the column is the existing
 * `compiler_version`, and 16 hex characters keep the value within its
 * 50-character input limit.
 *
 * Read at call time, never at module scope: the identity test replaces the
 * hash to show a different SDK gives a different identity.
 */
export const THEME_MORPH_SDK_IDENTITY_HEX_LENGTH = 16;
export const THEME_MORPH_SDK_IDENTITY_SEPARATOR = "+morph-sdk.";

/** The full SHA-256 of the SDK sources this Morph injects. */
export function themeMorphSdkSourceHash(): string {
  return MORPH_SDK_SOURCE_HASH;
}

/** A Start toolchain version, with the injected SDK's identity appended. */
export function withThemeMorphSdkIdentity(toolchainVersion: string): string {
  return `${toolchainVersion}${THEME_MORPH_SDK_IDENTITY_SEPARATOR}${themeMorphSdkSourceHash().slice(
    0,
    THEME_MORPH_SDK_IDENTITY_HEX_LENGTH,
  )}`;
}

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
        exactNamePattern(name),
      )}), replacement: path.join(${rootExpression}, ${JSON.stringify(file)}) }`,
  );
  return `[\n  ${entries.join(",\n  ")},\n]`;
}

/**
 * The same aliases as values, for a Vite config built in process (the local
 * build runner). `resolve` maps a workspace-relative file to its path on the
 * filesystem the build runs on.
 */
export function themeMorphSdkAliases(
  resolve: (workspaceFile: string) => string,
): Array<{ find: RegExp; replacement: string }> {
  return Object.entries(THEME_MORPH_SDK_MODULES).map(([name, file]) => ({
    find: new RegExp(exactNamePattern(name)),
    replacement: resolve(file),
  }));
}

/** `^@morph\/sdk$`: the name itself, never a longer one under it. */
function exactNamePattern(name: string): string {
  return `^${name.replace(/[/]/g, "\\/")}$`;
}
