import { beforeEach, describe, expect, it } from "vitest";
import {
  sourceConflictPaths,
  useThemeWorkspaceStore,
} from "./theme-workspace-store";
import type { StorefrontThemeFileDTO } from "../dto/storefront-theme-file.dto";

const scope = { storefrontId: "store-a", themeId: "theme-a" };

const file = (path: string, version = 1): StorefrontThemeFileDTO => ({
  id: `id-${path}`,
  storefrontId: scope.storefrontId,
  themeId: scope.themeId,
  path,
  content: `saved ${path}`,
  mimeType: "text/typescript",
  isEntry: false,
  version,
  createdAt: "2026-09-24T00:00:00Z",
  updatedAt: "2026-09-24T00:00:00Z",
});

const files = () =>
  useThemeWorkspaceStore
    .getState()
    .getWorkspaceFiles(scope.storefrontId, scope.themeId);

describe("source generation conflicts", () => {
  beforeEach(() => {
    useThemeWorkspaceStore.setState({
      activeWorkspaceKey: null,
      workspaces: {},
      files: {},
      acceptedGenerations: {},
      observedGenerations: {},
      generations: {},
    });
    const store = useThemeWorkspaceStore.getState();
    store.hydrateFromQuery(scope.storefrontId, scope.themeId, [
      file("src/Hero.tsx"),
      file("src/hello.tsx"),
    ]);
    store.setActiveWorkspace(scope.storefrontId, scope.themeId);
  });

  it("keeps the refused edit, unsaved and marked", () => {
    const store = useThemeWorkspaceStore.getState();
    store.updateLocalContent("src/Hero.tsx", "my edit", scope);
    store.markSourceConflict("src/Hero.tsx", scope);

    expect(files()["src/Hero.tsx"]).toMatchObject({
      localContent: "my edit",
      dirty: true,
      saveState: "dirty",
      sourceConflict: true,
    });
    expect(sourceConflictPaths(files())).toEqual(["src/Hero.tsx"]);
  });

  it("clears once the edit is saved", () => {
    const store = useThemeWorkspaceStore.getState();
    store.updateLocalContent("src/Hero.tsx", "my edit", scope);
    store.markSourceConflict("src/Hero.tsx", scope);
    store.markSaved(
      { ...file("src/Hero.tsx", 2), content: "my edit" },
      scope,
      7,
    );

    expect(files()["src/Hero.tsx"]?.sourceConflict).toBeUndefined();
    expect(sourceConflictPaths(files())).toEqual([]);
  });

  it("clears once the edit is discarded", () => {
    const store = useThemeWorkspaceStore.getState();
    store.updateLocalContent("src/Hero.tsx", "my edit", scope);
    store.markSourceConflict("src/Hero.tsx", scope);
    store.discardLocalChanges("src/Hero.tsx", scope);

    expect(sourceConflictPaths(files())).toEqual([]);
  });

  it("is not cleared by accepting the newer generation alone", () => {
    // Accepting only lets the save be attempted; the edit is still unsaved.
    const store = useThemeWorkspaceStore.getState();
    store.updateLocalContent("src/Hero.tsx", "my edit", scope);
    store.markSourceConflict("src/Hero.tsx", scope);
    store.acceptRemoteGeneration(9, scope);

    expect(sourceConflictPaths(files())).toEqual(["src/Hero.tsx"]);
  });
});
