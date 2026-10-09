import { promises as fs } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import {
  decodeSyncText,
  detectLineEnding,
  syncContentHash,
  textForLocal,
} from "./sync-content";
import { THEME_SYNC_CONFLICT_SUFFIX, themeSyncPathExclusion } from "./sync-paths";
import { THEME_SYNC_LIMITS } from "./sync-protocol";
import type { LocalScanEntry, LocalSkip, SyncLocalFolder } from "./sync-session";

/**
 * The local side of sync on disk.
 *
 * Writes go to a temporary file beside the target and are renamed over it,
 * so a dev server watching the folder never reads half a file. Nothing is
 * deleted outright: a file sync removes is moved under `.morph/trash/`.
 *
 * `.morphignore` lists more paths to leave alone, one per line: an exact
 * path, a folder ending in `/`, or `*.ext`. Lines starting with `#` are
 * comments.
 */

export const SYNC_DIRECTORY = ".morph";

type IgnoreRule =
  | { kind: "exact"; path: string }
  | { kind: "prefix"; path: string }
  | { kind: "extension"; ext: string };

export function parseMorphIgnore(text: string): IgnoreRule[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line): IgnoreRule => {
      const path = line.replace(/^\.?\//, "");
      if (path.startsWith("*.")) return { kind: "extension", ext: path.slice(1) };
      if (path.endsWith("/")) return { kind: "prefix", path };
      return { kind: "exact", path };
    });
}

export function isIgnored(path: string, rules: readonly IgnoreRule[]): boolean {
  return rules.some((rule) =>
    rule.kind === "exact"
      ? path === rule.path
      : rule.kind === "prefix"
        ? path.startsWith(rule.path)
        : path.endsWith(rule.ext),
  );
}

const toSyncPath = (root: string, absolute: string) =>
  relative(root, absolute).split(sep).join(posix.sep);

export function createLocalSyncFolder(root: string): SyncLocalFolder & {
  ignoreRules(): Promise<IgnoreRule[]>;
} {
  const absolute = (path: string) => join(root, ...path.split("/"));

  async function ignoreRules(): Promise<IgnoreRule[]> {
    try {
      return parseMorphIgnore(await fs.readFile(join(root, ".morphignore"), "utf8"));
    } catch {
      return [];
    }
  }

  async function scan() {
    const files = new Map<string, LocalScanEntry>();
    const skipped: LocalSkip[] = [];
    const rules = await ignoreRules();
    async function walk(directory: string) {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(directory, entry.name);
        const path = toSyncPath(root, full);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (themeSyncPathExclusion(`${path}/x.ts`) === "local-only") continue;
          if (isIgnored(`${path}/`, rules)) continue;
          await walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        if (isIgnored(path, rules)) continue;
        const exclusion = themeSyncPathExclusion(path);
        if (exclusion === "local-only") continue;
        if (exclusion) {
          skipped.push({ path, reason: "not-synced", detail: exclusion });
          continue;
        }
        const stat = await fs.stat(full);
        if (stat.size > THEME_SYNC_LIMITS.maxFileBytes) {
          skipped.push({ path, reason: "too-large" });
          continue;
        }
        const text = decodeSyncText(new Uint8Array(await fs.readFile(full)));
        if (text === null) {
          skipped.push({ path, reason: "not-utf8" });
          continue;
        }
        files.set(path, { text, hash: await syncContentHash(text) });
      }
    }
    await walk(root);
    return { files, skipped };
  }

  async function read(path: string): Promise<string | null> {
    try {
      return decodeSyncText(new Uint8Array(await fs.readFile(absolute(path))));
    } catch {
      return null;
    }
  }

  async function writeAtomically(target: string, text: string) {
    await fs.mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.morph-tmp`;
    await fs.writeFile(temporary, text, "utf8");
    await fs.rename(temporary, target);
  }

  async function write(path: string, text: string) {
    const existing = await read(path);
    const ending = existing === null ? "lf" : detectLineEnding(existing);
    await writeAtomically(absolute(path), textForLocal(text, ending));
  }

  async function remove(path: string) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = join(root, SYNC_DIRECTORY, "trash", stamp, ...path.split("/"));
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.rename(absolute(path), target);
  }

  async function writeConflictCopy(path: string, remoteText: string) {
    const target = absolute(`${path}${THEME_SYNC_CONFLICT_SUFFIX}`);
    const existing = await fs.readFile(target, "utf8").catch(() => null);
    if (existing === remoteText) return;
    await writeAtomically(target, remoteText);
  }

  async function removeConflictCopy(path: string) {
    await fs.rm(absolute(`${path}${THEME_SYNC_CONFLICT_SUFFIX}`), { force: true });
  }

  return { scan, read, write, remove, writeConflictCopy, removeConflictCopy, ignoreRules };
}
