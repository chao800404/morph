import type { Sandbox } from "@cloudflare/sandbox";
import {
  createThemePrerenderContent,
  type NativePrerenderContent,
} from "./theme-prerender-content";
import { buildThemeRouteRegistry } from "./theme-route-registry";
import { themePublicTextMimeType } from "../theme-public-files";
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
import { refuseThemeWorkspacePath } from "./theme-workspace-path";
import { themePackageRoot } from "./theme-dependency-policy";
import { themeFramework } from "../theme-framework";
import {
  materializeThemeSandboxWorkspace,
  PINNED_SANDBOX_DEPENDENCIES,
  type ThemeWorkspaceBinaryLoader,
} from "./theme-sandbox-workspace";
import { writeSandboxWorkspaceFile } from "./sandbox-file-writer";
import type { ThemeBuildBinaryFile } from "@/lib/storefront/dto/storefront-theme-build.dto";
import { NATIVE_START_COMPILER_ID } from "./theme-build-materializer";
import { THEME_START_TOOLCHAIN } from "./theme-start-toolchain";
import {
  SANDBOX_START_BUDGET_MS,
  startBuildSandbox,
} from "./sandbox-build-start";
import { nativeAllowedPackages } from "../theme-framework/tanstack-start-native-build";
import {
  nativeBuildFailureMessage,
  nativeBuildResult,
  runNativeBuildPasses,
} from "./native-build-result";

/** The image's pinned Vite, the same binary the platform build runs. */
const NATIVE_VITE_BIN = "/opt/morph-toolchain/node_modules/.bin/vite";
/** Where a native build lays out the project, beside the image's toolchain link. */
const NATIVE_WORKSPACE_ROOT = "/workspace";

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
  content:
    | string
    | Uint8Array
    | ReadableStream<Uint8Array>
    | AsyncIterable<Uint8Array>;
};

/**
 * Formal contract for Cloudflare Sandbox container sessions.
 * Matches official @cloudflare/sandbox SandboxClient API.
 */
export interface CloudflareSandboxSession {
  /** Text only, as the SDK takes it; bytes go through `writeSandboxWorkspaceFile`. */
  writeFile(
    filePath: string,
    content: string,
    options?: { encoding?: string },
  ): Promise<unknown>;
  mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void>;
  readFile(
    filePath: string,
    options?: CloudflareSandboxReadFileOptions | "utf8" | "binary",
  ): Promise<CloudflareSandboxReadFileResult | string | Uint8Array>;
  exec(
    command: string,
    options?: {
      timeout?: number;
      timeoutMs?: number;
      /** Working directory; the SDK's default is `/workspace`. */
      cwd?: string;
      env?: Record<string, string>;
    },
  ): Promise<CloudflareSandboxExecResult>;
  killProcess?(pid?: number): Promise<void>;
  destroy(): Promise<void>;
}

export interface CloudflareSandboxProvider {
  getSandbox(
    binding: unknown,
    sandboxId: string,
  ): Promise<CloudflareSandboxSession>;
}

export type CloudflareSandboxViteRunnerOptions =
  SandboxViteThemeBuildRunnerOptions & {
    sandboxBinding?: unknown;
    sandboxProvider?: CloudflareSandboxProvider;
  };

function getMimeType(filePath: string): string {
  const publicTextType = themePublicTextMimeType(filePath);
  if (publicTextType) return publicTextType;
  const ext = filePath.includes(".")
    ? filePath.slice(filePath.lastIndexOf(".")).toLowerCase()
    : "";
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
        chunks.push(
          value instanceof Uint8Array ? value : new Uint8Array(value),
        );
      }
    }
    return concatUint8Arrays(chunks);
  }
  return new Uint8Array(0);
}

export { PINNED_SANDBOX_DEPENDENCIES };

function packageRoot(specifier: string): string {
  return themePackageRoot(specifier);
}

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
    // A hang detector, not a performance bound.
    //
    // This is the command timeout for the in-container build, so what it has to
    // catch is a build that has stopped making progress — not one that is merely
    // slow. A hung process never finishes, so any number far above the real
    // distribution catches it, while the cost of the number being too small is a
    // *rejected publish*, which is the customer-visible direction to be wrong in.
    // Measured in the local sandbox container — the same runner a deployment
    // uses — 16.2-17.4s typical, and 2 runs in 10 crossed 30s while ten leaked
    // containers competed for the machine. Tuning a kill threshold towards the
    // observed distribution buys nothing for hang detection and keeps that
    // failure class alive, so this sits well clear of it. Build *cost* is
    // measured by `durationMs` on the build timing line; this only reaps hangs.
    this.maxDurationMs = options.maxDurationMs ?? 120_000;
    this.maxSourceFiles = options.maxSourceFiles ?? 200;
    this.maxSourceSizeBytes = options.maxSourceSizeBytes ?? 5 * 1024 * 1024; // 5 MB
    this.maxOutputFiles = options.maxOutputFiles ?? 200;
    this.maxOutputSizeBytes = options.maxOutputSizeBytes ?? 20 * 1024 * 1024; // 20 MB
    this.maxLogLines = options.maxLogLines ?? 500;
    this.approvedDependencies = new Set(
      options.approvedDependencies ?? DEFAULT_APPROVED_DEPENDENCIES,
    );
    const missingVersions = [...this.approvedDependencies].filter(
      (specifier) =>
        !PINNED_SANDBOX_DEPENDENCIES[specifier] &&
        !PINNED_SANDBOX_DEPENDENCIES[packageRoot(specifier)],
    );
    if (missingVersions.length > 0) {
      throw new Error(
        `THEME_DEPENDENCY_VERSION_MISSING: ${missingVersions.join(", ")}`,
      );
    }
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

    addLog(
      "info",
      `Starting Cloudflare Sandbox theme build for buildId: ${input.buildId}`,
    );

    // Guard 0: Verify Compiler Identity. A native build is the project's own
    // toolchain at the pinned Start version; a platform build is this runner's.
    const expectedCompilerId =
      input.buildMode === "native" ? NATIVE_START_COMPILER_ID : this.compilerId;
    const expectedCompilerVersion =
      input.buildMode === "native"
        ? THEME_START_TOOLCHAIN.reactStart
        : this.compilerVersion;
    if (
      input.compilerId !== expectedCompilerId ||
      input.compilerVersion !== expectedCompilerVersion
    ) {
      const msg = `COMPILER_IDENTITY_MISMATCH: Runner toolchain is ${expectedCompilerId}@${expectedCompilerVersion}, but input requested ${input.compilerId}@${input.compilerVersion}`;
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

    // Guard 3: Path containment and reserved paths, by the same rule a Live
    // Preview update is held to.
    for (const file of input.files) {
      const refusal = refuseThemeWorkspacePath(file.path, {
        ownStartConfig: input.buildMode === "native",
      });
      if (refusal) {
        addLog("error", refusal);
        return {
          success: false,
          errorMessage: refusal,
          diagnosticsJson: {
            stage: "security-containment",
            errors: [{ severity: "error", message: refusal }],
          },
          logs,
          durationMs: Date.now() - startTime,
        };
      }
    }

    // Binary files: the same containment, and something to read them with.
    const binaryFiles = input.binaryFiles ?? [];
    for (const file of binaryFiles) {
      const refusal = refuseThemeWorkspacePath(file.path);
      if (refusal) {
        addLog("error", refusal);
        return {
          success: false,
          errorMessage: refusal,
          diagnosticsJson: {
            stage: "security-containment",
            errors: [{ severity: "error", message: refusal }],
          },
          logs,
          durationMs: Date.now() - startTime,
        };
      }
    }
    const readBinaryFile = input.readBinaryFile;
    if (binaryFiles.length > 0 && !readBinaryFile) {
      const msg =
        "BINARY_LOADER_MISSING: The build holds binary files but nothing can read their bytes.";
      addLog("error", msg);
      return {
        success: false,
        errorMessage: msg,
        diagnosticsJson: {
          stage: "binary-files",
          errors: [{ severity: "error", message: msg }],
        },
        logs,
        durationMs: Date.now() - startTime,
      };
    }

    let sandbox: CloudflareSandboxSession | null = null;

    try {
      addLog(
        "info",
        "Acquiring isolated Cloudflare Sandbox container session...",
      );

      let acquire: (() => Promise<CloudflareSandboxSession>) | null = null;
      if (this.sandboxProvider) {
        const provider = this.sandboxProvider;
        acquire = () => provider.getSandbox(this.sandboxBinding, input.buildId);
      } else if (this.sandboxBinding) {
        const { getSandbox } = await import("@cloudflare/sandbox");
        const binding = this.sandboxBinding as DurableObjectNamespace<Sandbox>;
        acquire = async () => getSandbox(binding, input.buildId) as any;
      }
      if (acquire) {
        // The start phase alone may be retried; see sandbox-build-start.ts.
        // Nothing of the Theme is written before it returns. It has its own
        // budget from the start of the run; the build commands after it keep
        // their own bound (`maxDurationMs` each), exactly as before.
        const startDeadline = startTime + SANDBOX_START_BUDGET_MS;
        sandbox = await startBuildSandbox({
          acquire,
          probe: (session) => {
            const timeout = Math.max(
              1,
              Math.min(60_000, startDeadline - Date.now()),
            );
            return session.exec("true", {
              cwd: "/",
              timeout,
              timeoutMs: timeout,
            });
          },
          destroy: (session) => session.destroy(),
          stillRunning: input.stillRunning,
          deadline: startDeadline,
          log: addLog,
        });
      } else {
        const msg =
          "SANDBOX_UNAVAILABLE: Cloudflare Sandbox binding or provider is not configured in current environment";
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

      const sandboxSession = sandbox;
      // Each read as it is written, a bounded number at a time.
      const loadBinary: ThemeWorkspaceBinaryLoader | undefined = readBinaryFile
        ? (ref) => readBinaryFile(ref.digest)
        : undefined;
      if (input.buildMode === "native") {
        return await this.runNativeBuild(input, {
          sandbox: sandboxSession,
          loadBinary,
          binaryFiles,
          addLog,
          logs,
          startTime,
        });
      }
      const prerenderContent = input.contentSnapshot
        ? await createThemePrerenderContent(
            input.contentSnapshot,
            buildThemeRouteRegistry(input.files),
          )
        : undefined;
      const prepared = themeFramework().planWorkspace({
        files: [
          ...input.files,
          ...binaryFiles.map((file) => ({
            path: file.path,
            binary: { digest: file.digest, sizeBytes: file.sizeBytes },
          })),
        ],
        loadBinary,
        entry: input.entry,
        buildId: input.buildId,
        dependencies: input.dependencies,
        approvedDependencies: this.approvedDependencies,
        mode: "build",
        contentSnapshot: input.contentSnapshot,
        prerenderContent,
      });
      if (!prepared.ok) {
        addLog("error", prepared.errorMessage);
        return {
          success: false,
          errorMessage: prepared.errorMessage,
          diagnosticsJson: {
            stage: prepared.stage,
            errors: prepared.errors,
          },
          logs,
          durationMs: Date.now() - startTime,
        };
      }
      await materializeThemeSandboxWorkspace(
        {
          writeFile: (filePath, content) =>
            writeSandboxWorkspaceFile(sandboxSession, filePath, content),
          mkdir: async (dirPath, options) => {
            await sandboxSession.mkdir(dirPath, options);
          },
        },
        prepared.workspaceFiles,
        { loadBinary },
      );
      const { workspaceRoot, routeRegistry } = prepared;

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
              NODE_OPTIONS: "--unhandled-rejections=strict",
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

      addLog(
        "info",
        "Executing Vite build inside Cloudflare Sandbox container...",
      );

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
        const errorMsg =
          execResult.stderr ||
          execResult.stdout ||
          "Vite build exited with non-zero status code";
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
        const msg =
          "DIST_NOT_FOUND: Vite build did not produce any output files in /workspace/dist";
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
          const readResult = await sandbox.readFile(item.fullPath, {
            encoding: "utf-8",
          });
          const raw =
            readResult &&
            typeof readResult === "object" &&
            "content" in readResult
              ? readResult.content
              : readResult;
          content =
            typeof raw === "string"
              ? raw
              : new TextDecoder().decode(await fileContentToUint8Array(raw));
          sizeBytes = Buffer.byteLength(content, "utf8");
        } else {
          const readResult = await sandbox.readFile(item.fullPath, {
            encoding: "none",
          });
          const raw =
            readResult &&
            typeof readResult === "object" &&
            "content" in readResult
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

      themeFramework().build.verifyArtifact({
        artifactPaths: new Set(artifacts.map((artifact) => artifact.path)),
        routeRegistry: routeRegistry ?? null,
        contentSnapshot: input.contentSnapshot,
      });

      const cssChunks = artifacts
        .filter((a) => a.mimeType === "text/css")
        .map((a) => a.path);
      const jsChunks = artifacts
        .filter((a) => a.mimeType === "application/javascript")
        .map((a) => a.path);

      const manifest: ThemeBuildArtifactManifest = {
        entry: input.entry,
        artifactEntry: themeFramework().build.artifactEntry(
          routeRegistry ?? null,
        ),
        filesCount: input.files.length,
        inputHash: input.inputHash,
        bundleFiles: artifacts.map((a) => ({
          path: a.path,
          sizeBytes: a.sizeBytes ?? 0,
          mimeType: a.mimeType,
        })),
        cssChunks,
        jsChunks,
        metadata: themeFramework().build.manifestMetadata(
          routeRegistry ?? null,
        ),
      };

      addLog(
        "info",
        `Cloudflare Sandbox build completed with ${artifacts.length} dist files.`,
      );

      return {
        success: true,
        artifacts,
        manifestJson: manifest,
        diagnosticsJson: { warnings: [] },
        logs,
        durationMs: Date.now() - startTime,
        // Content reaches a platform build only as the frozen prerender
        // content; without it the build never held any.
        contentDependency: prerenderContent ? "dependent" : "independent",
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
      // Strictly destroy sandbox container session. Bounded, and recorded
      // when it cannot be confirmed: a timed-out command is not proof that its
      // process stopped, and an unconfirmed teardown is not reported as done.
      if (sandbox) {
        const session = sandbox;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            session.destroy(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("did not finish within 30000 ms")),
                30_000,
              );
            }),
          ]);
        } catch (destroyError) {
          addLog(
            "warn",
            `Sandbox teardown could not be confirmed: ${destroyError instanceof Error ? destroyError.message : String(destroyError)}`,
          );
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
    }
  }

  /**
   * A native Start build in the container: the project's own configuration,
   * through Morph's wrapper (import guard, and the frozen content for
   * prerendering), with the image's pinned toolchain — `/workspace/node_modules`
   * is the image's link to it — and no Morph environment beyond what Vite
   * needs. The result is the shared native one (`nativeBuildResult`).
   */
  private async runNativeBuild(
    input: ThemeBuildRunnerInput,
    context: {
      sandbox: CloudflareSandboxSession;
      loadBinary: ThemeWorkspaceBinaryLoader | undefined;
      binaryFiles: ReadonlyArray<Readonly<ThemeBuildBinaryFile>>;
      addLog: (level: "info" | "warn" | "error", message: string) => void;
      logs: ThemeBuildRunnerLog[];
      startTime: number;
    },
  ): Promise<ThemeBuildRunnerResult> {
    const registry = buildThemeRouteRegistry(input.files);
    let passes = 0;
    return runNativeBuildPasses({
      input,
      routeRegistry: registry.valid ? registry : null,
      addLog: context.addLog,
      pass: async (prerenderContent) => {
        // A later pass starts from an empty workspace: nothing the earlier
        // one wrote, its record of refused reads included, may remain. The
        // toolchain link is the image's and stays.
        if (passes++ > 0) {
          const cleared = await context.sandbox.exec(
            `find ${NATIVE_WORKSPACE_ROOT} -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +`,
            { timeout: 30_000, timeoutMs: 30_000 },
          );
          if (!(cleared.success ?? cleared.exitCode === 0)) {
            context.addLog(
              "error",
              "Could not clear the workspace for the next pass.",
            );
            return {
              success: false,
              errorMessage: `WORKSPACE_RESET_FAILED: ${cleared.stderr || cleared.stdout || "could not clear the workspace"}`,
              diagnosticsJson: { stage: "native-workspace" },
              logs: context.logs,
              durationMs: Date.now() - context.startTime,
            };
          }
        }
        return this.runNativeBuildPass(input, context, prerenderContent);
      },
    });
  }

  /** One native build in the workspace, with what its prerender may read. */
  private async runNativeBuildPass(
    input: ThemeBuildRunnerInput,
    context: {
      sandbox: CloudflareSandboxSession;
      loadBinary: ThemeWorkspaceBinaryLoader | undefined;
      binaryFiles: ReadonlyArray<Readonly<ThemeBuildBinaryFile>>;
      addLog: (level: "info" | "warn" | "error", message: string) => void;
      logs: ThemeBuildRunnerLog[];
      startTime: number;
    },
    prerenderContent: NativePrerenderContent,
  ): Promise<ThemeBuildRunnerResult> {
    const { sandbox, loadBinary, binaryFiles, addLog, logs, startTime } =
      context;
    const root = NATIVE_WORKSPACE_ROOT;
    const fail = (stage: string, msg: string): ThemeBuildRunnerResult => {
      addLog("error", msg);
      return {
        success: false,
        errorMessage: msg,
        diagnosticsJson: {
          stage,
          errors: [{ severity: "error", message: msg }],
        },
        logs,
        durationMs: Date.now() - startTime,
      };
    };

    const registry = buildThemeRouteRegistry(input.files);
    const routeRegistry = registry.valid ? registry : null;
    const plan = themeFramework().build.native.plan(input.files, {
      allowedPackages: nativeAllowedPackages(this.approvedDependencies),
      prerenderContent,
    });
    if (!plan.ok) return fail("native-plan", plan.message);
    const [command, ...args] = plan.command;
    if (command !== "vite") {
      return fail("native-plan", `NATIVE_COMMAND: unexpected "${command}".`);
    }

    await materializeThemeSandboxWorkspace(
      {
        writeFile: (filePath, content) =>
          writeSandboxWorkspaceFile(sandbox, filePath, content),
        mkdir: async (dirPath, options) => {
          await sandbox.mkdir(dirPath, options);
        },
      },
      [
        ...plan.workspaceFiles.map((file) => ({
          path: `${root}/${file.path}`,
          content: file.content,
        })),
        ...binaryFiles.map((file) => ({
          path: `${root}/${file.path}`,
          binary: { digest: file.digest, sizeBytes: file.sizeBytes },
        })),
      ],
      { loadBinary },
    );

    addLog(
      "info",
      `Executing native Start build in Sandbox: vite ${args.join(" ")}`,
    );
    const built = await sandbox.exec(
      `${NATIVE_VITE_BIN} ${args.join(" ")} --logLevel error`,
      {
        cwd: root,
        timeout: this.maxDurationMs,
        timeoutMs: this.maxDurationMs,
        // Zero Morph server secrets: only what the build itself needs.
        env: {
          NODE_ENV: "production",
          ...plan.env,
          // The plan's options (its module hook) and this runner's own.
          NODE_OPTIONS: ["--unhandled-rejections=strict", plan.env.NODE_OPTIONS]
            .filter(Boolean)
            .join(" "),
        },
      },
    );
    if (built.stdout) addLog("info", built.stdout);
    if (!(built.success ?? built.exitCode === 0)) {
      return fail(
        "sandbox-native-compiler",
        nativeBuildFailureMessage(
          built.stderr ||
            built.stdout ||
            "vite build exited with a non-zero status",
        ),
      );
    }

    // Everything the build left in the workspace but the toolchain, bounded
    // before any body is read: the sources plus at most the output limit.
    const listed = await sandbox.exec(
      `find ${root} -path ${root}/node_modules -prune -o -type f -exec stat -c "%s %n" {} +`,
      { timeout: 10_000, timeoutMs: 10_000 },
    );
    if (!(listed.success ?? listed.exitCode === 0)) {
      return fail(
        "output-collection",
        `DIST_SCAN_FAILED: ${listed.stderr || listed.stdout || "could not list the workspace"}`,
      );
    }
    const entries: Array<{ fullPath: string; relPath: string; size: number }> =
      [];
    for (const line of (listed.stdout || "").split("\n")) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (!match) continue;
      const fullPath = match[2]!.trim();
      if (!fullPath.startsWith(`${root}/`)) continue;
      entries.push({
        fullPath,
        relPath: fullPath.slice(root.length + 1),
        size: Number.parseInt(match[1]!, 10),
      });
    }
    const readBudget = this.maxSourceSizeBytes + this.maxOutputSizeBytes;
    const listedBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    if (
      entries.length > this.maxSourceFiles + 2 * this.maxOutputFiles ||
      listedBytes > readBudget
    ) {
      return fail(
        "output-limits",
        `LIMIT_EXCEEDED: The native build left ${entries.length} files (${listedBytes} bytes) in the workspace.`,
      );
    }
    const outputs = new Map<string, Uint8Array>();
    for (const entry of entries) {
      const read = await sandbox.readFile(entry.fullPath, { encoding: "none" });
      const raw =
        read && typeof read === "object" && "content" in read
          ? read.content
          : read;
      outputs.set(entry.relPath, await fileContentToUint8Array(raw));
    }

    return nativeBuildResult({
      input,
      outputs,
      routeRegistry,
      limits: {
        maxOutputFiles: this.maxOutputFiles,
        maxOutputSizeBytes: this.maxOutputSizeBytes,
      },
      mimeType: getMimeType,
      isText: isTextMimeType,
      logs,
      addLog,
      startTime,
    });
  }
}
