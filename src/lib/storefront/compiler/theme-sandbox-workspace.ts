import { themePreviewDiagnosticScriptSource } from "./theme-preview-diagnostic-script";
import { createThemeBuildBootstrap } from "./theme-router-build-bootstrap";
import { isPlatformOwnedThemeBuildPath } from "./theme-start-toolchain";
import { themePreviewServerStubPluginSource } from "./theme-preview-server-stub";
import {
  previewDevInfrastructureGuardSource,
  SANDBOX_TOOLCHAIN_ROOT,
  THEME_PREVIEW_DEP_OPTIMIZE_EXCLUDES,
  THEME_PREVIEW_SERVER_BASE_PATH,
  THEME_PREVIEW_SERVER_HMR_PATH,
  themePreviewFsAllowRoots,
} from "./theme-preview-dev-server";
import { GENERATED_SANDBOX_DEPENDENCY_VERSIONS } from "./theme-sandbox-dependencies.generated";
import { themePackageRoot } from "./theme-dependency-policy";
import { sha256 } from "./theme-compiler-hasher";
import { collectThemeImportProtectionDiagnosticsForBuild } from "./theme-import-protection";
import {
  THEME_PREVIEW_WORKSPACE_FINGERPRINT_RELATIVE_PATH,
  THEME_PREVIEW_WORKSPACE_MANIFEST_RELATIVE_PATH,
} from "./theme-workspace-path";
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
import {
  THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH,
  THEME_PREVIEW_CONTENT_MODULE_PATH,
  THEME_PREVIEW_CONTENT_SNAPSHOT_MODULE_PATH,
  themePreviewContentDataSource,
  themePreviewContentModuleSource,
  themePreviewContentPluginSource,
  themePreviewContentSnapshotModuleSource,
  type ThemePreviewContentSnapshot,
} from "./theme-preview-content";

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
  /**
   * Present on persistent Sandbox sessions. Together these let a complete
   * materialization remove files that belonged to an older Theme plan.
   * Fresh, one-shot build writers may omit them because they have no prior
   * workspace to reconcile.
   */
  listFiles?(
    dirPath: string,
    options?: { recursive?: boolean; includeHidden?: boolean },
  ): Promise<{
    success: boolean;
    files: ReadonlyArray<{
      absolutePath: string;
      type: "file" | "directory" | "symlink" | "other";
    }>;
  }>;
  deleteFile?(filePath: string): Promise<unknown>;
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
  /** Render-only draft data, available solely to a preview workspace. */
  previewContent?: ThemePreviewContentSnapshot;
}>;

export type PlanThemeWorkspaceInput = Omit<
  PrepareThemeWorkspaceInput,
  "session"
> &
  Readonly<{
    /**
     * Filesystem root the generated `vite.config.ts` names.
     *
     * File paths in the plan stay in the workspace vocabulary — `/workspace/...`
     * — because a `ThemeWorkspaceWriter` translates them to wherever the
     * workspace really is. The generated config is different: it is source a
     * *toolchain* reads, and every path in it is resolved by that toolchain
     * against the real filesystem. In a container the two happen to be the same
     * string; a server running out of a checkout has them differ, and a config
     * still naming `/workspace` there fails its own containment check on the
     * first import.
     *
     * Defaults to the container's root, so the container's workspace is
     * unchanged.
     */
    hostWorkspaceRoot?: string;
    /**
     * Where the pinned toolchain's `node_modules` is, for the same config.
     *
     * Names a namespace, not a dependency list: the package allowlist is
     * separate and does not move with it.
     */
    toolchainRoot?: string;
  }>;

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
  previewContent,
  hostWorkspaceRoot: requestedHostWorkspaceRoot,
  toolchainRoot: requestedToolchainRoot,
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

  // Where the plan's file paths live. Always the container vocabulary, because
  // a writer is what turns it into a real location.
  const workspaceRoot = "/workspace";
  // Where the *toolchain* that reads the generated config will run. The same
  // place as the container's workspace, unless a caller says otherwise.
  const hostWorkspaceRoot = requestedHostWorkspaceRoot ?? workspaceRoot;
  const toolchainRoot = requestedToolchainRoot ?? SANDBOX_TOOLCHAIN_ROOT;
  // Interpolated into the generated config as strings rather than spliced in as
  // text: a host path can contain anything a path can, including a quote.
  const hostRootLiteral = JSON.stringify(hostWorkspaceRoot);
  const hostPathLiteral = (suffix: string) =>
    JSON.stringify(`${hostWorkspaceRoot}${suffix}`);
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
<title>Storefront Theme</title>${
      mode === "preview-server"
        ? `\n<script>${themePreviewDiagnosticScriptSource()}</script>`
        : ""
    }
  </head>
  <body>
<div id="root"${mode === "preview-server" ? ' data-storefront-preview-root="true"' : ""}></div>
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
    queueWorkspaceFile(
      `${workspaceRoot}/${THEME_PREVIEW_CONTENT_MODULE_PATH}`,
      themePreviewContentModuleSource(),
    );
    queueWorkspaceFile(
      `${workspaceRoot}/${THEME_PREVIEW_CONTENT_SNAPSHOT_MODULE_PATH}`,
      themePreviewContentSnapshotModuleSource(previewContent),
    );
    queueWorkspaceFile(
      `${workspaceRoot}/${THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH}`,
      themePreviewContentDataSource(previewContent),
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

  // Write controlled vite.config.ts with Morph dependency enforcer AND host
  // filesystem containment for the toolchain that reads it
  const approvedArrayJson = JSON.stringify(Array.from(approvedDependencies));
  const themeAliasDefinitionsJson = renderThemeViteAliases(
    pathAliasConfig,
    hostWorkspaceRoot,
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
// Route modules export TanStack Route objects, which are intentionally not a
// React Fast Refresh boundary. The generated preview entry accepts those
// modules and updates the existing router without replacing the iframe.
const previewRouteSourcePatterns = ${JSON.stringify(
    routeRegistry?.routes
      .filter((route) => !route.isVirtual)
      .map(
        (route) => `${hostWorkspaceRoot}/${route.sourcePath.replace(/\\/g, "/")}`,
      ) ?? [],
  )}.map((file) => new RegExp("^" + escapeAliasRegex(file) + "$"));
const previewReactExcludePatterns = [
  /\\/node_modules\\//,
  ...previewRouteSourcePatterns,
];
const themeBaseUrlRoot = path.resolve(${hostRootLiteral}, ${JSON.stringify(pathAliasConfig.baseUrl)});
const themeBaseUrlPlugin = ${
    pathAliasConfig.baseUrl
      ? `{
  name: "morph-theme-base-url",
  enforce: "pre",
  resolveId(source) {
if (source.startsWith(".") || source.startsWith("/")) return null;
const candidateRoot = path.resolve(themeBaseUrlRoot, source);
const relative = path.relative(${hostRootLiteral}, candidateRoot);
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
const previewContentPlugin = ${
    mode === "preview-server" ? themePreviewContentPluginSource() : "null"
  };
const isStartRuntimeBuild =
  hasStartRuntime && process.env.MORPH_THEME_BUILD_TARGET === "runtime";

// Cloudflare's local preview-port bridge currently cannot carry Vite's HMR
// WebSocket reliably. Keep Vite's own update calculation and browser handler,
// but move the payload across an HTTP request on the already-isolated preview
// origin. The browser still applies the native Vite/React Refresh payload, so
// component state survives source edits.
const previewHttpHmrPlugin = isLivePreview ? {
  name: "morph-preview-http-hmr",
  enforce: "post",
  configureServer(server) {
    let sequence = 0;
    const entries = [];
    const waiters = new Set();
    let quietTimer = null;
    const wakeAfterQuiet = () => {
      if (quietTimer !== null) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        quietTimer = null;
        for (const wake of waiters) wake();
        waiters.clear();
      }, 120);
    };
    const hot = server.environments.client.hot;
    const send = hot.send.bind(hot);
    hot.send = (payload, ...rest) => {
      if (payload && typeof payload === "object" && payload.type !== "connected") {
        sequence += 1;
        entries.push({ sequence, payload });
        if (entries.length > 100) entries.splice(0, entries.length - 100);
        wakeAfterQuiet();
      }
      return send(payload, ...rest);
    };
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url || "/", "http://preview.invalid");
      if (
        url.pathname !== "/__morph-theme-preview__/_morph/hmr" &&
        url.pathname !== "/_morph/hmr"
      ) return next();
      const after = Number(url.searchParams.get("after") || "0");
      const respond = () => {
        if (res.writableEnded) return;
        res.statusCode = 200;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(JSON.stringify({
          sequence,
          entries: entries.filter((entry) => entry.sequence > after),
        }));
      };
      if (url.searchParams.has("cursor") || entries.some((entry) => entry.sequence > after)) {
        setTimeout(respond, quietTimer === null ? 0 : 140);
        return;
      }
      waiters.add(respond);
      setTimeout(() => {
        waiters.delete(respond);
        respond();
      }, 5_000);
    });
  },
  transform(code, id) {
    if (!id.replace(/\\\\/g, "/").endsWith("/vite/dist/client/client.mjs")) return null;
    const connect = "transport.connect(createHMRHandler(handleMessage));";
    if (!code.includes(connect)) {
      throw new Error("MORPH_PREVIEW_HMR_CLIENT_CONTRACT_CHANGED");
    }
    return {
      code: code.replace(
        connect,
        "globalThis.__morphApplyViteHmrPayload = (payload) => handleMessage(payload);",
      ),
      map: null,
    };
  },
} : null;

// Vite's own HMR client and Refresh runtime, which only a dev server asks for.
// Allowed while serving the Live Preview and refused during a build, so the
// containment rule a build enforces is never relaxed by this file.
const isPreviewDevInfrastructure = ${previewDevInfrastructureGuardSource(toolchainRoot)};
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

// Enforce ${hostWorkspaceRoot} filesystem containment for relative and absolute imports
if (
  source.startsWith("./") ||
  source.startsWith("../") ||
  source.startsWith("/") ||
  path.isAbsolute(source)
) {
  let resolved;
  if (source.startsWith("/")) {
    resolved = path.resolve(${hostRootLiteral}, source.slice(1));
  } else if (path.isAbsolute(source)) {
    resolved = path.resolve(source);
  } else {
    const importerDir = importer ? path.dirname(importer) : ${hostRootLiteral};
    resolved = path.resolve(importerDir, source);
  }

  const rel = path.relative(${hostRootLiteral}, resolved);
  const normalizedResolved = resolved.replace(/\\\\/g, "/");

  if (
    !normalizedResolved.includes("/node_modules") &&
    (rel.startsWith("..") || !normalizedResolved.startsWith(${hostRootLiteral}))
  ) {
    throw new Error(
      'WORKSPACE_PATH_ESCAPE: Import "' + source + '" resolves outside workspace root: "' + resolved + '"'
    );
  }

  if (normalizedResolved.includes("/node_modules")) {
    const normalizedImporter = typeof importer === "string"
      ? importer.replace(/\\\\/g, "/")
      : "";
    if (!normalizedImporter.startsWith(${hostRootLiteral})) {
      return null;
    }
    if (viteCommand === "serve" && normalizedResolved.includes("/node_modules/.vite/")) {
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
  root: ${hostRootLiteral},
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
    ...(previewContentPlugin ? [previewContentPlugin] : []),
    ...(previewHttpHmrPlugin ? [previewHttpHmrPlugin] : []),
    tailwindcss(),
    viteReact({ exclude: previewReactExcludePatterns }),
    ...(themeBaseUrlPlugin ? [themeBaseUrlPlugin] : []),
    dependencyEnforcerPlugin,
  ],
  resolve: {
    alias: themeAliases,
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
  // Keep these off esbuild's pre-bundling path so the preview's server-API
  // stubs, which are Rollup plugins, are what answers for them.
  optimizeDeps: {
    include: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    exclude: ${JSON.stringify(THEME_PREVIEW_DEP_OPTIMIZE_EXCLUDES)},
  },
  // Which files a dev server may read off disk. Unset, Vite guesses a root;
  // the Live Preview states it instead, so nothing outside the workspace and
  // the pinned toolchain is reachable over HTTP.
  server: {
fs: {
  strict: true,
  allow: ${JSON.stringify(themePreviewFsAllowRoots({ hostWorkspaceRoot, toolchainRoot }))},
},
// Sandbox writes arrive through the container API rather than a local inotify
// stream. Polling is required for Vite to observe those writes and deliver HMR
// updates to the real React preview; it is enabled only for the dev server.
watch: isLivePreview
  ? { usePolling: true, interval: 100 }
  : undefined,
hmr: isLivePreview
  ? { path: ${JSON.stringify(THEME_PREVIEW_SERVER_HMR_PATH)} }
  : undefined,
  },
  build: {
outDir: isStartRuntimeBuild
  ? ${hostPathLiteral("/dist/runtime")}
  : hasStartRuntime
    ? ${hostPathLiteral("/dist/preview")}
    : ${hostPathLiteral("/dist")},
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

  // A warm Sandbox persists between preview restarts. Writing the new plan on
  // top of it is insufficient: a deleted component can still satisfy an old
  // import, so the preview keeps rendering source the editor no longer owns.
  // Reconcile regular files before writing and leave symlinks/directories
  // alone — notably /workspace/node_modules, which points at the image's
  // pinned toolchain. The fingerprint is committed by the preview server only
  // after this whole materialization succeeds, so it is platform metadata and
  // not part of the Theme file set.
  if (session.listFiles && session.deleteFile) {
    const listed = await session.listFiles(workspaceRoot, {
      recursive: true,
      includeHidden: true,
    });
    if (!listed.success) {
      // Deliberately fatal. Continuing would write the new plan over a
      // workspace nobody can describe, and the fingerprint committed
      // afterwards would then promise a reconciliation that never happened.
      throw new Error("Could not list the existing Theme preview workspace.");
    }
    const expectedPaths = new Set(workspaceFiles.map((file) => file.path));
    const fingerprintPath = `${workspaceRoot}/${THEME_PREVIEW_WORKSPACE_FINGERPRINT_RELATIVE_PATH}`;
    const manifestPath = `${workspaceRoot}/${THEME_PREVIEW_WORKSPACE_MANIFEST_RELATIVE_PATH}`;
    const staleFiles = listed.files
      .filter((entry) => entry.type === "file")
      .map((entry) => entry.absolutePath.replace(/\\/g, "/"))
      .filter(
        (filePath) =>
          filePath.startsWith(`${workspaceRoot}/`) &&
          !filePath.includes("/../") &&
          !filePath.startsWith(`${workspaceRoot}/node_modules/`) &&
          !filePath.startsWith(`${workspaceRoot}/.vite/`) &&
          !filePath.startsWith(`${workspaceRoot}/dist/`) &&
          !isPlatformOwnedThemeBuildPath(
            filePath.slice(workspaceRoot.length + 1),
          ) &&
          filePath !== fingerprintPath &&
          filePath !== manifestPath &&
          !expectedPaths.has(filePath),
      );
    await runWithConcurrency(
      staleFiles,
      WORKSPACE_WRITE_CONCURRENCY,
      async (filePath) =>
        session.deleteFile!(filePath)
          .then(() => undefined)
          .catch((error) => {
            const message =
              error instanceof Error ? error.message : String(error);
            const name = error instanceof Error ? error.name : "";
            if (
              name === "FileNotFoundError" ||
              message.toLowerCase().includes("not found") ||
              message.toLowerCase().includes("enoent")
            ) {
              return undefined;
            }
            throw error;
          }),
    );
  }

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
