import type { Sandbox } from "@cloudflare/sandbox";
import {
  DEFAULT_APPROVED_DEPENDENCIES,
  type SandboxViteThemeBuildRunnerOptions,
} from "./sandbox-vite-theme-build-runner.types";
import type {
  ThemeBuildArtifactFile,
  ThemeBuildArtifactManifest,
  ThemeBuildDiagnostic,
  ThemeBuildRunner,
  ThemeBuildRunnerInput,
  ThemeBuildRunnerLog,
  ThemeBuildRunnerResult,
} from "./theme-build-runner.types";
import { createThemeBuildBootstrap } from "./theme-router-build-bootstrap";
import { isPlatformOwnedThemeBuildPath } from "./theme-start-toolchain";

export type CloudflareSandboxExecResult = {
  exitCode?: number;
  success?: boolean;
  stdout: string;
  stderr: string;
};

export type CloudflareSandboxReadFileOptions = {
  encoding?: "utf-8" | "none" | "utf8" | "binary";
};

export type CloudflareSandboxReadFileResult = {
  content: string | Uint8Array | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;
};

/**
 * Formal contract for Cloudflare Sandbox container sessions.
 * Matches official @cloudflare/sandbox SandboxClient API.
 */
export interface CloudflareSandboxSession {
  writeFile(filePath: string, content: string | Uint8Array): Promise<void>;
  mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void>;
  readFile(
    filePath: string,
    options?: CloudflareSandboxReadFileOptions | "utf8" | "binary",
  ): Promise<CloudflareSandboxReadFileResult | string | Uint8Array>;
  exec(
    command: string,
    options?: { timeout?: number; timeoutMs?: number; env?: Record<string, string> },
  ): Promise<CloudflareSandboxExecResult>;
  killProcess?(pid?: number): Promise<void>;
  destroy(): Promise<void>;
}

export interface CloudflareSandboxProvider {
  getSandbox(binding: unknown, sandboxId: string): Promise<CloudflareSandboxSession>;
}

export type CloudflareSandboxViteRunnerOptions = SandboxViteThemeBuildRunnerOptions & {
  sandboxBinding?: unknown;
  sandboxProvider?: CloudflareSandboxProvider;
};

function getMimeType(filePath: string): string {
  const ext = filePath.includes(".") ? filePath.slice(filePath.lastIndexOf(".")).toLowerCase() : "";
  switch (ext) {
    case ".html":
      return "text/html";
    case ".js":
    case ".mjs":
      return "application/javascript";
    case ".css":
      return "text/css";
    case ".json":
      return "application/json";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".woff2":
      return "font/woff2";
    case ".woff":
      return "font/woff";
    case ".ttf":
      return "font/ttf";
    default:
      return "application/octet-stream";
  }
}

function isTextMimeType(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    mime === "application/javascript" ||
    mime === "application/json" ||
    mime === "image/svg+xml"
  );
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  let totalLength = 0;
  for (const arr of arrays) {
    totalLength += arr.length;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Converts any stream, buffer, or string payload into a pure Uint8Array.
 */
async function fileContentToUint8Array(content: unknown): Promise<Uint8Array> {
  if (content instanceof Uint8Array) {
    return content;
  }
  if (typeof content === "string") {
    return new TextEncoder().encode(content);
  }
  if (content && typeof (content as any)[Symbol.asyncIterator] === "function") {
    const chunks: Uint8Array[] = [];
    for await (const chunk of content as AsyncIterable<Uint8Array>) {
      chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
    }
    return concatUint8Arrays(chunks);
  }
  if (content && typeof (content as any).getReader === "function") {
    const reader = (content as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value instanceof Uint8Array ? value : new Uint8Array(value));
      }
    }
    return concatUint8Arrays(chunks);
  }
  return new Uint8Array(0);
}

/**
 * Pinned exact toolchain versions for deterministic sandbox builds.
 */
export const PINNED_SANDBOX_DEPENDENCIES: Record<string, string> = {
  "react": "19.2.1",
  "react-dom": "19.2.1",
  "clsx": "2.1.1",
  "tailwind-merge": "3.4.0",
  "lucide-react": "0.544.0",
  "class-variance-authority": "0.7.1",
  "tailwindcss": "4.1.17",
  "@tailwindcss/vite": "4.1.17",
  "@vitejs/plugin-react": "5.2.0",
  "vite": "7.2.7",
  "@tanstack/react-router": "1.170.18",
  "@tanstack/react-start": "1.168.32",
  "@tanstack/router-plugin": "1.168.23",
  "@cloudflare/vite-plugin": "1.50.0",
};

/**
 * Cloudflare Sandbox Vite Theme Build Runner.
 * Executes untrusted customer theme compilation inside an isolated Cloudflare Sandbox container.
 *
 * Security Invariants & Isolation Boundaries:
 * 1. Theme code executes strictly inside a dedicated Cloudflare Sandbox container session.
 * 2. Morph server runtime secrets (D1, R2 credentials, BetterAuth secrets) are NEVER passed into the container.
 * 3. Strict containment check prevents path traversal (e.g. `../../`) before files are transmitted.
 * 4. Pinned approved dependencies ensure deterministic builds with no wildcard npm downloads.
 * 5. Injected dependency allowlist and /workspace containment plugin blocks unapproved package imports and path escapes inside container Vite.
 * 6. On timeout, container process is killed and the sandbox session is immediately destroyed.
 * 7. True binary asset preservation for dist files (PNG, WOFF2, TTF kept as Uint8Array).
 */
export class CloudflareSandboxViteThemeBuildRunner implements ThemeBuildRunner {
  readonly id: string;
  readonly version: string;
  readonly isolation = "sandbox-container" as const;

  readonly compilerId = "tailwind-v4-build";
  readonly compilerVersion = "4.1.17";

  private readonly maxDurationMs: number;
  private readonly maxSourceFiles: number;
  private readonly maxSourceSizeBytes: number;
  private readonly maxOutputFiles: number;
  private readonly maxOutputSizeBytes: number;
  private readonly maxLogLines: number;
  private readonly approvedDependencies: Set<string>;
  private readonly sandboxBinding?: unknown;
  private readonly sandboxProvider?: CloudflareSandboxProvider;

  constructor(options: CloudflareSandboxViteRunnerOptions = {}) {
    this.id = options.id ?? "cloudflare-sandbox-vite-theme-build-runner";
    this.version = options.version ?? "1.0.0";
    this.maxDurationMs = options.maxDurationMs ?? 30_000;
    this.maxSourceFiles = options.maxSourceFiles ?? 200;
    this.maxSourceSizeBytes = options.maxSourceSizeBytes ?? 5 * 1024 * 1024; // 5 MB
    this.maxOutputFiles = options.maxOutputFiles ?? 200;
    this.maxOutputSizeBytes = options.maxOutputSizeBytes ?? 20 * 1024 * 1024; // 20 MB
    this.maxLogLines = options.maxLogLines ?? 500;
    this.approvedDependencies = new Set(
      options.approvedDependencies ?? DEFAULT_APPROVED_DEPENDENCIES,
    );
    this.sandboxBinding = options.sandboxBinding;
    this.sandboxProvider = options.sandboxProvider;
  }


  async run(input: ThemeBuildRunnerInput): Promise<ThemeBuildRunnerResult> {
    const startTime = Date.now();
    const logs: ThemeBuildRunnerLog[] = [];

    const addLog = (level: "info" | "warn" | "error", message: string) => {
      if (logs.length < this.maxLogLines) {
        logs.push({
          timestamp: new Date().toISOString(),
          level,
          message,
        });
      }
    };

    addLog("info", `Starting Cloudflare Sandbox theme build for buildId: ${input.buildId}`);

    // Guard 0: Verify Compiler Identity
    if (
      input.compilerId !== this.compilerId ||
      input.compilerVersion !== this.compilerVersion
    ) {
      const msg = `COMPILER_IDENTITY_MISMATCH: Runner toolchain is ${this.compilerId}@${this.compilerVersion}, but input requested ${input.compilerId}@${input.compilerVersion}`;
      addLog("error", msg);
      return {
        success: false,
        errorMessage: msg,
        diagnosticsJson: {
          stage: "compiler-identity",
          errors: [{ severity: "error", message: msg }],
        },
        logs,
        durationMs: Date.now() - startTime,
      };
    }

    // Guard 1: Check source files count limit
    if (input.files.length > this.maxSourceFiles) {
      const msg = `LIMIT_EXCEEDED: Theme exceeds max source files limit of ${this.maxSourceFiles} (received ${input.files.length})`;
      addLog("error", msg);
      return {
        success: false,
        errorMessage: msg,
        diagnosticsJson: {
          stage: "resource-limits",
          errors: [{ severity: "error", message: msg }],
        },
        logs,
        durationMs: Date.now() - startTime,
      };
    }

    // Guard 2: Check total source size limit
    let totalSourceBytes = 0;
    for (const f of input.files) {
      totalSourceBytes += Buffer.byteLength(String(f.content), "utf8");
    }

    if (totalSourceBytes > this.maxSourceSizeBytes) {
      const msg = `LIMIT_EXCEEDED: Theme total source size (${totalSourceBytes} bytes) exceeds limit of ${this.maxSourceSizeBytes} bytes`;
      addLog("error", msg);
      return {
        success: false,
        errorMessage: msg,
        diagnosticsJson: {
          stage: "resource-limits",
          errors: [{ severity: "error", message: msg }],
        },
        logs,
        durationMs: Date.now() - startTime,
      };
    }

    // Guard 3: Validate Path Containment and Reserved Paths on all virtual files
    for (const file of input.files) {
      const normalized = file.path.replace(/\\/g, "/");
      const segments = normalized.split("/");
      if (segments.some((segment) => segment.toLowerCase() === "node_modules")) {
        const msg = `RESERVED_THEME_PATH: Theme files cannot be created inside node_modules: "${file.path}"`;
        addLog("error", msg);
        return {
          success: false,
          errorMessage: msg,
          diagnosticsJson: {
            stage: "security-containment",
            errors: [{ severity: "error", message: msg }],
          },
          logs,
          durationMs: Date.now() - startTime,
        };
      }
      if (isPlatformOwnedThemeBuildPath(normalized)) {
        const msg = `RESERVED_THEME_BUILD_PATH: Theme source cannot replace platform-owned build file "${file.path}"`;
        addLog("error", msg);
        return {
          success: false,
          errorMessage: msg,
          diagnosticsJson: {
            stage: "security-containment",
            errors: [{ severity: "error", message: msg }],
          },
          logs,
          durationMs: Date.now() - startTime,
        };
      }
      if (normalized.startsWith("../") || normalized.includes("/../") || normalized.startsWith("/")) {
        const msg = `WORKSPACE_PATH_ESCAPE: File path "${file.path}" escapes sandbox workspace root`;
        addLog("error", msg);
        return {
          success: false,
          errorMessage: msg,
          diagnosticsJson: {
            stage: "security-containment",
            errors: [{ severity: "error", message: msg }],
          },
          logs,
          durationMs: Date.now() - startTime,
        };
      }
    }


    let sandbox: CloudflareSandboxSession | null = null;

    try {
      addLog("info", "Acquiring isolated Cloudflare Sandbox container session...");

      if (this.sandboxProvider) {
        sandbox = await this.sandboxProvider.getSandbox(this.sandboxBinding, input.buildId);
      } else if (this.sandboxBinding) {
        const { getSandbox } = await import("@cloudflare/sandbox");
        sandbox = getSandbox(this.sandboxBinding as DurableObjectNamespace<Sandbox>, input.buildId) as any;
      } else {
        const msg = "SANDBOX_UNAVAILABLE: Cloudflare Sandbox binding or provider is not configured in current environment";
        addLog("error", msg);
        return {
          success: false,
          errorMessage: msg,
          diagnosticsJson: {
            stage: "sandbox-init",
            errors: [{ severity: "error", message: msg }],
          },
          logs,
          durationMs: Date.now() - startTime,
        };
      }

      if (!sandbox) {
        throw new Error("Failed to initialize Cloudflare Sandbox session");
      }

      const workspaceRoot = "/workspace";
      await sandbox.mkdir(workspaceRoot, { recursive: true });

      // Write virtual files into container workspace
      let hasCustomIndexHtml = false;
      const cssFiles: string[] = [];
      let routeRegistry: ReturnType<
        typeof createThemeBuildBootstrap
      >["routeRegistry"] = null;

      for (const file of input.files) {
        const fullPath = `${workspaceRoot}/${file.path.replace(/\\/g, "/")}`;
        const dirPath = fullPath.substring(0, fullPath.lastIndexOf("/"));
        if (dirPath) {
          await sandbox.mkdir(dirPath, { recursive: true });
        }
        await sandbox.writeFile(fullPath, file.content);

        if (file.path === "index.html") {
          hasCustomIndexHtml = true;
        }
        if (file.path.endsWith(".css")) {
          cssFiles.push(file.path);
        }
      }

      const bootstrap = createThemeBuildBootstrap({
        files: input.files,
        entry: input.entry,
        cssFiles,
      });
      routeRegistry = bootstrap.routeRegistry;
      if (hasCustomIndexHtml && routeRegistry) {
        throw new Error(
          "CUSTOM_INDEX_HTML_UNSUPPORTED: TanStack Start Theme routes use the platform-owned preview document.",
        );
      }

      if (routeRegistry) {
        const routerFile = input.files.find(
          (file) => file.path.replace(/\\/g, "/") === "src/router.tsx",
        );
        if (!routerFile) {
          throw new Error(
            "MISSING_START_ROUTER: TanStack Start Theme requires src/router.tsx exporting getRouter().",
          );
        }
        await sandbox.writeFile(
          `${workspaceRoot}/wrangler.json`,
          JSON.stringify(
            {
              name: `morph-theme-${input.buildId}`
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
        await sandbox.writeFile(bootstrapPath, bootstrap.content);

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
    <script type="module" src="/__entry.tsx"></script>
  </body>
</html>
`;
        await sandbox.writeFile(indexPath, indexHtml);
      }

      // Write controlled package.json with exact pinned dependencies (deterministic toolchain)
      const dependenciesObj: Record<string, string> = {};
      for (const dep of this.approvedDependencies) {
        if (PINNED_SANDBOX_DEPENDENCIES[dep]) {
          dependenciesObj[dep] = PINNED_SANDBOX_DEPENDENCIES[dep];
        }
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
      await sandbox.writeFile(`${workspaceRoot}/package.json`, packageJson);

      // Write controlled vite.config.ts with Morph dependency enforcer AND workspace path containment inside container
      const approvedArrayJson = JSON.stringify(Array.from(this.approvedDependencies));
      const viteConfigContent = `
import path from "node:path";
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

const approvedSet = new Set(${approvedArrayJson});
const hasStartRuntime = ${routeRegistry ? "true" : "false"};
const isStartRuntimeBuild =
  hasStartRuntime && process.env.MORPH_THEME_BUILD_TARGET === "runtime";

const dependencyEnforcerPlugin = {
  name: "morph-dependency-enforcer",
  enforce: "pre",
  resolveId(source, importer) {
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
  base: isStartRuntimeBuild ? "/" : "./",
  plugins: isStartRuntimeBuild
    ? [
        cloudflare({ viteEnvironment: { name: "ssr" } }),
        tailwindcss(),
        tanstackStart(),
        viteReact(),
        dependencyEnforcerPlugin,
      ]
    : [tailwindcss(), viteReact(), dependencyEnforcerPlugin],
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
      await sandbox.writeFile(`${workspaceRoot}/vite.config.ts`, viteConfigContent);

      if (routeRegistry) {
        addLog(
          "info",
          "Executing platform-owned TanStack Start Cloudflare build inside Sandbox...",
        );
        const startExecResult = await sandbox.exec(
          `/opt/morph-toolchain/node_modules/.bin/vite build --config ${workspaceRoot}/vite.config.ts`,
          {
            timeout: this.maxDurationMs,
            timeoutMs: this.maxDurationMs,
            env: {
              NODE_ENV: "production",
              MORPH_THEME_BUILD_TARGET: "runtime",
            },
          },
        );
        if (startExecResult.stdout) addLog("info", startExecResult.stdout);
        const startSuccess =
          startExecResult.success ?? startExecResult.exitCode === 0;
        if (!startSuccess) {
          const errorMsg =
            startExecResult.stderr ||
            startExecResult.stdout ||
            "TanStack Start build exited with non-zero status code";
          return {
            success: false,
            errorMessage: errorMsg,
            diagnosticsJson: {
              stage: "sandbox-start-compiler",
              errors: [{ severity: "error", message: errorMsg }],
            },
            logs,
            durationMs: Date.now() - startTime,
          };
        }
      }

      addLog("info", "Executing Vite build inside Cloudflare Sandbox container...");

      // Execute build inside container with exact pinned Vite binary and timeout guard
      const execResult = await sandbox.exec(
        `/opt/morph-toolchain/node_modules/.bin/vite build --config ${workspaceRoot}/vite.config.ts`,
        {
          timeout: this.maxDurationMs,
          timeoutMs: this.maxDurationMs,
          // Zero Morph server secrets passed into container
          env: {
            NODE_ENV: "production",
            MORPH_THEME_BUILD_TARGET: "preview",
          },
        },
      );

      if (execResult.stdout) {
        addLog("info", execResult.stdout);
      }

      const isSuccess = execResult.success ?? execResult.exitCode === 0;
      if (!isSuccess) {
        const errorMsg = execResult.stderr || execResult.stdout || "Vite build exited with non-zero status code";
        addLog("error", errorMsg);

        const diagnostic: ThemeBuildDiagnostic = {
          severity: "error",
          message: errorMsg,
        };

        return {
          success: false,
          errorMessage: errorMsg,
          diagnosticsJson: {
            stage: "sandbox-compiler",
            errors: [diagnostic],
          },
          logs,
          durationMs: Date.now() - startTime,
        };
      }

      // Discover dist artifacts dynamically from container filesystem using find with stat
      const findResult = await sandbox.exec(
        `find ${workspaceRoot}/dist -type f -exec stat -c "%s %n" {} +`,
        {
          timeout: 10_000,
          timeoutMs: 10_000,
        },
      );

      const isFindSuccess = findResult.success ?? findResult.exitCode === 0;
      if (!isFindSuccess) {
        const errorMsg =
          findResult.stderr ||
          findResult.stdout ||
          "Failed to scan /workspace/dist output directory";
        addLog("error", errorMsg);
        return {
          success: false,
          errorMessage: `DIST_SCAN_FAILED: ${errorMsg}`,
          diagnosticsJson: {
            stage: "output-collection",
            errors: [{ severity: "error", message: errorMsg }],
          },
          logs,
          durationMs: Date.now() - startTime,
        };
      }

      const rawListing = (findResult.stdout || "").trim();
      const distDir = `${workspaceRoot}/dist`;


      // Parse metadata (size + path) from listing
      const metadataList: Array<{
        fullPath: string;
        relPath: string;
        sizeBytes: number;
        mimeType: string;
        isText: boolean;
      }> = [];

      for (const line of rawListing.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^(\d+)\s+(.+)$/);
        let size = 0;
        let fullFilePath = trimmed;
        if (match) {
          size = parseInt(match[1], 10);
          fullFilePath = match[2].trim();
        } else if (trimmed.startsWith(distDir) || trimmed.startsWith("/")) {
          fullFilePath = trimmed;
        }

        const relPath = fullFilePath.startsWith(distDir)
          ? fullFilePath.slice(distDir.length).replace(/^\/+/, "")
          : fullFilePath;

        const mimeType = getMimeType(relPath);
        const isText = isTextMimeType(mimeType);

        metadataList.push({
          fullPath: fullFilePath,
          relPath,
          sizeBytes: size,
          mimeType,
          isText,
        });
      }

      if (metadataList.length === 0) {
        const msg = "DIST_NOT_FOUND: Vite build did not produce any output files in /workspace/dist";
        addLog("error", msg);
        return {
          success: false,
          errorMessage: msg,
          diagnosticsJson: {
            stage: "output-collection",
            errors: [{ severity: "error", message: msg }],
          },
          logs,
          durationMs: Date.now() - startTime,
        };
      }

      // PREFLIGHT GUARD 1: Max output files limit
      if (metadataList.length > this.maxOutputFiles) {
        const msg = `LIMIT_EXCEEDED: Theme dist output file count (${metadataList.length}) exceeds limit of ${this.maxOutputFiles}`;
        addLog("error", msg);
        return {
          success: false,
          errorMessage: msg,
          diagnosticsJson: {
            stage: "output-limits",
            errors: [{ severity: "error", message: msg }],
          },
          logs,
          durationMs: Date.now() - startTime,
        };
      }

      // PREFLIGHT GUARD 2: Max output total size limit BEFORE reading bodies
      let totalEstimatedBytes = 0;
      for (const item of metadataList) {
        totalEstimatedBytes += item.sizeBytes;
      }

      if (totalEstimatedBytes > this.maxOutputSizeBytes) {
        const msg = `LIMIT_EXCEEDED: Theme dist output (${totalEstimatedBytes} bytes) exceeds limit of ${this.maxOutputSizeBytes} bytes`;
        addLog("error", msg);
        return {
          success: false,
          errorMessage: msg,
          diagnosticsJson: {
            stage: "output-limits",
            errors: [{ severity: "error", message: msg }],
          },
          logs,
          durationMs: Date.now() - startTime,
        };
      }

      // Only read file bodies after preflight checks pass
      const artifacts: ThemeBuildArtifactFile[] = [];
      let totalOutputBytes = 0;

      for (const item of metadataList) {
        let content: string | Uint8Array;
        let sizeBytes = item.sizeBytes;

        if (item.isText) {
          const readResult = await sandbox.readFile(item.fullPath, { encoding: "utf-8" });
          const raw =
            readResult && typeof readResult === "object" && "content" in readResult
              ? readResult.content
              : readResult;
          content = typeof raw === "string" ? raw : new TextDecoder().decode(await fileContentToUint8Array(raw));
          sizeBytes = Buffer.byteLength(content, "utf8");
        } else {
          const readResult = await sandbox.readFile(item.fullPath, { encoding: "none" });
          const raw =
            readResult && typeof readResult === "object" && "content" in readResult
              ? readResult.content
              : readResult;
          content = await fileContentToUint8Array(raw);
          sizeBytes = content.byteLength;
        }

        totalOutputBytes += sizeBytes;

        if (totalOutputBytes > this.maxOutputSizeBytes) {
          const msg = `LIMIT_EXCEEDED: Theme dist output (${totalOutputBytes} bytes) exceeds limit of ${this.maxOutputSizeBytes} bytes`;
          addLog("error", msg);
          return {
            success: false,
            errorMessage: msg,
            diagnosticsJson: {
              stage: "output-limits",
              errors: [{ severity: "error", message: msg }],
            },
            logs,
            durationMs: Date.now() - startTime,
          };
        }

        artifacts.push({
          path: item.relPath,
          content,
          mimeType: item.mimeType,
          sizeBytes,
        });
      }

      if (routeRegistry) {
        const artifactPaths = new Set(
          artifacts.map((artifact) => artifact.path),
        );
        if (!artifactPaths.has("runtime/server/index.js")) {
          throw new Error(
            "INCOMPLETE_START_ARTIFACT: TanStack Start build did not produce runtime/server/index.js.",
          );
        }
        if (!artifactPaths.has("preview/index.html")) {
          throw new Error(
            "INCOMPLETE_START_ARTIFACT: TanStack Start build did not produce preview/index.html.",
          );
        }
        if (
          !artifacts.some((artifact) =>
            artifact.path.startsWith("runtime/client/"),
          )
        ) {
          throw new Error(
            "INCOMPLETE_START_ARTIFACT: TanStack Start build did not produce runtime client assets.",
          );
        }
      }


      const cssChunks = artifacts
        .filter((a) => a.mimeType === "text/css")
        .map((a) => a.path);
      const jsChunks = artifacts
        .filter((a) => a.mimeType === "application/javascript")
        .map((a) => a.path);

      const manifest: ThemeBuildArtifactManifest = {
        entry: input.entry,
        artifactEntry: routeRegistry ? "preview/index.html" : "index.html",
        filesCount: input.files.length,
        inputHash: input.inputHash,
        bundleFiles: artifacts.map((a) => ({
          path: a.path,
          sizeBytes: a.sizeBytes ?? 0,
          mimeType: a.mimeType,
        })),
        cssChunks,
        jsChunks,
        metadata: routeRegistry
          ? {
              router: "tanstack-start",
              runtime: "cloudflare-worker",
              workerEntry: "runtime/server/index.js",
              clientAssetsDirectory: "runtime/client",
              previewRuntime: "tanstack-router-client",
              previewEntry: "preview/index.html",
              routes: routeRegistry.routes,
            }
          : undefined,
      };

      addLog("info", `Cloudflare Sandbox build completed with ${artifacts.length} dist files.`);

      return {
        success: true,
        artifacts,
        manifestJson: manifest,
        diagnosticsJson: { warnings: [] },
        logs,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      addLog("error", `Sandbox build error: ${errMessage}`);

      // Ensure timeout destroys container process immediately
      if (sandbox && errMessage.includes("TIMEOUT") && sandbox.killProcess) {
        try {
          await sandbox.killProcess();
        } catch {}
      }

      return {
        success: false,
        errorMessage: errMessage,
        diagnosticsJson: {
          stage: "sandbox-runtime",
          errors: [{ severity: "error", message: errMessage }],
        },
        logs,
        durationMs: Date.now() - startTime,
      };
    } finally {
      // Strictly destroy sandbox container session
      if (sandbox) {
        try {
          await sandbox.destroy();
        } catch {}
      }
    }
  }
}
