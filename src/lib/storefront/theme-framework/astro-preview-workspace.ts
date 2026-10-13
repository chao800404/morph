import { svgIsolationVitePluginSource } from "../theme-svg-isolation";
import { GENERATED_PREVIEW_BRIDGE_SOURCES } from "../compiler/preview-bridge-sources.generated";
import {
  THEME_PREVIEW_BRIDGE_PATH,
  themePreviewBridgeEntrySource,
} from "../compiler/theme-preview-bridge-entry";
import {
  THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH,
  THEME_PREVIEW_CONTENT_MODULE_PATH,
  THEME_PREVIEW_CONTENT_SNAPSHOT_MODULE_PATH,
  themePreviewContentDataSource,
  themePreviewContentModuleSource,
  themePreviewContentPluginSource,
  themePreviewContentSnapshotModuleSource,
} from "../compiler/theme-preview-content";
import {
  THEME_PREVIEW_SERVER_HMR_PATH,
  previewHttpHmrPluginSource,
  themePreviewFsAllowRoots,
  themePreviewServerSourcePluginSource,
} from "../compiler/theme-preview-dev-server";
import {
  THEME_PREVIEW_START_CLIENT_PATH,
  THEME_PREVIEW_START_WORKER_PATH,
  themePreviewStartWorkerSource,
} from "../compiler/theme-preview-start-runtime";
import {
  isBinaryWorkspaceFile,
  themeWorkspaceFingerprint,
  type PlanThemeWorkspaceInput,
  type PrepareThemeWorkspaceResult,
  type ThemeWorkspacePlanFile,
} from "../compiler/theme-sandbox-workspace";
import { ASTRO_PRERENDER_ENTRY } from "./astro-native-prerender";
import { nativeAstroAllowedPackages } from "./astro-native-build";
import { themeToolchainForFramework } from "./theme-toolchains";

/**
 * The workspace an Astro Live Preview runs in (docs/astro-theme-plan.md 2.4,
 * 2.5; A6).
 *
 * `astro dev` serves the project with its own `astro.config.*`, imported
 * unchanged by a wrapper Morph writes beside it, which only:
 *
 * - replaces the adapter with Morph's own `cloudflare(...)` call: no debugger
 *   port, no persisted Miniflare state, no remote bindings (section 7). A
 *   build runs the author's adapter as written; this is the preview only;
 * - turns the dev toolbar off;
 * - adds Morph's integration: the same Vite plugins every Live Preview has
 *   (HTTP HMR relay, server-source boundary, SVG isolation, draft content),
 *   an import guard judged on where an import resolves, and the dev server's
 *   filesystem, watch and HMR settings.
 *
 * The request path is the Start Live Preview's (2.5, R3): a preview Wrangler
 * config whose `main` is Morph's preview Worker entry wrapping Astro's own
 * server entry, given to the Cloudflare plugin through
 * `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH`. That one entry adds the content
 * origin header, refuses internal outbound requests and puts the editor's
 * scripts first in `<head>`.
 *
 * No file-language pass runs yet: `.astro` source gets no editor identity
 * until L1.5 (A6) and L2 (A7).
 */

/** The wrapper config `astro dev` is started with. */
export const ASTRO_PREVIEW_CONFIG_PATH = ".morph/astro.preview.config.mjs";
/** Morph's integration the wrapper adds. */
export const ASTRO_PREVIEW_INTEGRATION_PATH =
  ".morph/astro-preview-integration.mjs";
/** The preview's Wrangler config; its `main` is the preview Worker entry. */
export const ASTRO_PREVIEW_WRANGLER_PATH = ".morph/wrangler.preview.json";

const ASTRO_CONFIG = /^astro\.config\.(mjs|js|ts|mts)$/;

/**
 * Adapter options a Theme may pass that the preview's own adapter call does
 * not carry over (2.4). Named so the preview says which; carrying them over
 * from a static object literal is later work.
 */
const ADAPTER_OPTIONS_NOT_CARRIED = [
  "imageService",
  "sessionKVBindingName",
  "imagesBindingName",
  "prerenderEnvironment",
] as const;

/** How the dev server of an Astro Live Preview is started. */
export const ASTRO_PREVIEW_DEV_SERVER = {
  kind: "astro-dev",
  configPath: ASTRO_PREVIEW_CONFIG_PATH,
  env: {
    // Workspace-relative: the dev server runs in the workspace root.
    CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: ASTRO_PREVIEW_WRANGLER_PATH,
    ASTRO_TELEMETRY_DISABLED: "1",
  },
} as const;

/** Source of the client module every Astro Live Preview page loads. */
export function astroPreviewClientSource(): string {
  return `import { documentPreviewRuntimeChannel } from "/src/morph/preview/preview-protocol.ts";

// Read first, before anything can navigate away from the query the editor's
// channel is carried in.
documentPreviewRuntimeChannel();

// An Astro page is server-rendered HTML with islands; nothing hydrates the
// document as a whole, so the bridge loads once the document is parsed. No
// router is handed to it: an Astro page navigates as a document.
if (document.readyState === "loading") {
  await new Promise((resolve) =>
    document.addEventListener("DOMContentLoaded", resolve, { once: true }),
  );
}
await import("/${THEME_PREVIEW_CONTENT_MODULE_PATH}");
await import("/${THEME_PREVIEW_BRIDGE_PATH}");
`;
}

function wrapperConfigSource(themeConfigPath: string): string {
  return `// Written by Morph for this Live Preview (astro-preview-workspace.ts). The
// project's own config is imported unchanged; Morph replaces the adapter with
// the preview's own and adds its integration, last. A build does neither.
import { fileURLToPath } from "node:url";
import cloudflare from "@astrojs/cloudflare";
import themeConfig from ${JSON.stringify(`../${themeConfigPath}`)};
import { morphAstroPreview } from ${JSON.stringify(`./${ASTRO_PREVIEW_INTEGRATION_PATH.split("/").pop()}`)};

const own = (await themeConfig) ?? {};

export default {
  ...own,
  root: fileURLToPath(new URL("..", import.meta.url)),
  adapter: cloudflare({ inspectorPort: false, persistState: false, remoteBindings: false }),
  devToolbar: { enabled: false },
  integrations: [...(own.integrations ?? []), morphAstroPreview()],
};
`;
}

/**
 * The import guard of an Astro Live Preview: the build's rule (an import
 * resolves inside the workspace or inside an approved package), with the one
 * thing only a dev server does. A dependency Vite pre-bundled resolves into
 * the dependency cache (`depsCacheDir`, in the workspace), which names no
 * package, so it is judged by the package the Theme asked for.
 *
 * Judged by where the path is, never by reading it: Vite names a
 * dependency's file in the cache as soon as it discovers the dependency,
 * before its optimizer has written the directory, so the file may not exist
 * yet when its import is resolved.
 */
function previewImportGuardSource(): string {
  return `{
    name: "morph:astro-preview-import-guard",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || typeof source !== "string") return null;
      if (/^(\\0|virtual:|cloudflare:|node:|astro:)/.test(source)) return null;
      const from = importer.replace(/\\\\/g, "/");
      if (from.startsWith("\\0") || from.includes("/node_modules/")) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || resolved.external) return resolved ?? null;
      const id = resolved.id.split("?")[0].replace(/\\\\/g, "/");
      if (id.startsWith("\\0") || !path.isAbsolute(id)) return resolved;
      if (insideDepsCache(id)) {
        const bare = source.split("?")[0];
        if (bare.startsWith(".") || bare.startsWith("/") || path.isAbsolute(bare)) {
          // One pre-bundled chunk importing another.
          if (insideDepsCache(from.split("?")[0])) return resolved;
          throw new Error('UNAPPROVED_DEPENDENCY_PATH: Theme imports "' + source + '" by path from the dev server\\'s dependency cache.');
        }
        const segments = bare.split("/");
        const name = segments[0].startsWith("@") ? segments[0] + "/" + segments[1] : segments[0];
        if (!allowedPackages.has(name)) {
          throw new Error('UNAPPROVED_DEPENDENCY: Theme imports "' + source + '" from package "' + name + '", which is not an approved dependency.');
        }
        return resolved;
      }
      const packages = id.lastIndexOf("/node_modules/");
      if (packages >= 0) {
        const parts = id.slice(packages + "/node_modules/".length).split("/");
        const name = parts[0].startsWith("@") ? parts[0] + "/" + parts[1] : parts[0];
        if (!allowedPackages.has(name)) {
          throw new Error('UNAPPROVED_DEPENDENCY: Theme imports "' + source + '" from package "' + name + '", which is not an approved dependency.');
        }
        return resolved;
      }
      const relative = path.relative(workspaceRoot, fs.realpathSync(id));
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error('WORKSPACE_PATH_ESCAPE: Import "' + source + '" resolves outside the Theme.');
      }
      return resolved;
    },
  }`;
}

function integrationSource(options: {
  allowedPackages: readonly string[];
  fsAllow: readonly string[];
}): string {
  return `// Written by Morph for this Live Preview (astro-preview-workspace.ts).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = fs.realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const allowedPackages = new Set(${JSON.stringify([...new Set(options.allowedPackages)].sort())});
// The workspace's node_modules is a link to the shared, pinned toolchain;
// Vite's default cache under it would be shared by every preview, and written
// into the toolchain itself.
const depsCacheDir = path.join(workspaceRoot, ".vite");
// Path segments, not a string prefix: \`.vite-other/\` and \`.vite/../\` are
// not the cache.
const insideDepsCache = (file) => {
  const relative = path.relative(depsCacheDir, file);
  return relative !== "" && relative.split(path.sep)[0] !== ".." && !path.isAbsolute(relative);
};

const importGuard = ${previewImportGuardSource()};
const previewServerSourcePlugin = ${themePreviewServerSourcePluginSource()};
const previewSvgIsolationPlugin = ${svgIsolationVitePluginSource()};
const previewContentPlugin = ${themePreviewContentPluginSource()};
const previewHttpHmrPlugin = ${previewHttpHmrPluginSource()};

export function morphAstroPreview() {
  return {
    name: "morph:astro-preview",
    hooks: {
      "astro:config:setup": ({ updateConfig }) => {
        updateConfig({
          vite: {
            cacheDir: depsCacheDir,
            plugins: [
              previewServerSourcePlugin,
              previewSvgIsolationPlugin,
              previewContentPlugin,
              previewHttpHmrPlugin,
              importGuard,
            ],
            server: {
              // The port the transport exposes, or none: never another one
              // the exposed address does not point at.
              strictPort: true,
              // Only the workspace and the pinned toolchain are readable over
              // HTTP.
              fs: { strict: true, allow: ${JSON.stringify(options.fsAllow)} },
              // A container's writes arrive through the Sandbox API, not as
              // filesystem events; the local transport overrides this.
              watch: { usePolling: true, interval: 100 },
              hmr: { path: ${JSON.stringify(THEME_PREVIEW_SERVER_HMR_PATH)} },
            },
          },
        });
      },
    },
  };
}
`;
}

/**
 * The preview's Wrangler config. No bindings: the preview Worker has nothing
 * in \`env\` to reach, as a Start preview does not.
 */
function previewWranglerSource(previewId: string): string {
  return `${JSON.stringify(
    {
      name: `morph-preview-${previewId}`
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .slice(0, 63),
      main: `../${THEME_PREVIEW_START_WORKER_PATH}`,
      compatibility_date: "2026-09-01",
      compatibility_flags: ["nodejs_compat"],
    },
    null,
    2,
  )}\n`;
}

export function planAstroPreviewWorkspace(
  input: PlanThemeWorkspaceInput,
): PrepareThemeWorkspaceResult {
  const refuse = (
    stage: string,
    errorMessage: string,
  ): PrepareThemeWorkspaceResult => ({
    ok: false,
    stage,
    errorMessage,
    errors: [{ severity: "error", message: errorMessage }],
  });
  if (input.mode !== "preview-server") {
    return refuse(
      "preview-framework",
      "THEME_FRAMEWORK_UNAVAILABLE: An Astro project is built natively; there is no platform build to lay out.",
    );
  }
  const configs = input.files.filter((file) => ASTRO_CONFIG.test(file.path));
  if (configs.length !== 1) {
    return refuse(
      "preview-framework",
      configs.length === 0
        ? "NATIVE_ASTRO_CONFIG: The project has no astro.config.mjs."
        : `NATIVE_ASTRO_CONFIG: The project has more than one Astro config (${configs.map((file) => file.path).join(", ")}).`,
    );
  }
  const themeConfig = configs[0]!;
  const previewWarnings: Array<{ path: string; message: string }> = [];
  const configText = isBinaryWorkspaceFile(themeConfig)
    ? ""
    : themeConfig.content;
  const dropped = ADAPTER_OPTIONS_NOT_CARRIED.filter((option) =>
    new RegExp(`\\b${option}\\s*:`).test(configText),
  );
  if (dropped.length > 0) {
    previewWarnings.push({
      path: themeConfig.path,
      message: `The Live Preview runs the Cloudflare adapter with its own settings, so ${dropped.join(", ")} from this config do not apply in the preview. A build uses them as written.`,
    });
  }

  const workspaceRoot = "/workspace";
  const hostWorkspaceRoot = input.hostWorkspaceRoot ?? workspaceRoot;
  const toolchainRoot =
    input.toolchainRoot ?? themeToolchainForFramework("astro").root;
  const at = (relative: string) => `${workspaceRoot}/${relative}`;

  const workspaceFiles: ThemeWorkspacePlanFile[] = input.files.map((file) =>
    isBinaryWorkspaceFile(file)
      ? { path: at(file.path), binary: file.binary }
      : { path: at(file.path), content: file.content },
  );
  const generated: Array<{ path: string; content: string }> = [
    {
      path: ASTRO_PREVIEW_CONFIG_PATH,
      content: wrapperConfigSource(themeConfig.path),
    },
    {
      path: ASTRO_PREVIEW_INTEGRATION_PATH,
      content: integrationSource({
        allowedPackages: nativeAstroAllowedPackages(),
        fsAllow: themePreviewFsAllowRoots({ hostWorkspaceRoot, toolchainRoot }),
      }),
    },
    {
      path: ASTRO_PREVIEW_WRANGLER_PATH,
      content: previewWranglerSource(input.buildId),
    },
    {
      path: THEME_PREVIEW_START_WORKER_PATH,
      content: themePreviewStartWorkerSource(
        input.buildId,
        ASTRO_PRERENDER_ENTRY,
      ),
    },
    { path: THEME_PREVIEW_START_CLIENT_PATH, content: astroPreviewClientSource() },
    ...GENERATED_PREVIEW_BRIDGE_SOURCES.map((module) => ({
      path: module.path,
      content: module.content,
    })),
    { path: THEME_PREVIEW_BRIDGE_PATH, content: themePreviewBridgeEntrySource() },
    {
      path: THEME_PREVIEW_CONTENT_MODULE_PATH,
      content: themePreviewContentModuleSource(),
    },
    {
      path: THEME_PREVIEW_CONTENT_SNAPSHOT_MODULE_PATH,
      content: themePreviewContentSnapshotModuleSource(input.previewContent),
    },
    {
      path: THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH,
      content: themePreviewContentDataSource(input.previewContent),
    },
  ];
  const authored = new Set(input.files.map((file) => file.path));
  for (const file of generated) {
    if (authored.has(file.path)) {
      return refuse(
        "preview-workspace",
        `NATIVE_RESERVED_PATH: "${file.path}" is a file Morph writes for the Live Preview.`,
      );
    }
    workspaceFiles.push({ path: at(file.path), content: file.content });
  }

  return {
    ok: true,
    workspaceRoot,
    routeRegistry: null,
    hoistedContentFields: [],
    annotatedElements: {},
    previewSections: {},
    strippedEditorMarkers: {},
    previewWarnings,
    workspaceFiles,
    workspaceFingerprint: themeWorkspaceFingerprint(workspaceFiles),
  };
}
