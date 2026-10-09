import { vi } from "vitest";
import type { StorefrontThemeSyncCapabilityDAL } from "../../dal/storefront-theme-sync-capability.dal";
import type { StorefrontThemeWorkspaceEntryDTO } from "../../dto/storefront-theme-file.dto";
import { hashThemeSyncToken } from "../../service/theme-sync/theme-sync-capability";
import type {
  SaveThemeSourceFilesBatchItem,
  SaveThemeSourceFilesBatchOptions,
} from "../../storage/theme-storage.types";
import { handleThemeSyncRequest, type ThemeSyncApiDeps } from "@/server/storefront/theme-sync-api";
import { createThemeSyncClient } from "./sync-client";
import { syncContentHash } from "./sync-content";
import type { LocalScanEntry, SyncLocalFolder } from "./sync-session";

/**
 * A workspace that keeps the store's preconditions the way the D1 store
 * does: a save names the generation it was planned at, and each file its id
 * and version (or that it must not exist); one stale precondition refuses
 * the whole batch and nothing is written.
 */
export function createFakeWorkspace(initial: Record<string, string> = {}) {
  let generation = 1;
  let nextId = 1;
  const newId = () =>
    `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
  const files = new Map<string, { id: string; version: number; content: string; binary?: boolean }>();
  for (const [path, content] of Object.entries(initial)) {
    files.set(path, { id: newId(), version: 1, content });
  }
  const saves: Array<{ items: SaveThemeSourceFilesBatchItem[]; options: SaveThemeSourceFilesBatchOptions }> = [];

  const snapshot = (): StorefrontThemeWorkspaceEntryDTO[] =>
    [...files].map(([path, file]) =>
      file.binary
        ? ({
            id: file.id,
            path,
            version: file.version,
            encoding: "binary",
          } as unknown as StorefrontThemeWorkspaceEntryDTO)
        : ({
            id: file.id,
            storefrontId: "store-a",
            themeId: "theme-a",
            path,
            content: file.content,
            mimeType: "text/plain",
            isEntry: false,
            version: file.version,
            createdAt: "",
            updatedAt: "",
          } as StorefrontThemeWorkspaceEntryDTO),
    );

  /** An edit made in Morph — the Code tab or Design — while sync runs. */
  function editInMorph(path: string, content: string | null) {
    const existing = files.get(path);
    if (content === null) files.delete(path);
    else if (existing) files.set(path, { ...existing, version: existing.version + 1, content });
    else files.set(path, { id: newId(), version: 1, content });
    generation += 1;
  }

  async function saveFilesBatch(
    _storefrontId: string,
    _themeId: string,
    items: SaveThemeSourceFilesBatchItem[],
    options: SaveThemeSourceFilesBatchOptions,
  ) {
    saves.push({ items, options });
    if (options.expectedSourceGeneration !== generation) {
      throw new Error("CONFLICT_SOURCE_GENERATION_MISMATCH: stale");
    }
    for (const item of items) {
      const current = files.get(item.path);
      const ok = item.expectMissing
        ? !current
        : current?.id === item.expectedFileId && current?.version === item.expectedVersion;
      if (!ok) throw new Error("CONFLICT_VERSION_MISMATCH: batch precondition failed");
    }
    for (const deletion of options.deletions ?? []) {
      const current = files.get(deletion.path);
      if (current?.id !== deletion.expectedFileId || current?.version !== deletion.expectedVersion) {
        throw new Error("CONFLICT_VERSION_MISMATCH: batch precondition failed");
      }
    }
    const saved = items.map((item) => {
      const current = files.get(item.path);
      const next = current
        ? { ...current, version: current.version + 1, content: item.content }
        : { id: newId(), version: 1, content: item.content };
      files.set(item.path, next);
      return { ...snapshot().find((entry) => entry.path === item.path)! };
    });
    for (const deletion of options.deletions ?? []) files.delete(deletion.path);
    generation += 1;
    return Object.assign(saved, { sourceGeneration: generation }) as never;
  }

  return {
    files,
    saves,
    editInMorph,
    get generation() {
      return generation;
    },
    addBinary(path: string) {
      files.set(path, { id: newId(), version: 1, content: "", binary: true });
      generation += 1;
    },
    deps: {
      getSourceGeneration: async () => generation,
      getWorkspaceSnapshot: async () => snapshot(),
      saveFilesBatch: vi.fn(saveFilesBatch),
    },
  };
}

export const TEST_TOKEN = `mts_${"a".repeat(40)}`;

/** A capability store holding one live token for theme-a. */
export function createFakeCapabilities(): StorefrontThemeSyncCapabilityDAL & { revoked: boolean } {
  const state = { revoked: false };
  return Object.assign(state, {
    issue: vi.fn(),
    revoke: vi.fn(async () => {
      state.revoked = true;
      return true;
    }),
    findByTokenHash: vi.fn(async (hash: string) =>
      hash === (await hashThemeSyncToken(TEST_TOKEN))
        ? {
            id: "cap-1",
            storefrontId: "store-a",
            themeId: "theme-a",
            userId: "admin-1",
            expiresAt: "2999-01-01T00:00:00.000Z",
            revokedAt: state.revoked ? "x" : null,
            themeLive: true,
            user: { role: "admin", banned: false },
          }
        : null,
    ),
  }) as never;
}

/** The real client, talking to the real handler, without a network. */
export function createHarnessClient(
  workspace: ReturnType<typeof createFakeWorkspace>,
  options: {
    /** Runs before the server sees the request; throwing = it never arrived. */
    beforeRequest?: (url: URL, init: RequestInit) => void;
    /** Runs after the server answered; throwing = the answer was lost. */
    afterResponse?: (url: URL) => void;
  } = {},
) {
  const deps: ThemeSyncApiDeps = { dal: createFakeCapabilities(), ...workspace.deps };
  return createThemeSyncClient({
    origin: "http://morph.test",
    token: TEST_TOKEN,
    fetch: (async (input: URL, init: RequestInit) => {
      options.beforeRequest?.(new URL(input), init);
      const response = await handleThemeSyncRequest(new Request(input, init), deps);
      options.afterResponse?.(new URL(input));
      return response;
    }) as typeof fetch,
  });
}

/** A local folder in memory, with the same contract as the one on disk. */
export function createMemoryFolder(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const conflictCopies = new Map<string, string>();
  const trash: string[] = [];
  const folder: SyncLocalFolder = {
    async scan() {
      const scanned = new Map<string, LocalScanEntry>();
      for (const [path, text] of files) {
        scanned.set(path, { text, hash: await syncContentHash(text) });
      }
      return { files: scanned, skipped: [] };
    },
    read: async (path) => files.get(path) ?? null,
    async write(path, text) {
      const existing = files.get(path);
      const crlf = existing !== undefined && /\r\n/.test(existing) && !/[^\r]\n/.test(existing);
      files.set(path, crlf ? text.replace(/\r?\n/g, "\r\n") : text);
    },
    async remove(path) {
      trash.push(path);
      files.delete(path);
    },
    async writeConflictCopy(path, text) {
      conflictCopies.set(path, text);
    },
    async removeConflictCopy(path) {
      conflictCopies.delete(path);
    },
  };
  return { files, conflictCopies, trash, folder };
}
