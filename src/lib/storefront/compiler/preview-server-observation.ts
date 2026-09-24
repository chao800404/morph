import { sha256 } from "./theme-compiler-hasher";
import { THEME_PREVIEW_CONTENT_SNAPSHOT_MODULE_PATH } from "./theme-preview-content";
import { THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH } from "./theme-workspace-path";

/**
 * What a Live Preview start decided, written down where it can be read later.
 *
 * Several editor tabs share one preview container per author and Theme. When
 * one of them is slow, the questions are all about what the others did to the
 * shared container in the meantime: did a start find the workspace changed,
 * and if so which files; did it restart Vite, mint a new preview address, or
 * destroy the sandbox; and were two starts running at once. None of that was
 * recorded, so every answer was a guess. This records it, one line per
 * decision point, in a form that lines up with the Sandbox SDK's own
 * `Stale preview URL blocked` warnings by sandbox id and time.
 *
 * Observation only: nothing here changes what a start does.
 */

export type WorkspaceFileDigests = Readonly<Record<string, string>>;

/** Which side of the preview a workspace file belongs to. */
export type WorkspacePathKind = "preview-content" | "theme-source" | "platform";

const WORKSPACE_ROOT = "/workspace/";

/**
 * Digests each planned file the way the workspace fingerprint hashes it, so a
 * file that changes the fingerprint also changes its own digest.
 */
export function workspaceFileDigests(
  files: ReadonlyArray<{ path: string; content: string | Uint8Array }>,
): WorkspaceFileDigests {
  const digests: Record<string, string> = {};
  for (const file of files) {
    digests[file.path] = sha256(
      JSON.stringify(
        typeof file.content === "string"
          ? { type: "text", value: file.content }
          : { type: "bytes", value: Array.from(file.content) },
      ),
    );
  }
  return digests;
}

/**
 * The per-file digests of one committed workspace, and the fingerprint of
 * that workspace. The fingerprint is what makes a manifest usable for a
 * decision: it is trusted only while the workspace marker names the same
 * fingerprint, which holds only after a start wrote every file and then the
 * marker. An incremental sync marks the workspace `dirty` first, so a
 * manifest is never trusted across one.
 */
export type WorkspaceManifest = Readonly<{
  fingerprint: string | null;
  files: WorkspaceFileDigests;
}>;

export function serializeWorkspaceManifest(
  fingerprint: string,
  files: WorkspaceFileDigests,
): string {
  return JSON.stringify({ format: 2, fingerprint, files });
}

function readDigestMap(value: unknown): WorkspaceFileDigests | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const digests: Record<string, string> = {};
  for (const [path, digest] of Object.entries(value)) {
    if (typeof digest !== "string") return null;
    digests[path] = digest;
  }
  return digests;
}

/**
 * Reads a stored manifest, or null when there is none or it is malformed. A
 * manifest from before fingerprints were recorded reads with a null one, so
 * it can still be compared for the log but never trusted for a decision.
 */
export function parseWorkspaceManifest(
  raw: string | null | undefined,
): WorkspaceManifest | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as { format?: unknown }).format === 2
    ) {
      const { fingerprint, files } = parsed as {
        fingerprint?: unknown;
        files?: unknown;
      };
      const digests = readDigestMap(files);
      if (!digests || typeof fingerprint !== "string") return null;
      return { fingerprint, files: digests };
    }
    const legacy = readDigestMap(parsed);
    return legacy ? { fingerprint: null, files: legacy } : null;
  } catch {
    return null;
  }
}

/**
 * Whether a change touched only the draft content snapshot. Such a change is
 * data the running dev server reads on demand, so it needs no restart.
 */
export function isContentOnlyChange(change: WorkspaceChange): boolean {
  return (
    change.comparable &&
    change.added === 0 &&
    change.removed === 0 &&
    change.byKind["preview-content"] > 0 &&
    change.byKind["theme-source"] === 0 &&
    change.byKind.platform === 0
  );
}

/**
 * Whether a workspace path is the draft content snapshot, the author's source,
 * or something the platform generates around it (bridge, config, manifests).
 */
export function classifyWorkspacePath(
  absolutePath: string,
  themeSourcePaths: ReadonlySet<string>,
): WorkspacePathKind {
  const relative = absolutePath.startsWith(WORKSPACE_ROOT)
    ? absolutePath.slice(WORKSPACE_ROOT.length)
    : absolutePath;
  if (
    relative === THEME_PREVIEW_CONTENT_SNAPSHOT_MODULE_PATH ||
    relative === THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH
  ) {
    return "preview-content";
  }
  if (themeSourcePaths.has(relative)) return "theme-source";
  return "platform";
}

export type WorkspaceChange = Readonly<{
  /** False when there was no earlier manifest to compare with. */
  comparable: boolean;
  added: number;
  removed: number;
  changed: number;
  /** Changed, added or removed paths per kind. */
  byKind: Readonly<Record<WorkspacePathKind, number>>;
  /** A few of the paths, so a log line names what moved without listing all. */
  samplePaths: readonly string[];
  /** Every differing path, for deciding what to write. Not logged. */
  paths: readonly string[];
}>;

const SAMPLE_PATH_LIMIT = 8;

/** Which files differ between the workspace a start found and the one it plans. */
export function diffWorkspaceFileDigests(
  previous: WorkspaceFileDigests | null,
  next: WorkspaceFileDigests,
  themeSourcePaths: ReadonlySet<string>,
): WorkspaceChange {
  const byKind: Record<WorkspacePathKind, number> = {
    "preview-content": 0,
    "theme-source": 0,
    platform: 0,
  };
  if (!previous) {
    return {
      comparable: false,
      added: 0,
      removed: 0,
      changed: 0,
      byKind,
      samplePaths: [],
      paths: [],
    };
  }
  let added = 0;
  let removed = 0;
  let changed = 0;
  const differing: string[] = [];
  for (const [path, digest] of Object.entries(next)) {
    if (!(path in previous)) {
      added += 1;
      differing.push(path);
    } else if (previous[path] !== digest) {
      changed += 1;
      differing.push(path);
    }
  }
  for (const path of Object.keys(previous)) {
    if (!(path in next)) {
      removed += 1;
      differing.push(path);
    }
  }
  differing.sort();
  for (const path of differing) {
    byKind[classifyWorkspacePath(path, themeSourcePaths)] += 1;
  }
  return {
    comparable: true,
    added,
    removed,
    changed,
    byKind,
    samplePaths: differing.slice(0, SAMPLE_PATH_LIMIT),
    paths: differing,
  };
}

/**
 * A short stand-in for a preview address.
 *
 * The address is the preview's only credential, so it is never logged. Its
 * digest still tells two addresses apart, which is what shows that a port was
 * re-exposed and every page framing the old one lost it.
 */
export function previewAddressDigest(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  try {
    return sha256(new URL(url).hostname).slice(0, 12);
  } catch {
    return null;
  }
}

/** A short id that ties one start's log lines together. */
export function newPreviewAttemptId(): string {
  return crypto.randomUUID().slice(0, 8);
}

const inflightStarts = new Map<string, number>();

/**
 * Counts starts for one preview running at once in this isolate.
 *
 * A lower bound: starts in other isolates or Workers are not counted, which is
 * why each line also carries its start and end time — overlap across isolates
 * is read from those.
 */
export function enterPreviewStart(previewId: string): {
  concurrentAtEntry: number;
  leave: () => void;
} {
  const concurrentAtEntry = inflightStarts.get(previewId) ?? 0;
  inflightStarts.set(previewId, concurrentAtEntry + 1);
  let left = false;
  return {
    concurrentAtEntry,
    leave: () => {
      if (left) return;
      left = true;
      const remaining = (inflightStarts.get(previewId) ?? 1) - 1;
      if (remaining <= 0) inflightStarts.delete(previewId);
      else inflightStarts.set(previewId, remaining);
    },
  };
}

/**
 * Writes one observation line.
 *
 * One tag and one JSON object per line, so a terminal can be grepped for the
 * tag and a log pipeline can parse the rest.
 */
export function logPreviewServerEvent(
  event: string,
  fields: Readonly<Record<string, unknown>>,
): void {
  console.log(
    `[preview-observe] ${event} ${JSON.stringify({ at: new Date().toISOString(), ...fields })}`,
  );
}
