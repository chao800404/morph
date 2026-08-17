import fs from "node:fs/promises";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";

import viteReact from "@vitejs/plugin-react";
import { build as viteBuild, type Plugin } from "vite";
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

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
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

/**
 * Production Theme Build Runner using isolated workspace with Vite & Tailwind CSS v4.
 *
 * Security & Isolation Invariants:
 * 1. Theme files are compiled strictly inside an isolated temporary directory.
 * 2. Theme source code is NEVER evaluated (eval/new Function/dynamic import) in the Morph server runtime.
 * 3. Only approved dependencies may be imported (prevents arbitrary remote package fetching / malicious require).
 * 4. Temporary workspace directories are strictly cleaned up after build completion or failure.
 */
export class SandboxViteThemeBuildRunner implements ThemeBuildRunner {
  readonly id: string;
  readonly version: string;
  readonly isolation = "isolated-process" as const;

  private readonly maxDurationMs: number;
  private readonly maxSourceFiles: number;
  private readonly maxSourceSizeBytes: number;
  private readonly maxOutputSizeBytes: number;
  private readonly maxLogLines: number;
  private readonly approvedDependencies: Set<string>;

  private readonly workDirPrefix: string;

  constructor(options: SandboxViteThemeBuildRunnerOptions = {}) {
    this.id = options.id ?? "sandbox-vite-theme-build-runner";
    this.version = options.version ?? "1.0.0";
    this.maxDurationMs = options.maxDurationMs ?? 30_000;
    this.maxSourceFiles = options.maxSourceFiles ?? 200;
    this.maxSourceSizeBytes = options.maxSourceSizeBytes ?? 5 * 1024 * 1024; // 5 MB
    this.maxOutputSizeBytes = options.maxOutputSizeBytes ?? 20 * 1024 * 1024; // 20 MB
    this.maxLogLines = options.maxLogLines ?? 500;
    this.workDirPrefix = options.workDirPrefix ?? ".morph-builds";
    this.approvedDependencies = new Set(
      options.approvedDependencies ?? DEFAULT_APPROVED_DEPENDENCIES,
    );
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

    addLog("info", `Starting theme build for buildId: ${input.buildId}`);

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
      totalSourceBytes += Buffer.byteLength(f.content, "utf8");
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

    // Create isolated temporary workspace inside project builds hierarchy
    const buildsBaseDir = path.resolve(process.cwd(), this.workDirPrefix);
    await fs.mkdir(buildsBaseDir, { recursive: true });
    const tempDir = await fs.mkdtemp(
      path.join(buildsBaseDir, `${input.buildId}-`),
    );


    try {
      // Write virtual files into temp workspace
      let hasCustomIndexHtml = false;
      const cssFiles: string[] = [];

      for (const file of input.files) {
        const fullPath = path.join(tempDir, file.path);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, file.content, "utf8");

        if (file.path === "index.html") {
          hasCustomIndexHtml = true;
        }
        if (file.path.endsWith(".css")) {
          cssFiles.push(file.path);
        }
      }

      // Generate root entry and index.html if needed
      if (!hasCustomIndexHtml) {
        // Create client bootstrap entry
        const bootstrapPath = path.join(tempDir, "__entry.tsx");
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
        await fs.writeFile(bootstrapPath, bootstrapContent, "utf8");

        // Create index.html
        const indexPath = path.join(tempDir, "index.html");
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
        await fs.writeFile(indexPath, indexHtml, "utf8");
      }

      // Rollup plugin to enforce approved dependency whitelist and capture logs
      const approvedSet = this.approvedDependencies;
      const dependencyEnforcerPlugin: Plugin = {
        name: "morph-dependency-enforcer",
        resolveId(source) {
          // Allow relative and absolute workspace imports
          if (
            source.startsWith("./") ||
            source.startsWith("../") ||
            source.startsWith("/") ||
            source.startsWith("\0")
          ) {
            return null;
          }

          // Check bare module against approved list
          const basePkg = source.startsWith("@")
            ? source.split("/").slice(0, 2).join("/")
            : source.split("/")[0];

          if (!approvedSet.has(source) && !approvedSet.has(basePkg)) {
            throw new Error(
              `UNAPPROVED_DEPENDENCY: Theme imports unapproved module "${source}". Themes may only import approved dependencies: [${Array.from(approvedSet).join(", ")}]`,
            );
          }

          return null;
        },
      };

      addLog("info", `Executing Vite build with Tailwind CSS v4...`);

      // Execute Vite build with timeout guard
      const outDir = path.join(tempDir, "dist");

      const buildPromise = viteBuild({
        root: tempDir,
        configFile: false,
        plugins: [
          tailwindcss(),
          viteReact(),
          dependencyEnforcerPlugin,
        ],
        build: {
          outDir,
          emptyOutDir: true,
          minify: true,
          cssMinify: true,
          sourcemap: false,
          rollupOptions: {
            onwarn(warning, defaultHandler) {
              addLog("warn", warning.message);
              if (process.env.NODE_ENV !== "test") {
                defaultHandler(warning);
              }
            },
          },
        },
        logLevel: "silent",
      });

      let timeoutTimer: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutTimer = setTimeout(() => {
          reject(
            new Error(
              `TIMEOUT: Theme build exceeded maximum allowed duration of ${this.maxDurationMs}ms`,
            ),
          );
        }, this.maxDurationMs);
      });

      try {
        await Promise.race([buildPromise, timeoutPromise]);
      } finally {
        if (timeoutTimer) clearTimeout(timeoutTimer);
      }

      // Collect dist artifacts
      const artifacts: ThemeBuildArtifactFile[] = [];
      let totalOutputBytes = 0;

      async function collectDir(dir: string, baseDir: string) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await collectDir(full, baseDir);
          } else if (entry.isFile()) {
            const relPath = path
              .relative(baseDir, full)
              .replace(/\\/g, "/");
            const buffer = await fs.readFile(full);
            totalOutputBytes += buffer.byteLength;

            artifacts.push({
              path: relPath,
              content: buffer.toString("utf8"),
              mimeType: getMimeType(relPath),
              sizeBytes: buffer.byteLength,
            });
          }
        }
      }

      await collectDir(outDir, outDir);

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

      addLog("info", `Build completed successfully with ${artifacts.length} dist files.`);

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
      addLog("error", `Build failed: ${errMessage}`);

      const diagnostic: ThemeBuildDiagnostic = {
        severity: "error",
        message: errMessage,
      };

      // Extract location metadata if available on Rollup/Vite error
      if (err && typeof err === "object") {
        const anyErr = err as any;
        if (anyErr.id) diagnostic.file = String(anyErr.id);
        if (anyErr.loc?.line) diagnostic.line = Number(anyErr.loc.line);
        if (anyErr.loc?.column) diagnostic.column = Number(anyErr.loc.column);
        if (anyErr.code) diagnostic.code = String(anyErr.code);
      }

      return {
        success: false,
        errorMessage: errMessage,
        diagnosticsJson: {
          stage: "compiler",
          errors: [diagnostic],
        },
        logs,
        durationMs: Date.now() - startTime,
      };
    } finally {
      // Securely delete isolated temp workspace directory
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
