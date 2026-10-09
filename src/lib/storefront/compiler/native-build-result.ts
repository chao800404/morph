import {
  resolveThemeFramework,
  type ThemeFrameworkOptions,
} from "../theme-framework";
import {
  NATIVE_PRERENDER_REFUSED_READS_PATH,
  NATIVE_PRERENDER_WITHOUT_SNAPSHOT,
  createNativePrerenderContent,
  type NativePrerenderContent,
} from "./theme-prerender-content";
import type { ThemeRouteRegistry } from "./theme-route-registry";
import type {
  ThemeBuildArtifactFile,
  ThemeBuildArtifactManifest,
  ThemeBuildRunnerInput,
  ThemeBuildRunnerLog,
  ThemeBuildRunnerResult,
} from "./theme-build-runner.types";

/**
 * A native build, run so that its result says whether the artifact carries
 * CMS content — proven by the build, not declared by the Theme.
 *
 * The first pass gets no content at all: the sealed snapshot is not in the
 * build's process, so whatever it produces cannot contain it, whatever the
 * project's own config does at build time. If that pass succeeds the
 * artifact is `independent`. If its prerender read Morph content (refused,
 * and recorded), the build is run again from a clean workspace with the
 * sealed content, and that artifact is `dependent`. Any other failure is the
 * build's own and is returned as it is.
 *
 * `pass` runs one complete build in a workspace holding nothing of an
 * earlier pass.
 */
export async function runNativeBuildPasses(options: {
  input: ThemeBuildRunnerInput;
  routeRegistry: ThemeRouteRegistry | null;
  addLog(level: "info" | "warn" | "error", message: string): void;
  pass(prerenderContent: NativePrerenderContent): Promise<ThemeBuildRunnerResult>;
}): Promise<ThemeBuildRunnerResult> {
  const first = await options.pass(NATIVE_PRERENDER_WITHOUT_SNAPSHOT);
  if (first.success) return { ...first, contentDependency: "independent" };
  if (
    !options.input.contentSnapshot ||
    first.diagnosticsJson?.stage !== "prerender-content"
  ) {
    return first;
  }
  options.addLog(
    "info",
    "Prerendering read Morph content: building again with this build's sealed content.",
  );
  const second = await options.pass(
    await createNativePrerenderContent(
      options.input.contentSnapshot,
      options.routeRegistry,
    ),
  );
  return second.success ? { ...second, contentDependency: "dependent" } : second;
}

/** Which paths' content reads were refused, and why, from the prerender's record. */
function refusedReadsMessage(record: Uint8Array | string): string {
  const reasons = new Map<string, string>();
  const text =
    typeof record === "string" ? record : new TextDecoder().decode(record);
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const read = JSON.parse(line) as { path?: unknown; reason?: unknown };
      if (typeof read.path === "string" && !reasons.has(read.path)) {
        reasons.set(
          read.path,
          typeof read.reason === "string" ? read.reason : "unknown",
        );
      }
    } catch {
      // A torn line still means a read was refused; the others say which.
    }
  }
  const detail = [...reasons]
    .slice(0, 10)
    .map(([path, reason]) => `${path} (${reason})`)
    .join(", ");
  return `NATIVE_PRERENDER_CONTENT_UNAVAILABLE: prerendering read Morph content this build has not sealed${detail ? `: ${detail}` : ""}. Build from the editor so the content is sealed with the build, or stop prerendering pages that read content.`;
}

const FAILURE_HEAD_CHARS = 6_000;
const FAILURE_TAIL_CHARS = 2_000;

/**
 * A failed native build's message, from what the build printed. The first
 * error printed is usually the cause and the last its consequence — the
 * prerender server's stack, then the Response Start threw on seeing a 500 —
 * so a long output keeps both ends, not just the tail.
 */
export function nativeBuildFailureMessage(output: string): string {
  if (output.length <= FAILURE_HEAD_CHARS + FAILURE_TAIL_CHARS) {
    return `NATIVE_BUILD_FAILED: ${output}`;
  }
  const omitted = output.length - FAILURE_HEAD_CHARS - FAILURE_TAIL_CHARS;
  return `NATIVE_BUILD_FAILED: ${output.slice(0, FAILURE_HEAD_CHARS)}\n… ${omitted} characters omitted …\n${output.slice(-FAILURE_TAIL_CHARS)}`;
}

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
  /** The pass's nonce, for frameworks whose prerender records carry one. */
  nonce?: string;
  /** The server's framework switches this runner was given. */
  frameworks?: ThemeFrameworkOptions;
  /**
   * The build's own command failed, with this stage and message. Its records
   * may still say why — a refused content read, which the passes act on.
   */
  buildFailure?: Readonly<{ stage: string; message: string }>;
}): ThemeBuildRunnerResult {
  const { input, routeRegistry, limits, logs, addLog, startTime } = options;
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

  // The framework the build records, not whichever one is the default: an
  // artifact is collected, verified and described by the rules of the
  // framework that built it.
  const framework = resolveThemeFramework(input.framework, options.frameworks);
  if (!framework.ok) return fail("framework", framework.message);
  const native = framework.framework.build.native;
  // A framework that binds its records to the pass gets nothing it can
  // accept without the pass's nonce.
  const nonce = options.nonce ?? "";

  if (options.buildFailure) {
    const cause = native.failedBuildCause?.(options.outputs, nonce);
    return cause
      ? fail(cause.stage, cause.message)
      : fail(options.buildFailure.stage, options.buildFailure.message);
  }

  if (native.prerenderRecordsFailure) {
    // Decided from the records, not from the build's exit code or the HTML:
    // a Theme that catches a failed read renders its defaults and the build
    // still succeeds.
    const records = native.prerenderRecordsFailure(options.outputs, nonce);
    if (records) return fail(records.stage, records.message);
  } else {
    // A page that read Morph content while prerendering, and was refused,
    // holds component defaults where the author's content belongs; Start
    // reports it as built. The read is the evidence, not the HTML.
    const refused = options.outputs.get(NATIVE_PRERENDER_REFUSED_READS_PATH);
    if (refused !== undefined) {
      return fail("prerender-content", refusedReadsMessage(refused));
    }
  }

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
