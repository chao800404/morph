import { ThemeSyncApiRefusal, type ThemeSyncClient } from "./sync-client";
import { normalizeSyncText, syncContentHash } from "./sync-content";
import { themeSyncPathExclusion } from "./sync-paths";
import {
  massDeletionWarning,
  planSync,
  remoteChangedTextPaths,
  type SyncAction,
  type SyncBaseEntry,
  type SyncRemoteEntry,
} from "./sync-plan";
import { THEME_SYNC_LIMITS } from "./sync-protocol";

/**
 * One local folder kept in step with one Theme's workspace.
 *
 * A cycle reads both sides, plans with `planSync`, and applies the plan:
 * workspace changes are written to disk, local changes are saved in one
 * batch carrying the generation and versions they were planned against.
 * When the workspace moved in between, the save is refused and nothing is
 * written; the next cycle plans again from what is there.
 *
 * The base (`SyncState.files`) only moves for what was actually copied, so a
 * cycle cut short leaves the next one to finish it, never to guess.
 */

export type SyncState = {
  protocol: 1;
  origin: string;
  storefrontId: string;
  themeId: string;
  /** The generation the base was taken at; null before the first cycle. */
  sourceGeneration: number | null;
  files: Record<string, SyncBaseEntry>;
};

export type LocalScanEntry = Readonly<{ text: string; hash: string }>;

export type LocalSkip = Readonly<{
  path: string;
  reason: "too-large" | "not-utf8" | "not-synced";
  detail?: string;
}>;

/** The local side, as the session needs it; `sync-local-fs.ts` on disk. */
export interface SyncLocalFolder {
  scan(): Promise<{ files: Map<string, LocalScanEntry>; skipped: LocalSkip[] }>;
  /** The file's current text, or null when it is absent or unreadable. */
  read(path: string): Promise<string | null>;
  /** Writes the workspace's text, keeping the file's own line endings. */
  write(path: string, text: string): Promise<void>;
  /** Moves the file aside rather than deleting it outright. */
  remove(path: string): Promise<void>;
  writeConflictCopy(path: string, remoteText: string): Promise<void>;
  removeConflictCopy(path: string): Promise<void>;
}

export type CyclePlanSummary = Readonly<{
  uploads: string[];
  remoteDeletions: string[];
  downloads: string[];
  localDeletions: string[];
  conflicts: Array<{ path: string; reason: string }>;
  binarySkipped: string[];
  localSkipped: LocalSkip[];
  massDeletion: string | null;
}>;

export type CycleResult =
  | Readonly<{ status: "applied"; summary: CyclePlanSummary; sourceGeneration: number }>
  | Readonly<{ status: "declined"; summary: CyclePlanSummary }>
  | Readonly<{ status: "retry"; summary: CyclePlanSummary; reason: string }>;

export type SyncSessionOptions = Readonly<{
  client: ThemeSyncClient;
  folder: SyncLocalFolder;
  state: SyncState;
  saveState(state: SyncState): Promise<void>;
  /**
   * Asked before a plan is applied when it needs a person: always on the
   * first cycle of a run with anything to do (changes made while sync was
   * not running), and whenever it would delete files en masse.
   */
  confirm(summary: CyclePlanSummary, why: "startup" | "mass-deletion"): Promise<boolean>;
}>;

function summarize(
  actions: readonly SyncAction[],
  localSkipped: LocalSkip[],
  massDeletion: string | null,
): CyclePlanSummary {
  const of = (kind: SyncAction["kind"]) =>
    actions.filter((action) => action.kind === kind).map((action) => action.path);
  return {
    uploads: of("upload"),
    remoteDeletions: of("delete-remote"),
    downloads: of("download"),
    localDeletions: of("delete-local"),
    conflicts: actions.flatMap((action) =>
      action.kind === "conflict" ? [{ path: action.path, reason: action.reason }] : [],
    ),
    binarySkipped: of("skip-binary"),
    localSkipped,
    massDeletion,
  };
}

const hasWork = (summary: CyclePlanSummary) =>
  summary.uploads.length +
    summary.remoteDeletions.length +
    summary.downloads.length +
    summary.localDeletions.length +
    summary.conflicts.length >
  0;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

export function createSyncSession(options: SyncSessionOptions) {
  const { client, folder } = options;
  const state = options.state;
  let firstCycle = true;

  async function persist() {
    await options.saveState(state);
  }

  /** Reads the workspace text files that moved, in bounded requests. */
  async function readRemote(paths: readonly string[]) {
    const contents = new Map<string, { id: string; version: number; content: string }>();
    for (const batch of chunks(paths, THEME_SYNC_LIMITS.maxFilesPerRead)) {
      const response = await client.read(batch);
      for (const file of response.files) contents.set(file.path, file);
      if (response.missing.length > 0) {
        throw new ThemeSyncApiRefusal(
          409,
          "SOURCE_GENERATION_CONFLICT",
          "The workspace changed while it was being read.",
        );
      }
    }
    return contents;
  }

  async function runCycle(): Promise<CycleResult> {
    const listed = await client.list();
    const remote = new Map<string, SyncRemoteEntry>();
    for (const file of listed.files) {
      if (themeSyncPathExclusion(file.path) === null) {
        remote.set(file.path, { id: file.id, version: file.version, kind: file.kind });
      }
    }
    const scanned = await folder.scan();
    const skipped = [...scanned.skipped];
    // The same rule again on whatever the folder reported, so a folder that
    // forgets it cannot send a platform file up.
    const local = new Map<string, LocalScanEntry>();
    for (const [path, entry] of scanned.files) {
      const exclusion = themeSyncPathExclusion(path);
      if (exclusion === null) local.set(path, entry);
      else if (exclusion !== "local-only") {
        skipped.push({ path, reason: "not-synced", detail: exclusion });
      }
    }
    const base = new Map(
      Object.entries(state.files).filter(([path]) => themeSyncPathExclusion(path) === null),
    );

    let contents: Map<string, { id: string; version: number; content: string }>;
    try {
      contents = await readRemote(remoteChangedTextPaths(base, remote));
    } catch (error) {
      if (error instanceof ThemeSyncApiRefusal && error.isConflict) {
        return { status: "retry", summary: summarize([], skipped, null), reason: error.message };
      }
      throw error;
    }
    const remoteHashes = new Map<string, string>();
    for (const [path, file] of contents) {
      const listedFile = remote.get(path);
      // Read at another version than listed: the workspace moved in between.
      if (!listedFile || listedFile.id !== file.id || listedFile.version !== file.version) {
        return {
          status: "retry",
          summary: summarize([], skipped, null),
          reason: "The workspace changed while it was being read.",
        };
      }
      remoteHashes.set(path, await syncContentHash(file.content));
    }

    const actions = planSync({ base, local, remote, remoteHashes });
    const massDeletion = massDeletionWarning({
      actions,
      baseCount: base.size,
      localCount: local.size,
      remoteTextCount: [...remote.values()].filter((file) => file.kind === "text").length,
    });
    const summary = summarize(actions, skipped, massDeletion);

    if (massDeletion && !(await options.confirm(summary, "mass-deletion"))) {
      return { status: "declined", summary };
    }
    const startup = firstCycle;
    firstCycle = false;
    if (startup && hasWork(summary) && !massDeletion) {
      if (!(await options.confirm(summary, "startup"))) {
        firstCycle = true;
        return { status: "declined", summary };
      }
    }

    // Workspace → local. Each write first checks the local file is still the
    // one the plan saw; one edited since is left for the next cycle.
    for (const action of actions) {
      const scanned = local.get(action.path);
      const unchangedSinceScan = async () => {
        const now = await folder.read(action.path);
        return now === null ? !scanned : scanned !== undefined && (await syncContentHash(now)) === scanned.hash;
      };
      switch (action.kind) {
        case "download": {
          const file = contents.get(action.path);
          if (!file || !(await unchangedSinceScan())) break;
          await folder.write(action.path, file.content);
          state.files[action.path] = {
            id: file.id,
            version: file.version,
            hash: await syncContentHash(file.content),
          };
          break;
        }
        case "delete-local":
          if (!(await unchangedSinceScan())) break;
          await folder.remove(action.path);
          delete state.files[action.path];
          break;
        case "adopt":
          state.files[action.path] = action.entry;
          await folder.removeConflictCopy(action.path);
          break;
        case "forget":
          delete state.files[action.path];
          break;
        case "conflict": {
          const file = contents.get(action.path);
          if (file) await folder.writeConflictCopy(action.path, file.content);
          break;
        }
        default:
          break;
      }
    }
    await persist();

    // Local → workspace, in one batch per request against the listed
    // generation; each later request carries the generation the previous
    // one returned.
    const uploads = actions.filter((action) => action.kind === "upload");
    const deletions = actions.filter((action) => action.kind === "delete-remote");
    let generation = listed.sourceGeneration;
    const requests = chunks(
      [...uploads, ...deletions],
      THEME_SYNC_LIMITS.maxFilesPerSave,
    );
    try {
      for (const batch of requests) {
        const files = batch.flatMap((action) =>
          action.kind === "upload"
            ? [
                {
                  path: action.path,
                  content: normalizeSyncText(local.get(action.path)?.text ?? ""),
                  ...(action.expect
                    ? { expectedFileId: action.expect.id, expectedVersion: action.expect.version }
                    : { expectMissing: true }),
                },
              ]
            : [],
        );
        const removals = batch.flatMap((action) =>
          action.kind === "delete-remote"
            ? [{ path: action.path, expectedFileId: action.remote.id, expectedVersion: action.remote.version }]
            : [],
        );
        const saved = await client.save({
          expectedSourceGeneration: generation,
          files,
          deletions: removals,
        });
        generation = saved.sourceGeneration;
        const savedByPath = new Map(saved.files.map((file) => [file.path, file]));
        for (const action of batch) {
          if (action.kind === "upload") {
            const file = savedByPath.get(action.path);
            const scanned = local.get(action.path);
            if (file && scanned) {
              state.files[action.path] = { id: file.id, version: file.version, hash: scanned.hash };
            }
          } else if (action.kind === "delete-remote") {
            delete state.files[action.path];
          }
        }
        await persist();
      }
    } catch (error) {
      if (error instanceof ThemeSyncApiRefusal && error.isConflict) {
        return { status: "retry", summary, reason: error.message };
      }
      throw error;
    }

    // Only when everything planned went through is the base at this
    // generation; otherwise the next poll must see a newer one and re-plan.
    if (requests.length === 0) state.sourceGeneration = listed.sourceGeneration;
    else state.sourceGeneration = generation;
    await persist();
    return { status: "applied", summary, sourceGeneration: state.sourceGeneration };
  }

  /**
   * Settles one conflict the way the developer chose. Nothing is copied
   * here: the base is set so that the next cycle copies the chosen side
   * over the other, with the usual preconditions.
   */
  async function resolve(path: string, keep: "local" | "remote"): Promise<void> {
    const listed = await client.list();
    const remote = listed.files.find((file) => file.path === path && file.kind === "text");
    const localText = await folder.read(path);
    if (keep === "local") {
      if (remote) {
        // Base at the workspace's copy with a hash no text has: the local
        // file reads as the only side that changed, and goes up over it.
        state.files[path] = { id: remote.id, version: remote.version, hash: "resolved:keep-local" };
      } else delete state.files[path];
    } else {
      const localHash = localText === null ? "resolved:absent" : await syncContentHash(localText);
      if (remote) {
        // Base at the local text and at no version the workspace holds: the
        // workspace copy reads as the only side that changed, and comes down.
        state.files[path] = { id: remote.id, version: 0, hash: localHash };
      } else if (localText !== null) {
        state.files[path] = { id: "resolved:remote-deleted", version: 0, hash: localHash };
      } else delete state.files[path];
    }
    await folder.removeConflictCopy(path);
    await persist();
  }

  return { runCycle, resolve, state };
}
