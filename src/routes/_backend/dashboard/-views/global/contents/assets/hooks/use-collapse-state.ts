import { useEffect, useLayoutEffect, useState } from "react";

interface CollapseState {
  foldersCollapsed: boolean;
  assetsCollapsed: boolean;
}

const STORAGE_PREFIX = "assets-collapse-";
const DEFAULT_COLLAPSE_STATE: CollapseState = {
  foldersCollapsed: false,
  assetsCollapsed: false,
};

function getSavedCollapseState(folderId: string | null): CollapseState {
  if (typeof window === "undefined") return DEFAULT_COLLAPSE_STATE;
  try {
    const storageKey = `${STORAGE_PREFIX}${folderId ?? "root"}`;
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      return JSON.parse(stored) as CollapseState;
    }
  } catch {
    // Invalid JSON, skip
  }
  return DEFAULT_COLLAPSE_STATE;
}

/**
 * Manage collapse state for a specific folder, persisting to localStorage.
 * Each folder path has its own collapse state independent of others.
 * State is loaded synchronously before render via useLayoutEffect to avoid flash.
 */
export const useCollapseState = (folderId: string | null) => {
  const [foldersCollapsed, setFoldersCollapsed] = useState(() =>
    getSavedCollapseState(folderId).foldersCollapsed,
  );
  const [assetsCollapsed, setAssetsCollapsed] = useState(() =>
    getSavedCollapseState(folderId).assetsCollapsed,
  );

  const storageKey = `${STORAGE_PREFIX}${folderId ?? "root"}`;

  // Load from localStorage before paint when folderId changes
  useLayoutEffect(() => {
    const saved = getSavedCollapseState(folderId);
    setFoldersCollapsed(saved.foldersCollapsed);
    setAssetsCollapsed(saved.assetsCollapsed);
  }, [folderId]);

  // Save to localStorage whenever state changes
  useEffect(() => {
    const state: CollapseState = { foldersCollapsed, assetsCollapsed };
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, [foldersCollapsed, assetsCollapsed, storageKey]);

  const handleSetFoldersCollapsed = (collapsed: boolean) => {
    setFoldersCollapsed(collapsed);
  };

  const handleSetAssetsCollapsed = (collapsed: boolean) => {
    setAssetsCollapsed(collapsed);
  };

  return {
    foldersCollapsed,
    assetsCollapsed,
    setFoldersCollapsed: handleSetFoldersCollapsed,
    setAssetsCollapsed: handleSetAssetsCollapsed,
  };
};
