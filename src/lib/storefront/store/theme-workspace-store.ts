import { create } from "zustand";
import type { StorefrontThemeFileDTO } from "../dto/storefront-theme-file.dto";

export type ThemeFileSaveState =
  "clean" | "dirty" | "debouncing" | "saving" | "error" | "conflict";

export type ThemeFileConflict =
  | {
      kind: "modified" | "created";
      remoteExists: true;
      remoteFileId: string;
      remoteVersion: number;
      remoteContent: string;
    }
  | {
      kind: "deleted";
      remoteExists: false;
      remoteFileId: null;
      remoteVersion: null;
      remoteContent: null;
    };

/**
 * What the server is known to hold for a file, as one indivisible fact.
 *
 * Written as a union rather than three independent fields because a write to an
 * existing file must carry its id and version — that is the compare-and-set the
 * server checks. With the fields independent, "exists but has no version" was a
 * representable state, and the type forced every call site to write
 * `serverVersion ?? undefined` to get past it. That coercion turns a state that
 * should be impossible into a request the server must reject, and a rejected
 * precondition surfaces as a failed save with nothing the person can act on.
 *
 * Here the discriminant carries the other two, so the impossible state does not
 * compile and the coercion has nothing left to hide.
 */
export type ThemeFileServerState =
  | { serverExists: false; serverFileId: null; serverVersion: null }
  | { serverExists: true; serverFileId: string; serverVersion: number };

export type ThemeWorkspaceFileState = ThemeFileServerState & {
  path: string;
  serverContent: string;
  localContent: string;
  dirty: boolean;
  saveState: ThemeFileSaveState;
  conflict?: ThemeFileConflict;
  errorMessage?: string;
};

export type ThemeConflictResolution = ThemeFileServerState & {
  content: string | null;
};

export interface WorkspaceScope {
  storefrontId: string;
  themeId: string;
}

export interface ThemeWorkspaceStore {
  activeWorkspaceKey: string | null;
  workspaces: Record<string, Record<string, ThemeWorkspaceFileState>>;
  acceptedGenerations: Record<string, number>;
  observedGenerations: Record<string, number>;
  generations: Record<string, number>;
  files: Record<string, ThemeWorkspaceFileState>;

  setActiveWorkspace: (storefrontId: string, themeId: string) => void;
  hydrateFromQuery: (
    storefrontId: string,
    themeId: string,
    themeFiles: StorefrontThemeFileDTO[],
    sourceGeneration?: number,
  ) => void;
  getAcceptedSourceGeneration: (scope?: WorkspaceScope) => number;
  getBaseSourceGeneration: (scope?: WorkspaceScope) => number;
  setBaseSourceGeneration: (generation: number, scope?: WorkspaceScope) => void;
  getObservedSourceGeneration: (scope?: WorkspaceScope) => number;
  hasRemoteSourceChanged: (scope?: WorkspaceScope) => boolean;
  acceptRemoteGeneration: (generation?: number, scope?: WorkspaceScope) => void;
  acceptRemoteWorkspace: (scope?: WorkspaceScope) => void;
  getWorkspaceFiles: (
    storefrontId?: string,
    themeId?: string,
  ) => Record<string, ThemeWorkspaceFileState>;
  updateLocalContent: (
    path: string,
    content: string,
    scope?: WorkspaceScope,
  ) => void;
  markDebouncing: (path: string, scope?: WorkspaceScope) => void;
  markSaving: (path: string, scope?: WorkspaceScope) => void;
  markDirty: (path: string, scope?: WorkspaceScope) => void;
  markSaved: (
    saved: StorefrontThemeFileDTO & { sourceGeneration?: number },
    scope?: WorkspaceScope,
    sourceGeneration?: number,
  ) => void;
  markError: (path: string, message: string, scope?: WorkspaceScope) => void;
  markConflict: (
    path: string,
    conflict: ThemeFileConflict,
    scope?: WorkspaceScope,
  ) => void;
  resolveConflict: (
    path: string,
    resolution: "reload" | "force_mine",
    scope?: WorkspaceScope,
  ) => ThemeConflictResolution | null;
  discardLocalChanges: (path: string, scope?: WorkspaceScope) => void;
  getDirtyFiles: (scope?: WorkspaceScope) => string[];
  hasUnsavedEdits: (scope?: WorkspaceScope) => boolean;
  hasActiveConflictsOrErrors: (scope?: WorkspaceScope) => boolean;
}

export function toWorkspaceKey(storefrontId: string, themeId: string): string {
  return `${storefrontId}:${themeId}`;
}

/** A file the server does not hold — locally created, or deleted remotely. */
const ABSENT_ON_SERVER = {
  serverExists: false,
  serverFileId: null,
  serverVersion: null,
} as const satisfies ThemeFileServerState;

/**
 * A file the server holds, at a known id and version.
 *
 * The two arguments travel together through every path that learns about a
 * server file, so that no caller can record one and forget the other.
 */
function presentOnServer(
  fileId: string,
  version: number,
): ThemeFileServerState {
  return { serverExists: true, serverFileId: fileId, serverVersion: version };
}

function fromServerFile(file: StorefrontThemeFileDTO): ThemeWorkspaceFileState {
  return {
    path: file.path,
    ...presentOnServer(file.id, file.version),
    serverContent: file.content,
    localContent: file.content,
    dirty: false,
    saveState: "clean",
  };
}

/**
 * The compare-and-set a write must carry for a file in this state.
 *
 * Built here rather than at each call site because the three fields the server
 * validates are not independent: an existing file needs its id *and* version,
 * and a new one needs `expectMissing` and neither of the others. Assembled by
 * hand, the two save paths each had their own chance to disagree with the
 * server's rule, and disagreeing produced a rejected request rather than a
 * type error.
 */
export function themeFileWritePrecondition(
  state: ThemeFileServerState | undefined,
):
  | { expectMissing: true }
  | { expectMissing: false; expectedFileId: string; expectedVersion: number } {
  if (!state?.serverExists) return { expectMissing: true };
  return {
    expectMissing: false,
    expectedFileId: state.serverFileId,
    expectedVersion: state.serverVersion,
  };
}

function getTargetWorkspace(
  state: {
    workspaces: Record<string, Record<string, ThemeWorkspaceFileState>>;
    files: Record<string, ThemeWorkspaceFileState>;
    activeWorkspaceKey: string | null;
  },
  scope?: WorkspaceScope,
): { key: string; workspaceFiles: Record<string, ThemeWorkspaceFileState> } {
  if (scope) {
    const key = toWorkspaceKey(scope.storefrontId, scope.themeId);
    return { key, workspaceFiles: state.workspaces[key] ?? {} };
  }
  const key = state.activeWorkspaceKey ?? "default";
  return { key, workspaceFiles: state.workspaces[key] ?? state.files };
}

export const useThemeWorkspaceStore = create<ThemeWorkspaceStore>(
  (set, get) => ({
    activeWorkspaceKey: null,
    workspaces: {},
    acceptedGenerations: {},
    observedGenerations: {},
    generations: {},
    files: {},

    setActiveWorkspace: (storefrontId: string, themeId: string) => {
      const key = toWorkspaceKey(storefrontId, themeId);
      set((state) => {
        if (state.activeWorkspaceKey === key) return state;
        const workspaceFiles = state.workspaces[key] ?? {};
        return {
          activeWorkspaceKey: key,
          files: workspaceFiles,
        };
      });
    },

    getAcceptedSourceGeneration: (scope?: WorkspaceScope) => {
      const state = get();
      const { key } = getTargetWorkspace(state, scope);
      return state.acceptedGenerations[key] ?? state.generations[key] ?? 1;
    },

    getBaseSourceGeneration: (scope?: WorkspaceScope) => {
      const state = get();
      const { key } = getTargetWorkspace(state, scope);
      return state.acceptedGenerations[key] ?? state.generations[key] ?? 1;
    },

    setBaseSourceGeneration: (generation: number, scope?: WorkspaceScope) => {
      set((state) => {
        const { key } = getTargetWorkspace(state, scope);
        return {
          acceptedGenerations: {
            ...state.acceptedGenerations,
            [key]: generation,
          },
          generations: { ...state.generations, [key]: generation },
        };
      });
    },

    getObservedSourceGeneration: (scope?: WorkspaceScope) => {
      const state = get();
      const { key } = getTargetWorkspace(state, scope);
      return (
        state.observedGenerations[key] ?? state.acceptedGenerations[key] ?? 1
      );
    },

    hasRemoteSourceChanged: (scope?: WorkspaceScope) => {
      const state = get();
      const { key } = getTargetWorkspace(state, scope);
      const accepted =
        state.acceptedGenerations[key] ?? state.generations[key] ?? 1;
      const observed = state.observedGenerations[key] ?? accepted;
      return observed > accepted;
    },

    acceptRemoteGeneration: (generation?: number, scope?: WorkspaceScope) => {
      set((state) => {
        const { key } = getTargetWorkspace(state, scope);
        const targetGen =
          generation ??
          state.observedGenerations[key] ??
          state.acceptedGenerations[key] ??
          1;
        return {
          acceptedGenerations: {
            ...state.acceptedGenerations,
            [key]: targetGen,
          },
          generations: { ...state.generations, [key]: targetGen },
          observedGenerations: {
            ...state.observedGenerations,
            [key]: targetGen,
          },
        };
      });
    },

    acceptRemoteWorkspace: (scope?: WorkspaceScope) => {
      set((state) => {
        const { key, workspaceFiles } = getTargetWorkspace(state, scope);
        const targetGen =
          state.observedGenerations[key] ?? state.acceptedGenerations[key] ?? 1;

        const next = { ...workspaceFiles };
        for (const [path, file] of Object.entries(workspaceFiles)) {
          if (file.conflict) {
            if (file.conflict.remoteExists && file.conflict.remoteFileId) {
              next[path] = {
                path,
                ...presentOnServer(
                  file.conflict.remoteFileId,
                  file.conflict.remoteVersion,
                ),
                serverContent: file.conflict.remoteContent ?? "",
                localContent: file.conflict.remoteContent ?? "",
                dirty: false,
                saveState: "clean",
                conflict: undefined,
                errorMessage: undefined,
              };
            } else {
              delete next[path];
            }
          }
        }

        const nextWorkspaces = { ...state.workspaces, [key]: next };
        const isActive = state.activeWorkspaceKey === key;
        return {
          workspaces: nextWorkspaces,
          acceptedGenerations: {
            ...state.acceptedGenerations,
            [key]: targetGen,
          },
          generations: { ...state.generations, [key]: targetGen },
          observedGenerations: {
            ...state.observedGenerations,
            [key]: targetGen,
          },
          files: isActive ? next : state.files,
        };
      });
    },

    getWorkspaceFiles: (storefrontId?: string, themeId?: string) => {
      const state = get();
      if (storefrontId && themeId) {
        const key = toWorkspaceKey(storefrontId, themeId);
        return state.workspaces[key] ?? {};
      }
      return state.files;
    },

    hydrateFromQuery: (storefrontId, themeId, themeFiles, sourceGeneration) => {
      const targetKey = toWorkspaceKey(storefrontId, themeId);
      set((state) => {
        const currentWorkspaceFiles = state.workspaces[targetKey] ?? {};
        const incoming = new Map(themeFiles.map((file) => [file.path, file]));
        let hasChanges = false;
        const next = { ...currentWorkspaceFiles };

        for (const file of themeFiles) {
          const current = currentWorkspaceFiles[file.path];
          if (!current) {
            next[file.path] = fromServerFile(file);
            hasChanges = true;
            continue;
          }

          if (current.saveState === "saving") continue;

          if (!current.serverExists && current.dirty) {
            const isSameConflict =
              current.saveState === "conflict" &&
              current.conflict?.kind === "created" &&
              current.conflict?.remoteFileId === file.id &&
              current.conflict?.remoteVersion === file.version &&
              current.conflict?.remoteContent === file.content;

            if (!isSameConflict) {
              next[file.path] = {
                ...current,
                saveState: "conflict",
                conflict: {
                  kind: "created",
                  remoteExists: true,
                  remoteFileId: file.id,
                  remoteVersion: file.version,
                  remoteContent: file.content,
                },
              };
              hasChanges = true;
            }
            continue;
          }

          const serverChanged =
            current.serverFileId !== file.id ||
            current.serverVersion !== file.version ||
            current.serverContent !== file.content ||
            !current.serverExists;

          if (current.dirty && serverChanged) {
            const isSameConflict =
              current.saveState === "conflict" &&
              current.conflict?.kind === "modified" &&
              current.conflict?.remoteFileId === file.id &&
              current.conflict?.remoteVersion === file.version &&
              current.conflict?.remoteContent === file.content;

            if (!isSameConflict) {
              next[file.path] = {
                ...current,
                saveState: "conflict",
                conflict: {
                  kind: "modified",
                  remoteExists: true,
                  remoteFileId: file.id,
                  remoteVersion: file.version,
                  remoteContent: file.content,
                },
              };
              hasChanges = true;
            }
            continue;
          }

          if (
            !current.dirty &&
            (serverChanged || current.saveState !== "clean")
          ) {
            next[file.path] = fromServerFile(file);
            hasChanges = true;
          }
        }

        for (const [path, current] of Object.entries(currentWorkspaceFiles)) {
          if (incoming.has(path) || !current.serverExists) continue;
          if (current.saveState === "saving") continue;

          if (current.dirty) {
            const isSameConflict =
              current.saveState === "conflict" &&
              current.conflict?.kind === "deleted";

            if (!isSameConflict) {
              next[path] = {
                ...current,
                saveState: "conflict",
                conflict: {
                  kind: "deleted",
                  remoteExists: false,
                  remoteFileId: null,
                  remoteVersion: null,
                  remoteContent: null,
                },
              };
              hasChanges = true;
            }
          } else {
            delete next[path];
            hasChanges = true;
          }
        }

        const existingAccepted = state.acceptedGenerations[targetKey];
        const initialAccepted =
          existingAccepted ??
          (typeof sourceGeneration === "number" ? sourceGeneration : 1);
        const nextObserved =
          typeof sourceGeneration === "number"
            ? sourceGeneration
            : (state.observedGenerations[targetKey] ?? 1);

        if (
          !hasChanges &&
          state.observedGenerations[targetKey] === nextObserved &&
          existingAccepted !== undefined
        ) {
          return state;
        }

        const nextWorkspaces = {
          ...state.workspaces,
          [targetKey]: next,
        };

        const nextAcceptedGenerations = {
          ...state.acceptedGenerations,
          [targetKey]: initialAccepted,
        };

        const nextObservedGenerations = {
          ...state.observedGenerations,
          [targetKey]: nextObserved,
        };

        const isActive = state.activeWorkspaceKey === targetKey;
        return {
          workspaces: nextWorkspaces,
          acceptedGenerations: nextAcceptedGenerations,
          observedGenerations: nextObservedGenerations,
          generations: nextAcceptedGenerations,
          activeWorkspaceKey: state.activeWorkspaceKey ?? targetKey,
          files:
            isActive || state.activeWorkspaceKey === null ? next : state.files,
        };
      });
    },

    updateLocalContent: (path, content, scope) => {
      set((state) => {
        const { key, workspaceFiles } = getTargetWorkspace(state, scope);
        const current = workspaceFiles[path];

        if (!current) {
          const next = {
            ...workspaceFiles,
            [path]: {
              path,
              ...ABSENT_ON_SERVER,
              serverContent: "",
              localContent: content,
              dirty: true,
              saveState: "dirty" as const,
            },
          };
          const nextWorkspaces = { ...state.workspaces, [key]: next };
          const isActive = state.activeWorkspaceKey === key;
          return {
            workspaces: nextWorkspaces,
            files: isActive ? next : state.files,
          };
        }

        if (
          current.localContent === content &&
          current.errorMessage === undefined
        ) {
          return state;
        }

        const dirty = current.serverExists
          ? content !== current.serverContent
          : true;

        const next = {
          ...workspaceFiles,
          [path]: {
            ...current,
            localContent: content,
            dirty,
            saveState: current.conflict
              ? ("conflict" as const)
              : dirty
                ? ("dirty" as const)
                : ("clean" as const),
            errorMessage: undefined,
          },
        };

        const nextWorkspaces = { ...state.workspaces, [key]: next };
        const isActive = state.activeWorkspaceKey === key;
        return {
          workspaces: nextWorkspaces,
          files: isActive ? next : state.files,
        };
      });
    },

    markDebouncing: (path, scope) => {
      set((state) => {
        const { key, workspaceFiles } = getTargetWorkspace(state, scope);
        const current = workspaceFiles[path];
        if (!current || current.conflict) return state;

        const next = {
          ...workspaceFiles,
          [path]: { ...current, saveState: "debouncing" as const },
        };
        const nextWorkspaces = { ...state.workspaces, [key]: next };
        const isActive = state.activeWorkspaceKey === key;
        return {
          workspaces: nextWorkspaces,
          files: isActive ? next : state.files,
        };
      });
    },

    markSaving: (path, scope) => {
      set((state) => {
        const { key, workspaceFiles } = getTargetWorkspace(state, scope);
        const current = workspaceFiles[path];
        if (!current || current.conflict) return state;

        const next = {
          ...workspaceFiles,
          [path]: {
            ...current,
            saveState: "saving" as const,
            errorMessage: undefined,
          },
        };
        const nextWorkspaces = { ...state.workspaces, [key]: next };
        const isActive = state.activeWorkspaceKey === key;
        return {
          workspaces: nextWorkspaces,
          files: isActive ? next : state.files,
        };
      });
    },

    markDirty: (path, scope) => {
      set((state) => {
        const { key, workspaceFiles } = getTargetWorkspace(state, scope);
        const current = workspaceFiles[path];
        if (!current) return state;

        const next = {
          ...workspaceFiles,
          [path]: {
            ...current,
            dirty: true,
            saveState: current.conflict
              ? ("conflict" as const)
              : ("dirty" as const),
            errorMessage: undefined,
          },
        };
        const nextWorkspaces = { ...state.workspaces, [key]: next };
        const isActive = state.activeWorkspaceKey === key;
        return {
          workspaces: nextWorkspaces,
          files: isActive ? next : state.files,
        };
      });
    },

    markSaved: (saved, scope, sourceGeneration) => {
      set((state) => {
        const resolvedScope = scope ?? {
          storefrontId: saved.storefrontId,
          themeId: saved.themeId,
        };
        const { key, workspaceFiles } = getTargetWorkspace(
          state,
          resolvedScope,
        );
        const current = workspaceFiles[saved.path] ?? fromServerFile(saved);
        const stillDirty = current.localContent !== saved.content;

        const next = {
          ...workspaceFiles,
          [saved.path]: {
            ...current,
            ...presentOnServer(saved.id, saved.version),
            serverContent: saved.content,
            dirty: stillDirty,
            saveState: stillDirty ? ("dirty" as const) : ("clean" as const),
            conflict: undefined,
            errorMessage: undefined,
          },
        };
        const nextWorkspaces = { ...state.workspaces, [key]: next };
        const gen = sourceGeneration ?? (saved as any).sourceGeneration;
        const nextAcceptedGenerations =
          typeof gen === "number"
            ? { ...state.acceptedGenerations, [key]: gen }
            : state.acceptedGenerations;
        const nextObservedGenerations =
          typeof gen === "number"
            ? { ...state.observedGenerations, [key]: gen }
            : state.observedGenerations;

        const isActive = state.activeWorkspaceKey === key;
        return {
          workspaces: nextWorkspaces,
          acceptedGenerations: nextAcceptedGenerations,
          observedGenerations: nextObservedGenerations,
          generations: nextAcceptedGenerations,
          files: isActive ? next : state.files,
        };
      });
    },

    markError: (path, message, scope) => {
      set((state) => {
        const { key, workspaceFiles } = getTargetWorkspace(state, scope);
        const current = workspaceFiles[path];
        if (!current) return state;

        const next = {
          ...workspaceFiles,
          [path]: {
            ...current,
            saveState: "error" as const,
            errorMessage: message,
          },
        };
        const nextWorkspaces = { ...state.workspaces, [key]: next };
        const isActive = state.activeWorkspaceKey === key;
        return {
          workspaces: nextWorkspaces,
          files: isActive ? next : state.files,
        };
      });
    },

    markConflict: (path, conflict, scope) => {
      set((state) => {
        const { key, workspaceFiles } = getTargetWorkspace(state, scope);
        const current = workspaceFiles[path];
        if (!current) return state;

        const next = {
          ...workspaceFiles,
          [path]: {
            ...current,
            saveState: "conflict" as const,
            conflict,
            errorMessage: undefined,
          },
        };
        const nextWorkspaces = { ...state.workspaces, [key]: next };
        const isActive = state.activeWorkspaceKey === key;
        return {
          workspaces: nextWorkspaces,
          files: isActive ? next : state.files,
        };
      });
    },

    resolveConflict: (path, resolution, scope) => {
      const state = get();
      const { key, workspaceFiles } = getTargetWorkspace(state, scope);
      const current = workspaceFiles[path];
      if (!current?.conflict) return null;
      const conflict = current.conflict;

      if (resolution === "reload") {
        if (!conflict.remoteExists) {
          const next = { ...workspaceFiles };
          delete next[path];
          const nextWorkspaces = { ...state.workspaces, [key]: next };
          const isActive = state.activeWorkspaceKey === key;
          set({
            workspaces: nextWorkspaces,
            files: isActive ? next : state.files,
          });
          return { content: null, ...ABSENT_ON_SERVER };
        }

        const next = {
          ...workspaceFiles,
          [path]: {
            ...current,
            ...presentOnServer(conflict.remoteFileId, conflict.remoteVersion),
            serverContent: conflict.remoteContent,
            localContent: conflict.remoteContent,
            dirty: false,
            saveState: "clean" as const,
            conflict: undefined,
            errorMessage: undefined,
          },
        };
        const nextWorkspaces = { ...state.workspaces, [key]: next };
        const isActive = state.activeWorkspaceKey === key;
        set({
          workspaces: nextWorkspaces,
          files: isActive ? next : state.files,
        });
        return {
          content: conflict.remoteContent,
          ...presentOnServer(conflict.remoteFileId, conflict.remoteVersion),
        };
      }

      // Keeping the local content still has to record what the server holds, so
      // the next write carries the right precondition: overwriting a remote edit
      // is a write against that remote version, and a file deleted remotely is a
      // create. Branching on the discriminant keeps the id and version together
      // with the fact that they exist.
      const serverState: ThemeFileServerState = conflict.remoteExists
        ? presentOnServer(conflict.remoteFileId, conflict.remoteVersion)
        : ABSENT_ON_SERVER;

      const next = {
        ...workspaceFiles,
        [path]: {
          ...current,
          ...serverState,
          serverContent: conflict.remoteContent ?? "",
          dirty: true,
          saveState: "dirty" as const,
          conflict: undefined,
          errorMessage: undefined,
        },
      };
      const nextWorkspaces = { ...state.workspaces, [key]: next };
      const isActive = state.activeWorkspaceKey === key;
      set({
        workspaces: nextWorkspaces,
        files: isActive ? next : state.files,
      });

      return {
        content: current.localContent,
        ...serverState,
      };
    },

    discardLocalChanges: (path, scope) => {
      set((state) => {
        const { key, workspaceFiles } = getTargetWorkspace(state, scope);
        const current = workspaceFiles[path];
        if (!current) return state;

        if (!current.serverExists) {
          const next = { ...workspaceFiles };
          delete next[path];
          const nextWorkspaces = { ...state.workspaces, [key]: next };
          const isActive = state.activeWorkspaceKey === key;
          return {
            workspaces: nextWorkspaces,
            files: isActive ? next : state.files,
          };
        }

        const next = {
          ...workspaceFiles,
          [path]: {
            ...current,
            localContent: current.serverContent,
            dirty: false,
            saveState: "clean" as const,
            conflict: undefined,
            errorMessage: undefined,
          },
        };
        const nextWorkspaces = { ...state.workspaces, [key]: next };
        const isActive = state.activeWorkspaceKey === key;
        return {
          workspaces: nextWorkspaces,
          files: isActive ? next : state.files,
        };
      });
    },

    getDirtyFiles: (scope) => {
      const state = get();
      const { workspaceFiles } = getTargetWorkspace(state, scope);
      return Object.values(workspaceFiles)
        .filter((file) => file.dirty)
        .map((file) => file.path);
    },

    hasUnsavedEdits: (scope) => {
      const state = get();
      const { workspaceFiles } = getTargetWorkspace(state, scope);
      return Object.values(workspaceFiles).some(
        (file) =>
          file.dirty ||
          file.saveState === "debouncing" ||
          file.saveState === "saving",
      );
    },

    hasActiveConflictsOrErrors: (scope) => {
      const state = get();
      const { workspaceFiles } = getTargetWorkspace(state, scope);
      return Object.values(workspaceFiles).some(
        (file) => file.saveState === "conflict" || file.saveState === "error",
      );
    },
  }),
);
