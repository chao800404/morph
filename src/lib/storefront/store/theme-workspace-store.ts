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

export interface WorkspaceScope {
  storefrontId: string;
  themeId: string;
}

export interface ThemeWorkspaceStore {
  activeWorkspaceKey: string | null;
  workspaces: Record<string, Record<string, ThemeWorkspaceFileState>>;
  files: Record<string, ThemeWorkspaceFileState>;

  setActiveWorkspace: (storefrontId: string, themeId: string) => void;
  hydrateFromQuery: (
    storefrontId: string,
    themeId: string,
    themeFiles: StorefrontThemeFileDTO[],
  ) => void;
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
  markSaved: (saved: StorefrontThemeFileDTO, scope?: WorkspaceScope) => void;
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

export const useThemeWorkspaceStore = create<ThemeWorkspaceStore>((set, get) => ({
  activeWorkspaceKey: null,
  workspaces: {},
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

  getWorkspaceFiles: (storefrontId?: string, themeId?: string) => {
    const state = get();
    if (storefrontId && themeId) {
      const key = toWorkspaceKey(storefrontId, themeId);
      return state.workspaces[key] ?? {};
    }
    return state.files;
  },

  hydrateFromQuery: (storefrontId, themeId, themeFiles) => {
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

        if (!current.dirty && (serverChanged || current.saveState !== "clean")) {
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

      if (!hasChanges && state.activeWorkspaceKey === targetKey) {
        return state;
      }

      const nextWorkspaces = {
        ...state.workspaces,
        [targetKey]: next,
      };

      const isActive = state.activeWorkspaceKey === targetKey;
      return {
        workspaces: nextWorkspaces,
        activeWorkspaceKey: state.activeWorkspaceKey ?? targetKey,
        files: isActive || state.activeWorkspaceKey === null ? next : state.files,
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
            serverExists: false,
            serverFileId: null,
            serverContent: "",
            localContent: content,
            serverVersion: null,
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

  markSaved: (saved, scope) => {
    set((state) => {
      const resolvedScope = scope ?? {
        storefrontId: saved.storefrontId,
        themeId: saved.themeId,
      };
      const { key, workspaceFiles } = getTargetWorkspace(state, resolvedScope);
      const current = workspaceFiles[saved.path] ?? fromServerFile(saved);
      const stillDirty = current.localContent !== saved.content;

      const next = {
        ...workspaceFiles,
        [saved.path]: {
          ...current,
          serverExists: true,
          serverFileId: saved.id,
          serverContent: saved.content,
          serverVersion: saved.version,
          dirty: stillDirty,
          saveState: stillDirty ? ("dirty" as const) : ("clean" as const),
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
        return {
          content: null,
          serverExists: false,
          serverFileId: null,
          serverVersion: null,
        };
      }

      const next = {
        ...workspaceFiles,
        [path]: {
          ...current,
          serverExists: true,
          serverFileId: conflict.remoteFileId,
          serverContent: conflict.remoteContent,
          localContent: conflict.remoteContent,
          serverVersion: conflict.remoteVersion,
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
        serverExists: true,
        serverFileId: conflict.remoteFileId,
        serverVersion: conflict.remoteVersion,
      };
    }

    const next = {
      ...workspaceFiles,
      [path]: {
        ...current,
        serverExists: conflict.remoteExists,
        serverFileId: conflict.remoteExists ? conflict.remoteFileId : null,
        serverContent: conflict.remoteExists ? conflict.remoteContent : "",
        serverVersion: conflict.remoteVersion ?? null,
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
      serverExists: conflict.remoteExists,
      serverFileId: conflict.remoteExists ? conflict.remoteFileId : null,
      serverVersion: conflict.remoteVersion ?? null,
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
}));
