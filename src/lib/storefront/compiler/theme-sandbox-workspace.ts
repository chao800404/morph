import { createThemeBuildBootstrap } from "./theme-router-build-bootstrap";
import { themePreviewServerStubPluginSource } from "./theme-preview-server-stub";
import {
  previewDevInfrastructureGuardSource,
  THEME_PREVIEW_DEP_OPTIMIZE_EXCLUDES,
  THEME_PREVIEW_FS_ALLOW_ROOTS,
  THEME_PREVIEW_SERVER_BASE_PATH,
  THEME_PREVIEW_SERVER_HMR_PATH,
} from "./theme-preview-dev-server";
import { GENERATED_SANDBOX_DEPENDENCY_VERSIONS } from "./theme-sandbox-dependencies.generated";
import { themePackageRoot } from "./theme-dependency-policy";
import { sha256 } from "./theme-compiler-hasher";
import { collectThemeImportProtectionDiagnosticsForBuild } from "./theme-import-protection";
import {
  readThemePathAliases,
  renderThemeViteAliases,
} from "./theme-path-aliases";
import { hoistColocatedContentFieldsForPreview } from "@/lib/storefront/ast/hoist-colocated-content-fields";
import { injectPreviewBindings } from "@/lib/storefront/ast/inject-preview-bindings";
import { stripEditorMarkers } from "@/lib/storefront/ast/strip-editor-markers";
import { GENERATED_PREVIEW_BRIDGE_SOURCES } from "./preview-bridge-sources.generated";
import {
  themePreviewBridgeEntrySource,
  THEME_PREVIEW_BRIDGE_PATH,
} from "./theme-preview-bridge-entry";
import type { ThemeBuildDiagnostic } from "./theme-build-runner.types";

/**
 * Lays out the container workspace a Theme is compiled or served from.
 *
 * A build and the Live Preview dev server need the same workspace: the same
 * Theme files, the same generated entry, the same pinned `package.json` and
 * the same `vite.config.ts` carrying the dependency allowlist and path
 * containment. Two copies of that would drift, and the preview is exactly
 * where a drift stays invisible until a customer's build disagrees with what
 * they were shown.
 */

/**
 * The part of a sandbox session this needs.
 *
 * Narrower than the full session on purpose: laying out a workspace is
 * writing files, and nothing here should be able to execute anything.
 */
export type ThemeWorkspaceWriter = {
  writeFile(filePath: string, content: string | Uint8Array): Promise<void>;
  mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void>;
};

export type ThemeWorkspaceFile = Readonly<{
  path: string;
  content: string | Uint8Array;
}>;

const WORKSPACE_WRITE_CONCURRENCY = 8;

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      if (item !== undefined) await operation(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () =>
      worker(),
    ),
  );
}

/**
 * Why the workspace is being written.
 *
 * `build` produces an artifact and keeps the Theme's source exactly as
 * authored. `preview-server` feeds a dev server, where a module that exports
 * anything but components drops out of React Fast Refresh — so the
 * co-located `contentFields` declaration, which has no runtime role, is
 * lifted out of the copy that is served.
 */
export type ThemeWorkspaceMode = "build" | "preview-server";

export type PrepareThemeWorkspaceInput = Readonly<{
  session: ThemeWorkspaceWriter;
  files: readonly ThemeWorkspaceFile[];
  entry: string;
  buildId: string;
  dependencies?: Readonly<Record<string, string>>;
  approvedDependencies: ReadonlySet<string>;
  mode: ThemeWorkspaceMode;
}>;

export type PlanThemeWorkspaceInput = Omit<
  PrepareThemeWorkspaceInput,
  "session"
>;

export type ThemeWorkspacePlanFile = Readonly<{
  path: string;
  content: string | Uint8Array;
}>;

export type PrepareThemeWorkspaceResult =
  | Readonly<{
      ok: true;
      workspaceRoot: string;
      routeRegistry: ReturnType<
        typeof createThemeBuildBootstrap
      >["routeRegistry"];
      /** Modules whose `contentFields` export was lifted, preview only. */
      hoistedContentFields: readonly string[];
      /** Elements given editor identity per file, preview only. */
      annotatedElements: Readonly<Record<string, number>>;
      /** Content slots given a section wrapper, per file. */
      previewSections: Readonly<Record<string, readonly string[]>>;
      /** Editor attributes removed per file, build only. */
      strippedEditorMarkers: Readonly<Record<string, number>>;
      /** Preview behaviour that will differ from the build, and why. */
      previewWarnings: ReadonlyArray<{ path: string; message: string }>;
      /** Exact final workspace bytes, before the cache marker is added. */
      workspaceFiles: readonly ThemeWorkspacePlanFile[];
      /** Changes whenever any generated or authored workspace byte changes. */
      workspaceFingerprint: string;
    }>
  | Readonly<{
      ok: false;
      stage: string;
      errorMessage: string;
      errors: ThemeBuildDiagnostic[];
    }>;

/**
 * Pinned exact toolchain versions for deterministic sandbox workspaces. The
 * generator derives this root-package map from cms.config.ts and the same
 * manifest is copied into Dockerfile.sandbox at image-build time.
 */
export const PINNED_SANDBOX_DEPENDENCIES: Readonly<Record<string, string>> =
  GENERATED_SANDBOX_DEPENDENCY_VERSIONS;

function packageRoot(specifier: string): string {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0] ?? specifier;
}

export function planThemeSandboxWorkspace({
  files: requestedFiles,
  entry,
  buildId,
  dependencies,
  approvedDependencies,
  mode,
}: PlanThemeWorkspaceInput): PrepareThemeWorkspaceResult {
  // A build ships none of the editor's attributes. The Theme's stored source
  // keeps them — that is where a hand-written marker is doing its job — but a
  // shopper has no use for them, and they describe the Theme's own source on
  // every page.
  const textFiles = requestedFiles.map((file) => ({
    path: file.path,
    content: typeof file.content === "string" ? file.content : "",
  }));
  const strip = mode === "build" ? stripEditorMarkers(textFiles) : null;
  const strippedByPath = new Map(
    (strip?.files ?? []).map((file) => [file.path, file.content]),
  );
  const sourceFiles: readonly ThemeWorkspaceFile[] = requestedFiles.map(
    (file) =>
      typeof file.content === "string" && strippedByPath.has(file.path)
        ? { path: file.path, content: strippedByPath.get(file.path)! }
        : file,
  );

  // Identity is written before the declaration is lifted, and the lift moves
  // no byte: injection reads `contentFields` to know which names are really
  // fields, and that reading only works while the module still exports it.
  // Run the other way round, every row field would be judged undeclared and
  // nothing repeated would be editable.
  const bindings =
    mode === "preview-server"
      ? injectPreviewBindings(
          sourceFiles.map((file) => ({
            path: file.path,
            content: typeof file.content === "string" ? file.content : "",
          })),
        )
      : null;
  const boundFiles: readonly ThemeWorkspaceFile[] = sourceFiles.map(
    (file, index) =>
      typeof file.content === "string" && bindings
        ? { path: file.path, content: bindings.files[index]!.content }
        : file,
  );

  const hoist =
    mode === "preview-server"
      ? hoistColocatedContentFieldsForPreview(
          boundFiles.map((file) => ({
            path: file.path,
            content: typeof file.content === "string" ? file.content : "",
          })),
        )
      : null;
  const hoistedByPath = new Map(
    (hoist?.hoisted ?? []).map((path) => [
      path,
      hoist!.files.find((file) => file.path === path)!.content,
    ]),
  );
  const files: readonly ThemeWorkspaceFile[] = boundFiles.map((file) =>
    hoistedByPath.has(file.path)
      ? { path: file.path, content: hoistedByPath.get(file.path)! }
      : file,
  );

  const workspaceRoot = "/workspace";
  // Assemble the complete workspace before touching the container. Besides
  // avoiding a partially-written workspace when validation fails, this lets
  // independent directory and file operations share a bounded number of
  // Sandbox RPCs instead of paying one round trip at a time.
  const pendingWrites = new Map<string, string | Uint8Array>();
  const queueWorkspaceFile = (
    filePath: string,
    content: string | Uint8Array,
  ) => {
    pendingWrites.set(filePath, content);
  };

  // Write virtual files into container workspace
  let hasCustomIndexHtml = false;
  const cssFiles: string[] = [];
  let routeRegistry: ReturnType<
    typeof createThemeBuildBootstrap
  >["routeRegistry"] = null;

  for (const file of files) {
    const fullPath = `${workspaceRoot}/${file.path.replace(/\\/g, "/")}`;
    queueWorkspaceFile(fullPath, file.content);

    if (file.path === "index.html") {
      hasCustomIndexHtml = true;
    }
    if (file.path.endsWith(".css")) {
      cssFiles.push(file.path);
    }
  }

  const bootstrap = createThemeBuildBootstrap({
    files: files.map((file) => ({
      path: file.path,
      content: typeof file.content === "string" ? file.content : "",
    })),
    entry: entry,
    cssFiles,
    exposeRouterForPreview: mode === "preview-server",
  });
  routeRegistry = bootstrap.routeRegistry;

  const pathAliasConfig = readThemePathAliases(
    files.map((file) => ({
      path: file.path,
      content: typeof file.content === "string" ? file.content : "",
    })),
  );
  if (pathAliasConfig.diagnostics.length > 0) {
    const errors: ThemeBuildDiagnostic[] = pathAliasConfig.diagnostics.map(
      (diagnostic) => ({
        severity: "error",
        message: diagnostic.message,
        file: diagnostic.filePath,
        line: diagnostic.line,
        column: diagnostic.column,
        code: diagnostic.code,
      }),
    );
    const firstError =
      errors[0]?.message ?? "Theme path alias configuration is invalid.";
    return {
      ok: false,
      stage: "path-aliases",
      errorMessage: firstError,
      errors,
    };
  }

  const importProtectionDiagnostics =
    collectThemeImportProtectionDiagnosticsForBuild(
      files.map((file) => ({
        path: file.path,
        content: typeof file.content === "string" ? file.content : "",
      })),
      {
        entry: entry,
        hasStartRuntime: Boolean(routeRegistry),
      },
    );
  if (importProtectionDiagnostics.length > 0) {
    const errors: ThemeBuildDiagnostic[] = importProtectionDiagnostics.map(
      (diagnostic) => ({
        severity: "error",
        message: diagnostic.message,
        file: diagnostic.filePath,
        line: diagnostic.line,
        column: diagnostic.column,
        code: diagnostic.code,
      }),
    );
    const firstError = errors[0]?.message ?? "Theme import protection failed.";
    return {
      ok: false,
      stage: "import-protection",
      errorMessage: firstError,
      errors,
    };
  }
  if (hasCustomIndexHtml && routeRegistry) {
    throw new Error(
      "CUSTOM_INDEX_HTML_UNSUPPORTED: TanStack Start Theme routes use the platform-owned preview document.",
    );
  }

  if (routeRegistry) {
    const routerFile = files.find(
      (file) => file.path.replace(/\\/g, "/") === "src/router.tsx",
    );
    if (!routerFile) {
      throw new Error(
        "MISSING_START_ROUTER: TanStack Start Theme requires src/router.tsx exporting getRouter().",
      );
    }
    queueWorkspaceFile(
      `${workspaceRoot}/wrangler.json`,
      JSON.stringify(
        {
          name: `morph-theme-${buildId}`
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "-")
            .slice(0, 63),
          compatibility_date: "2025-09-02",
          compatibility_flags: ["nodejs_compat"],
          main: "@tanstack/react-start/server-entry",
        },
        null,
        2,
      ),
    );
  }

  // Generate bootstrap entry and index.html if needed
  if (!hasCustomIndexHtml) {
    const bootstrapPath = `${workspaceRoot}/__entry.tsx`;
    queueWorkspaceFile(bootstrapPath, bootstrap.content);

    const indexPath = `${workspaceRoot}/index.html`;
    const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Storefront Theme</title>
  </head>
  <body>
<div id="root"></div>
<script type="module" src="/__entry.tsx"></script>${
      mode === "preview-server"
        ? `\n<script type="module" src="/${THEME_PREVIEW_BRIDGE_PATH}"></script>`
        : ""
    }
  </body>
</html>
`;
    queueWorkspaceFile(indexPath, indexHtml);
  }

  if (mode === "preview-server") {
    // The container holds no Morph code, so the protocol the bridge speaks
    // travels with the Theme. Written under src/morph/preview/ rather than
    // beside the author's components, so it is obvious this is platform code
    // and not something they wrote.
    for (const module of GENERATED_PREVIEW_BRIDGE_SOURCES) {
      queueWorkspaceFile(`${workspaceRoot}/${module.path}`, module.content);
    }
    queueWorkspaceFile(
      `${workspaceRoot}/${THEME_PREVIEW_BRIDGE_PATH}`,
      themePreviewBridgeEntrySource(),
    );
  }

  // Write controlled package.json with exact pinned dependencies (deterministic toolchain)
  const dependenciesObj: Record<string, string> = {};
  for (const dep of approvedDependencies) {
    const root = packageRoot(dep);
    const version =
      PINNED_SANDBOX_DEPENDENCIES[dep] ?? PINNED_SANDBOX_DEPENDENCIES[root];
    if (version) dependenciesObj[root] = version;
  }
  // The selected map is frozen into the build input by the server.  It is
  // still checked against the platform allowlist before reaching here;
  // keeping it explicit in package.json makes the artifact reproducible
  // and lets a newly-approved package be used after the sandbox image is
  // rebuilt from cms.config.
  for (const [specifier, version] of Object.entries(dependencies ?? {})) {
    dependenciesObj[themePackageRoot(specifier)] = version;
  }
  const packageJson = JSON.stringify(
    {
      name: "storefront-theme-build",
      private: true,
      type: "module",
      dependencies: dependenciesObj,
    },
    null,
    2,
  );
  queueWorkspaceFile(`${workspaceRoot}/package.json`, packageJson);

  // Write controlled vite.config.ts with Morph dependency enforcer AND workspace path containment inside container
  const approvedArrayJson = JSON.stringify(Array.from(approvedDependencies));
  const themeAliasDefinitionsJson = renderThemeViteAliases(
    pathAliasConfig,
    workspaceRoot,
  );
  const viteConfigContent = `
import path from "node:path";
import fs from "node:fs";
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

const approvedSet = new Set(${approvedArrayJson});
const themeAliasDefinitions = ${themeAliasDefinitionsJson};
const escapeAliasRegex = (value) => value.replace(/[\\^$.*+?()[\\]{}|]/g, "\\\\$&");
const themeAliases = themeAliasDefinitions.map(({ key, target, wildcard }) => ({
  find: wildcard ? key : new RegExp("^" + escapeAliasRegex(key) + "$"),
  replacement: target,
}));
const themeBaseUrlRoot = path.resolve("/workspace", ${JSON.stringify(pathAliasConfig.baseUrl)});
const themeBaseUrlPlugin = ${
    pathAliasConfig.baseUrl
      ? `{
  name: "morph-theme-base-url",
  enforce: "pre",
  resolveId(source) {
if (source.startsWith(".") || source.startsWith("/")) return null;
const candidateRoot = path.resolve(themeBaseUrlRoot, source);
const relative = path.relative("/workspace", candidateRoot);
if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
const candidates = [
  candidateRoot,
  ...[".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs"].map((extension) => candidateRoot + extension),
  ...[".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs"].map((extension) => candidateRoot + "/index" + extension),
];
return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
  },
}`
      : `null`
  };
const hasStartRuntime = ${routeRegistry ? "true" : "false"};
const isLivePreview = ${mode === "preview-server" ? "true" : "false"};
const isStartRuntimeBuild =
  hasStartRuntime && process.env.MORPH_THEME_BUILD_TARGET === "runtime";

// Vite's own HMR client and Refresh runtime, which only a dev server asks for.
// Allowed while serving the Live Preview and refused during a build, so the
// containment rule a build enforces is never relaxed by this file.
const isPreviewDevInfrastructure = ${previewDevInfrastructureGuardSource()};
let viteCommand = null;

const dependencyEnforcerPlugin = {
  name: "morph-dependency-enforcer",
  enforce: "pre",
  configResolved(config) {
viteCommand = config.command;
  },
  resolveId(source, importer) {
if (viteCommand === "serve" && isPreviewDevInfrastructure(source)) {
  return null;
}

if (importer && importer.includes("/node_modules/")) {
  return null;
}

// Enforce /workspace filesystem containment for relative and absolute imports
if (
  source.startsWith("./") ||
  source.startsWith("../") ||
  source.startsWith("/") ||
  path.isAbsolute(source)
) {
  let resolved;
  if (source.startsWith("/")) {
    resolved = path.resolve("/workspace", source.slice(1));
  } else if (path.isAbsolute(source)) {
    resolved = path.resolve(source);
  } else {
    const importerDir = importer ? path.dirname(importer) : "/workspace";
    resolved = path.resolve(importerDir, source);
  }

  const rel = path.relative("/workspace", resolved);
  const normalizedResolved = resolved.replace(/\\\\/g, "/");

  if (rel.startsWith("..") || !normalizedResolved.startsWith("/workspace")) {
    throw new Error(
      'WORKSPACE_PATH_ESCAPE: Import "' + source + '" resolves outside workspace root: "' + resolved + '"'
    );
  }

  if (normalizedResolved.includes("/node_modules")) {
    const normalizedImporter = typeof importer === "string"
      ? importer.replace(/\\\\/g, "/")
      : "";
    if (!normalizedImporter.startsWith("/workspace")) {
      return null;
    }
    throw new Error(
      'UNAPPROVED_DEPENDENCY_PATH: Direct filesystem imports from node_modules are forbidden in theme source files. Use approved bare module specifiers instead (attempted: "' + source + '").'
    );
  }

  return null;
}


if (typeof source === "string" && source.startsWith("\\0")) {
  return null;
}

if (
  typeof source === "string" &&
  (source.startsWith("virtual:") || source.startsWith("cloudflare:"))
) {
  const normalizedImporter = typeof importer === "string"
    ? importer.replace(/\\\\/g, "/")
    : "";
  if (
    !normalizedImporter ||
    normalizedImporter.startsWith("\\0") ||
    normalizedImporter.includes("/node_modules/") ||
    normalizedImporter.startsWith("virtual:")
  ) {
    return null;
  }
}

if (themeAliasDefinitions.some(({ key, wildcard }) =>
  wildcard ? source === key || source.startsWith(key + "/") : source === key
)) {
  return null;
}

const basePkg = source.startsWith("@")
  ? source.split("/").slice(0, 2).join("/")
  : source.split("/")[0];

if (!approvedSet.has(source) && !approvedSet.has(basePkg)) {
  throw new Error(
    "UNAPPROVED_DEPENDENCY: Theme imports unapproved module \\"" + source + "\\". Approved dependencies: " + Array.from(approvedSet).join(", ")
  );
}
return null;
  }
};

export default defineConfig({
  root: "${workspaceRoot}",
  base: isStartRuntimeBuild
? "/"
: isLivePreview
  ? ${JSON.stringify(THEME_PREVIEW_SERVER_BASE_PATH)}
  : "./",
  plugins: isStartRuntimeBuild
? [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    ...(themeBaseUrlPlugin ? [themeBaseUrlPlugin] : []),
    dependencyEnforcerPlugin,
  ]
: [
    // Preview is client-only and has no Start plugin, so the Start server
    // module and the Node builtin its storage context imports cannot
    // resolve. Stubbed here as well as in the in-process runner, from one
    // shared definition.
    ${themePreviewServerStubPluginSource()},
    tailwindcss(),
    viteReact(),
    ...(themeBaseUrlPlugin ? [themeBaseUrlPlugin] : []),
    dependencyEnforcerPlugin,
  ],
  resolve: {
alias: themeAliases,
  },
  // Keep these off esbuild's pre-bundling path so the preview's server-API
  // stubs, which are Rollup plugins, are what answers for them.
  optimizeDeps: {
exclude: ${JSON.stringify(THEME_PREVIEW_DEP_OPTIMIZE_EXCLUDES)},
  },
  // Which files a dev server may read off disk. Unset, Vite guesses a root;
  // the Live Preview states it instead, so nothing outside the workspace and
  // the pinned toolchain is reachable over HTTP.
  server: {
fs: {
  strict: true,
  allow: ${JSON.stringify(THEME_PREVIEW_FS_ALLOW_ROOTS)},
},
hmr: isLivePreview
  ? { path: ${JSON.stringify(THEME_PREVIEW_SERVER_HMR_PATH)} }
  : undefined,
  },
  build: {
outDir: isStartRuntimeBuild
  ? "${workspaceRoot}/dist/runtime"
  : hasStartRuntime
    ? "${workspaceRoot}/dist/preview"
    : "${workspaceRoot}/dist",
emptyOutDir: true,
minify: true,
cssMinify: true,
sourcemap: false,
  },
});

`;
  queueWorkspaceFile(`${workspaceRoot}/vite.config.ts`, viteConfigContent);

  const workspaceFiles = Array.from(pendingWrites, ([path, content]) => ({
    path,
    content,
  }));
  const workspaceFingerprint = sha256(
    JSON.stringify({
      format: 1,
      files: [...workspaceFiles]
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((file) => ({
          path: file.path,
          content:
            typeof file.content === "string"
              ? { type: "text", value: file.content }
              : { type: "bytes", value: Array.from(file.content) },
        })),
    }),
  );

  return {
    ok: true,
    workspaceRoot,
    routeRegistry,
    hoistedContentFields: hoist?.hoisted ?? [],
    annotatedElements: bindings?.annotated ?? {},
    previewSections: bindings?.sections ?? {},
    strippedEditorMarkers: strip?.stripped ?? {},
    previewWarnings: bindings?.warnings ?? [],
    workspaceFiles,
    workspaceFingerprint,
  };
}

export async function materializeThemeSandboxWorkspace(
  session: ThemeWorkspaceWriter,
  workspaceFiles: readonly ThemeWorkspacePlanFile[],
): Promise<void> {
  const workspaceRoot = "/workspace";
  await session.mkdir(workspaceRoot, { recursive: true });
  const directories = Array.from(
    new Set(
      workspaceFiles
        .map((file) => file.path.substring(0, file.path.lastIndexOf("/")))
        .filter((dirPath) => dirPath && dirPath !== workspaceRoot),
    ),
  );
  await runWithConcurrency(
    directories,
    WORKSPACE_WRITE_CONCURRENCY,
    async (dirPath) => session.mkdir(dirPath, { recursive: true }),
  );
  await runWithConcurrency(
    workspaceFiles,
    WORKSPACE_WRITE_CONCURRENCY,
    async (file) => session.writeFile(file.path, file.content),
  );
}

export async function prepareThemeSandboxWorkspace({
  session,
  ...input
}: PrepareThemeWorkspaceInput): Promise<PrepareThemeWorkspaceResult> {
  const plan = planThemeSandboxWorkspace(input);
  if (!plan.ok) return plan;
  await materializeThemeSandboxWorkspace(session, plan.workspaceFiles);
  return plan;
}
