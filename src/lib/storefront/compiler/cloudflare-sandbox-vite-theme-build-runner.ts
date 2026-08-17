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

    // Guard 3: Validate Path Containment on all virtual files
    for (const file of input.files) {
      const normalized = file.path.replace(/\\/g, "/");
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

      // Generate bootstrap entry and index.html if needed
      if (!hasCustomIndexHtml) {
        const bootstrapPath = `${workspaceRoot}/__entry.tsx`;
        const cssImports = cssFiles
          .map((css) => `import "./${css.replace(/\\/g, "/")}";`)
          .join("\n");

        const normalizedEntry = input.entry.replace(/\\/g, "/");
        const bootstrapContent = `
import React from "react";
import { createRoot } from "react-dom/client";
${cssImports}
import EntryComponent from "./${normalizedEntry}";

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(React.createElement(EntryComponent));
}
`;
        await sandbox.writeFile(bootstrapPath, bootstrapContent);

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
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";

const approvedSet = new Set(${approvedArrayJson});

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
      if (rel.startsWith("..") || !resolved.startsWith("/workspace")) {
        throw new Error(
          'WORKSPACE_PATH_ESCAPE: Import "' + source + '" resolves outside workspace root: "' + resolved + '"'
        );
      }
      return null;
    }

    if (typeof source === "string" && source.startsWith("\\0")) {
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
  plugins: [tailwindcss(), viteReact(), dependencyEnforcerPlugin],
  build: {
    outDir: "${workspaceRoot}/dist",
    emptyOutDir: true,
    minify: true,
    cssMinify: true,
    sourcemap: false,
  },
});
`;
      await sandbox.writeFile(`${workspaceRoot}/vite.config.ts`, viteConfigContent);

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

      // Discover dist artifacts dynamically from container filesystem using find
      const findResult = await sandbox.exec(`find ${workspaceRoot}/dist -type f -print`);
      const filePaths = (findResult.stdout || "")
        .split("\n")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      if (filePaths.length === 0) {
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

      const distDir = `${workspaceRoot}/dist`;
      const artifacts: ThemeBuildArtifactFile[] = [];
      let totalOutputBytes = 0;

      for (const fullFilePath of filePaths) {
        const relPath = fullFilePath.startsWith(distDir)
          ? fullFilePath.slice(distDir.length).replace(/^\/+/, "")
          : fullFilePath;

        const mimeType = getMimeType(relPath);
        const isText = isTextMimeType(mimeType);

        let content: string | Uint8Array;
        let sizeBytes: number;

        if (isText) {
          const readResult = await sandbox.readFile(fullFilePath, { encoding: "utf-8" });
          const raw =
            readResult && typeof readResult === "object" && "content" in readResult
              ? readResult.content
              : readResult;
          content = typeof raw === "string" ? raw : new TextDecoder().decode(await fileContentToUint8Array(raw));
          sizeBytes = Buffer.byteLength(content, "utf8");
        } else {
          const readResult = await sandbox.readFile(fullFilePath, { encoding: "none" });
          const raw =
            readResult && typeof readResult === "object" && "content" in readResult
              ? readResult.content
              : readResult;
          content = await fileContentToUint8Array(raw);
          sizeBytes = content.byteLength;
        }

        totalOutputBytes += sizeBytes;

        artifacts.push({
          path: relPath,
          content,
          mimeType,
          sizeBytes,
        });
      }

      // Guard: Check output size limit
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

      const cssChunks = artifacts
        .filter((a) => a.mimeType === "text/css")
        .map((a) => a.path);
      const jsChunks = artifacts
        .filter((a) => a.mimeType === "application/javascript")
        .map((a) => a.path);

      const manifest: ThemeBuildArtifactManifest = {
        entry: input.entry,
        filesCount: input.files.length,
        inputHash: input.inputHash,
        bundleFiles: artifacts.map((a) => ({
          path: a.path,
          sizeBytes: a.sizeBytes ?? 0,
          mimeType: a.mimeType,
        })),
        cssChunks,
        jsChunks,
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
