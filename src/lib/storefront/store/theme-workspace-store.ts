import { create } from "zustand";
import type { StorefrontThemeFileDTO } from "../dto/storefront-theme-file.dto";

export type ThemeFileSaveState =
  | "clean"
  | "dirty"
  | "debouncing"
  | "saving"
  | "error"
  | "conflict";

export interface ThemeWorkspaceFileState {
  path: string;
  serverContent: string;
  localContent: string;
  serverVersion: number;
  dirty: boolean;
  saveState: ThemeFileSaveState;
  conflict?: {
    remoteVersion: number;
    remoteContent: string;
  };
  errorMessage?: string;
}

export interface ThemeWorkspaceStore {
  files: Record<string, ThemeWorkspaceFileState>;
  inFlightSaves: Set<string>;
  pendingTimers: Record<string, NodeJS.Timeout>;

  // Actions
  hydrateFromQuery: (themeFiles: StorefrontThemeFileDTO[]) => void;
  updateLocalContent: (path: string, content: string) => void;
  markDebouncing: (path: string, timer: NodeJS.Timeout) => void;
  markSaving: (path: string) => void;
  markSaved: (path: string, newVersion: number, savedContent: string) => void;
  markError: (path: string, message: string) => void;
  markConflict: (
    path: string,
    remoteVersion: number,
    remoteContent: string,
  ) => void;
  resolveConflict: (
    path: string,
    resolution: "reload" | "force_mine",
  ) => { newContent: string; newVersion: number } | null;
  clearPendingTimer: (path: string) => void;
  getDirtyFiles: () => string[];
  hasUnsavedEdits: () => boolean;
  hasActiveConflictsOrErrors: () => boolean;
}

export const useThemeWorkspaceStore = create<ThemeWorkspaceStore>((set, get) => ({
  files: {},
  inFlightSaves: new Set(),
  pendingTimers: {},

  hydrateFromQuery: (themeFiles) => {
    set((state) => {
      const nextFiles = { ...state.files };
      for (const f of themeFiles) {
        const existing = nextFiles[f.path];
        // If file is not dirty and not currently in flight save, sync server content
        if (!existing || (!existing.dirty && !state.inFlightSaves.has(f.path))) {
          nextFiles[f.path] = {
            path: f.path,
            serverContent: f.content,
            localContent: existing?.dirty ? existing.localContent : f.content,
            serverVersion: f.version ?? 1,
            dirty: Boolean(existing?.dirty),
            saveState: existing?.saveState ?? "clean",
            conflict: existing?.conflict,
            errorMessage: existing?.errorMessage,
          };
        } else if (existing && existing.serverVersion !== f.version && f.version) {
          // If server version advanced while local is dirty and not our in-flight save, mark conflict
          if (!state.inFlightSaves.has(f.path) && f.content !== existing.localContent) {
            nextFiles[f.path] = {
              ...existing,
              saveState: "conflict",
              conflict: {
                remoteVersion: f.version,
                remoteContent: f.content,
              },
            };
          }
        }
      }
      return { files: nextFiles };
    });
  },

  updateLocalContent: (path, content) => {
    set((state) => {
      const current = state.files[path];
      const isDirty = current ? content !== current.serverContent : true;
      return {
        files: {
          ...state.files,
          [path]: {
            path,
            serverContent: current?.serverContent ?? content,
            localContent: content,
            serverVersion: current?.serverVersion ?? 1,
            dirty: isDirty,
            saveState: isDirty ? "dirty" : "clean",
            conflict: current?.conflict,
            errorMessage: undefined,
          },
        },
      };
    });
  },

  markDebouncing: (path, timer) => {
    set((state) => {
      const current = state.files[path];
      if (!current) return state;
      return {
        files: {
          ...state.files,
          [path]: { ...current, saveState: "debouncing" },
        },
        pendingTimers: { ...state.pendingTimers, [path]: timer },
      };
    });
  },

  markSaving: (path) => {
    set((state) => {
      const nextInFlight = new Set(state.inFlightSaves);
      nextInFlight.add(path);
      const current = state.files[path];
      if (!current) return { inFlightSaves: nextInFlight };
      return {
        inFlightSaves: nextInFlight,
        files: {
          ...state.files,
          [path]: { ...current, saveState: "saving", errorMessage: undefined },
        },
      };
    });
  },

  markSaved: (path, newVersion, savedContent) => {
    set((state) => {
      const nextInFlight = new Set(state.inFlightSaves);
      nextInFlight.delete(path);
      const current = state.files[path];
      if (!current) return { inFlightSaves: nextInFlight };
      const stillDirty = current.localContent !== savedContent;
      return {
        inFlightSaves: nextInFlight,
        files: {
          ...state.files,
          [path]: {
            ...current,
            serverContent: savedContent,
            serverVersion: newVersion,
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
      const nextInFlight = new Set(state.inFlightSaves);
      nextInFlight.delete(path);
      const current = state.files[path];
      if (!current) return { inFlightSaves: nextInFlight };
      return {
        inFlightSaves: nextInFlight,
        files: {
          ...state.files,
          [path]: {
            ...current,
            saveState: "error",
            errorMessage: message,
          },
        },
      };
    });
  },

  markConflict: (path, remoteVersion, remoteContent) => {
    set((state) => {
      const nextInFlight = new Set(state.inFlightSaves);
      nextInFlight.delete(path);
      const current = state.files[path];
      if (!current) return { inFlightSaves: nextInFlight };
      return {
        inFlightSaves: nextInFlight,
        files: {
          ...state.files,
          [path]: {
            ...current,
            saveState: "conflict",
            conflict: { remoteVersion, remoteContent },
          },
        },
      };
    });
  },

  resolveConflict: (path, resolution) => {
    const state = get();
    const current = state.files[path];
    if (!current?.conflict) return null;

    if (resolution === "reload") {
      const newContent = current.conflict.remoteContent;
      const newVersion = current.conflict.remoteVersion;
      set({
        files: {
          ...state.files,
          [path]: {
            ...current,
            localContent: newContent,
            serverContent: newContent,
            serverVersion: newVersion,
            dirty: false,
            saveState: "clean",
            conflict: undefined,
            errorMessage: undefined,
          },
        },
      });
      return { newContent, newVersion };
    } else {
      // force_mine: acknowledge remote version so next save CAS succeeds
      const newVersion = current.conflict.remoteVersion;
      set({
        files: {
          ...state.files,
          [path]: {
            ...current,
            serverVersion: newVersion,
            saveState: "dirty",
            conflict: undefined,
            errorMessage: undefined,
          },
        },
      });
      return { newContent: current.localContent, newVersion };
    }
  },

  clearPendingTimer: (path) => {
    const timer = get().pendingTimers[path];
    if (timer) {
      clearTimeout(timer);
      set((state) => {
        const next = { ...state.pendingTimers };
        delete next[path];
        return { pendingTimers: next };
      });
    }
  },

  getDirtyFiles: () => {
    const files = get().files;
    return Object.keys(files).filter((p) => files[p].dirty);
  },

  hasUnsavedEdits: () => {
    const files = get().files;
    return Object.values(files).some(
      (f) => f.dirty || f.saveState === "debouncing" || f.saveState === "saving",
    );
  },

  hasActiveConflictsOrErrors: () => {
    const files = get().files;
    return Object.values(files).some(
      (f) => f.saveState === "conflict" || f.saveState === "error",
    );
  },
}));
