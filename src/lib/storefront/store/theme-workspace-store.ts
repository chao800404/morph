import { create } from "zustand";
import type { StorefrontThemeFileDTO } from "../dto/storefront-theme-file.dto";

export type ThemeFileSaveState =
  | "clean"
  | "dirty"
  | "debouncing"
  | "saving"
  | "error"
  | "conflict";

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

export interface ThemeWorkspaceFileState {
  path: string;
  serverExists: boolean;
  serverFileId: string | null;
  serverContent: string;
  localContent: string;
  serverVersion: number | null;
  dirty: boolean;
  saveState: ThemeFileSaveState;
  conflict?: ThemeFileConflict;
  errorMessage?: string;
}

export interface ThemeConflictResolution {
  content: string | null;
  serverExists: boolean;
  serverFileId: string | null;
  serverVersion: number | null;
}

export interface ThemeWorkspaceStore {
  files: Record<string, ThemeWorkspaceFileState>;
  hydrateFromQuery: (themeFiles: StorefrontThemeFileDTO[]) => void;
  updateLocalContent: (path: string, content: string) => void;
  markDebouncing: (path: string) => void;
  markSaving: (path: string) => void;
  markSaved: (saved: StorefrontThemeFileDTO) => void;
  markError: (path: string, message: string) => void;
  markConflict: (path: string, conflict: ThemeFileConflict) => void;
  resolveConflict: (
    path: string,
    resolution: "reload" | "force_mine",
  ) => ThemeConflictResolution | null;
  discardLocalChanges: (path: string) => void;
  getDirtyFiles: () => string[];
  hasUnsavedEdits: () => boolean;
  hasActiveConflictsOrErrors: () => boolean;
}

function fromServerFile(file: StorefrontThemeFileDTO): ThemeWorkspaceFileState {
  return {
    path: file.path,
    serverExists: true,
    serverFileId: file.id,
    serverContent: file.content,
    localContent: file.content,
    serverVersion: file.version,
    dirty: false,
    saveState: "clean",
  };
}

export const useThemeWorkspaceStore = create<ThemeWorkspaceStore>((set, get) => ({
  files: {},

  hydrateFromQuery: (themeFiles) => {
    set((state) => {
      const incoming = new Map(themeFiles.map((file) => [file.path, file]));
      let hasChanges = false;
      const next = { ...state.files };

      for (const file of themeFiles) {
        const current = state.files[file.path];
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

        if (!current.dirty && (serverChanged || current.saveState !== "clean")) {
          next[file.path] = fromServerFile(file);
          hasChanges = true;
        }
      }

      for (const [path, current] of Object.entries(state.files)) {
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

      if (!hasChanges) return state;
      return { files: next };
    });
  },

  updateLocalContent: (path, content) => {
    set((state) => {
      const current = state.files[path];
      if (!current) {
        return {
          files: {
            ...state.files,
            [path]: {
              path,
              serverExists: false,
              serverFileId: null,
              serverContent: "",
              localContent: content,
              serverVersion: null,
              dirty: true,
              saveState: "dirty",
            },
          },
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

      return {
        files: {
          ...state.files,
          [path]: {
            ...current,
            localContent: content,
            dirty,
            saveState: current.conflict
              ? "conflict"
              : dirty
                ? "dirty"
                : "clean",
            errorMessage: undefined,
          },
        },
      };
    });
  },

  markDebouncing: (path) => {
    set((state) => {
      const current = state.files[path];
      if (!current || current.conflict) return state;
      return {
        files: {
          ...state.files,
          [path]: { ...current, saveState: "debouncing" },
        },
      };
    });
  },

  markSaving: (path) => {
    set((state) => {
      const current = state.files[path];
      if (!current || current.conflict) return state;
      return {
        files: {
          ...state.files,
          [path]: { ...current, saveState: "saving", errorMessage: undefined },
        },
      };
    });
  },

  markSaved: (saved) => {
    set((state) => {
      const current = state.files[saved.path] ?? fromServerFile(saved);
      const stillDirty = current.localContent !== saved.content;
      return {
        files: {
          ...state.files,
          [saved.path]: {
            ...current,
            serverExists: true,
            serverFileId: saved.id,
            serverContent: saved.content,
            serverVersion: saved.version,
            dirty: stillDirty,
            saveState: stillDirty ? "dirty" : "clean",
            conflict: undefined,
            errorMessage: undefined,
          },
        },
      };
    });
  },

  markError: (path, message) => {
    set((state) => {
      const current = state.files[path];
      if (!current) return state;
      return {
        files: {
          ...state.files,
          [path]: { ...current, saveState: "error", errorMessage: message },
        },
      };
    });
  },

  markConflict: (path, conflict) => {
    set((state) => {
      const current = state.files[path];
      if (!current) return state;
      return {
        files: {
          ...state.files,
          [path]: {
            ...current,
            saveState: "conflict",
            conflict,
            errorMessage: undefined,
          },
        },
      };
    });
  },

  resolveConflict: (path, resolution) => {
    const state = get();
    const current = state.files[path];
    if (!current?.conflict) return null;
    const conflict = current.conflict;

    if (resolution === "reload") {
      if (!conflict.remoteExists) {
        const next = { ...state.files };
        delete next[path];
        set({ files: next });
        return {
          content: null,
          serverExists: false,
          serverFileId: null,
          serverVersion: null,
        };
      }

      set({
        files: {
          ...state.files,
          [path]: {
            ...current,
            serverExists: true,
            serverFileId: conflict.remoteFileId,
            serverContent: conflict.remoteContent,
            localContent: conflict.remoteContent,
            serverVersion: conflict.remoteVersion,
            dirty: false,
            saveState: "clean",
            conflict: undefined,
            errorMessage: undefined,
          },
        },
      });
      return {
        content: conflict.remoteContent,
        serverExists: true,
        serverFileId: conflict.remoteFileId,
        serverVersion: conflict.remoteVersion,
      };
    }

    set({
      files: {
        ...state.files,
        [path]: {
          ...current,
          serverExists: conflict.remoteExists,
          serverFileId: conflict.remoteExists ? conflict.remoteFileId : null,
          serverContent: conflict.remoteExists ? conflict.remoteContent : "",
          serverVersion: conflict.remoteExists ? conflict.remoteVersion : null,
          dirty: true,
          saveState: "dirty",
          conflict: undefined,
          errorMessage: undefined,
        },
      },
    });

    return {
      content: current.localContent,
      serverExists: conflict.remoteExists,
      serverFileId: conflict.remoteExists ? conflict.remoteFileId : null,
      serverVersion: conflict.remoteExists ? conflict.remoteVersion : null,
    };
  },

  discardLocalChanges: (path) => {
    set((state) => {
      const current = state.files[path];
      if (!current) return state;
      if (!current.serverExists) {
        const next = { ...state.files };
        delete next[path];
        return { files: next };
      }
      return {
        files: {
          ...state.files,
          [path]: {
            ...current,
            localContent: current.serverContent,
            dirty: false,
            saveState: "clean",
            conflict: undefined,
            errorMessage: undefined,
          },
        },
      };
    });
  },

  getDirtyFiles: () =>
    Object.values(get().files)
      .filter((file) => file.dirty)
      .map((file) => file.path),

  hasUnsavedEdits: () =>
    Object.values(get().files).some(
      (file) =>
        file.dirty ||
        file.saveState === "debouncing" ||
        file.saveState === "saving",
    ),

  hasActiveConflictsOrErrors: () =>
    Object.values(get().files).some(
      (file) => file.saveState === "conflict" || file.saveState === "error",
    ),
}));
