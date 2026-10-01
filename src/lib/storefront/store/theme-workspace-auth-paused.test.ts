import { beforeEach, describe, expect, it } from "vitest";
import {
  authPausedPaths,
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
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
});

const files = () =>
  useThemeWorkspaceStore
    .getState()
    .getWorkspaceFiles(scope.storefrontId, scope.themeId);

describe("saves held back by paused writes", () => {
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
    ]);
    store.setActiveWorkspace(scope.storefrontId, scope.themeId);
  });

  it("keeps the edit, unsaved and marked, apart from a source conflict", () => {
    const store = useThemeWorkspaceStore.getState();
    store.updateLocalContent("src/Hero.tsx", "my edit", scope);
    store.markAuthPaused("src/Hero.tsx", scope);

    expect(files()["src/Hero.tsx"]).toMatchObject({
      localContent: "my edit",
      dirty: true,
      saveState: "dirty",
      authPaused: true,
    });
    expect(files()["src/Hero.tsx"]?.sourceConflict).toBeUndefined();
    expect(authPausedPaths(files())).toEqual(["src/Hero.tsx"]);
    expect(sourceConflictPaths(files())).toEqual([]);
  });

  it("keeps the newest edit when an earlier save lands after the pause", () => {
    const store = useThemeWorkspaceStore.getState();
    store.updateLocalContent("src/Hero.tsx", "first", scope);
    // The first save is in flight; the session ends; the author keeps typing.
    store.markAuthPaused("src/Hero.tsx", scope);
    store.updateLocalContent("src/Hero.tsx", "first and more", scope);
    store.markSaved({ ...file("src/Hero.tsx", 2), content: "first" }, scope);

    expect(files()["src/Hero.tsx"]).toMatchObject({
      serverContent: "first",
      localContent: "first and more",
      dirty: true,
      authPaused: true,
    });
    expect(authPausedPaths(files())).toEqual(["src/Hero.tsx"]);
  });

  it("clears once the content it held is saved", () => {
    const store = useThemeWorkspaceStore.getState();
    store.updateLocalContent("src/Hero.tsx", "my edit", scope);
    store.markAuthPaused("src/Hero.tsx", scope);
    store.markSaved({ ...file("src/Hero.tsx", 2), content: "my edit" }, scope);

    expect(files()["src/Hero.tsx"]?.authPaused).toBeUndefined();
    expect(authPausedPaths(files())).toEqual([]);
  });

  it("clears once the edit is discarded", () => {
    const store = useThemeWorkspaceStore.getState();
    store.updateLocalContent("src/Hero.tsx", "my edit", scope);
    store.markAuthPaused("src/Hero.tsx", scope);
    store.discardLocalChanges("src/Hero.tsx", scope);

    expect(authPausedPaths(files())).toEqual([]);
  });

  it("keeps both marks when another tab saved the same file meanwhile", () => {
    const store = useThemeWorkspaceStore.getState();
    store.updateLocalContent("src/Hero.tsx", "my edit", scope);
    store.markAuthPaused("src/Hero.tsx", scope);
    store.hydrateFromQuery(scope.storefrontId, scope.themeId, [
      { ...file("src/Hero.tsx", 2), content: "their edit" },
    ]);

    expect(files()["src/Hero.tsx"]).toMatchObject({
      localContent: "my edit",
      authPaused: true,
      saveState: "conflict",
      conflict: { kind: "modified", remoteContent: "their edit" },
    });
  });
});
