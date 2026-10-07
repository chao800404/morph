import { themeFramework } from "../theme-framework";
import type { ThemeRouteRegistry } from "./theme-route-registry";
import type {
  ThemeBuildArtifactFile,
  ThemeBuildArtifactManifest,
  ThemeBuildRunnerInput,
  ThemeBuildRunnerLog,
  ThemeBuildRunnerResult,
} from "./theme-build-runner.types";

/**
 * A native build's result from the files it wrote, the same for every
 * runner: collected into Morph's artifact layout, held to the runner's
 * output limits, verified by the native artifact rule, and described by the
 * native manifest. Where the files were read from — a temporary directory,
 * a container — is the runner's; what counts as a native artifact is not.
 */
export function nativeBuildResult(options: {
  input: ThemeBuildRunnerInput;
  /** The workspace's files after the build, by workspace-relative path. */
  outputs: ReadonlyMap<string, Uint8Array | string>;
  routeRegistry: ThemeRouteRegistry | null;
  limits: Readonly<{ maxOutputFiles: number; maxOutputSizeBytes: number }>;
  mimeType(path: string): string;
  isText(mimeType: string): boolean;
  logs: ThemeBuildRunnerLog[];
  addLog(level: "info" | "warn" | "error", message: string): void;
  startTime: number;
}): ThemeBuildRunnerResult {
  const { input, routeRegistry, limits, logs, addLog, startTime } = options;
  const native = themeFramework().build.native;
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

  let collected: ReturnType<typeof native.collect>;
  try {
    collected = native.collect(options.outputs);
  } catch (error) {
    return fail(
      "output-collection",
      error instanceof Error ? error.message : String(error),
    );
  }

  const files = [...collected.files];
  if (files.length > limits.maxOutputFiles) {
    return fail(
      "output-limits",
      `LIMIT_EXCEEDED: Theme dist output file count (${files.length}) exceeds limit of ${limits.maxOutputFiles}`,
    );
  }
  const artifacts: ThemeBuildArtifactFile[] = files.map(
    ([relPath, content]) => {
      const bytes =
        typeof content === "string"
          ? new TextEncoder().encode(content)
          : content;
      const mimeType = options.mimeType(relPath);
      return {
        path: relPath,
        content: options.isText(mimeType)
          ? new TextDecoder().decode(bytes)
          : bytes,
        mimeType,
        sizeBytes: bytes.byteLength,
      };
    },
  );
  const totalBytes = artifacts.reduce(
    (sum, artifact) => sum + (artifact.sizeBytes ?? 0),
    0,
  );
  if (totalBytes > limits.maxOutputSizeBytes) {
    return fail(
      "output-limits",
      `LIMIT_EXCEEDED: Theme dist output (${totalBytes} bytes) exceeds limit of ${limits.maxOutputSizeBytes} bytes`,
    );
  }

  try {
    native.verifyArtifact({
      artifactPaths: new Set(artifacts.map((artifact) => artifact.path)),
      routeRegistry,
      contentSnapshot: input.contentSnapshot,
    });
  } catch (error) {
    return fail(
      "artifact-verification",
      error instanceof Error ? error.message : String(error),
    );
  }

  const manifest: ThemeBuildArtifactManifest = {
    entry: input.entry,
    artifactEntry: native.artifactEntry,
    filesCount: input.files.length,
    inputHash: input.inputHash,
    bundleFiles: artifacts.map((artifact) => ({
      path: artifact.path,
      sizeBytes: artifact.sizeBytes ?? 0,
      mimeType: artifact.mimeType,
    })),
    cssChunks: artifacts
      .filter((artifact) => artifact.mimeType === "text/css")
      .map((artifact) => artifact.path),
    jsChunks: artifacts
      .filter((artifact) => artifact.mimeType === "application/javascript")
      .map((artifact) => artifact.path),
    metadata: native.manifestMetadata(routeRegistry),
  };
  addLog(
    "info",
    `Native build completed with ${artifacts.length} artifact files.`,
  );
  return {
    success: true,
    artifacts,
    manifestJson: manifest,
    diagnosticsJson: { warnings: [] },
    logs,
    durationMs: Date.now() - startTime,
  };
}
