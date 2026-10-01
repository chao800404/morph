import { beforeEach, describe, expect, it } from "vitest";
import { useThemeWorkspaceStore } from "./theme-workspace-store";
import type { StorefrontThemeFileDTO } from "../dto/storefront-theme-file.dto";

const scope = { storefrontId: "store-a", themeId: "theme-a" };
const PATH = "src/Hero.tsx";

const file = (content: string, version = 1): StorefrontThemeFileDTO => ({
  id: "id-hero",
  storefrontId: scope.storefrontId,
  themeId: scope.themeId,
  path: PATH,
  content,
  mimeType: "text/typescript",
  isEntry: false,
  version,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
});

const hero = () =>
  useThemeWorkspaceStore
    .getState()
    .getWorkspaceFiles(scope.storefrontId, scope.themeId)[PATH];

describe("a save refused for an earlier sign-in", () => {
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
    store.hydrateFromQuery(scope.storefrontId, scope.themeId, [file("before")]);
    store.setActiveWorkspace(scope.storefrontId, scope.themeId);
    store.updateLocalContent(PATH, "mine", scope);
    store.markRefusedEarlier(PATH, scope);
  });

  it("keeps the edit unsaved and marked", () => {
    expect(hero()).toMatchObject({
      localContent: "mine",
      serverContent: "before",
      dirty: true,
      refusedEarlier: true,
    });
  });

  it("is cleared once a save of the file lands", () => {
    useThemeWorkspaceStore.getState().markSaved(file("mine", 2), scope);
    expect(hero()?.refusedEarlier).toBeUndefined();
    expect(hero()?.dirty).toBe(false);
  });

  it("is cleared once the edit is discarded", () => {
    useThemeWorkspaceStore.getState().discardLocalChanges(PATH, scope);
    expect(hero()?.refusedEarlier).toBeUndefined();
  });
});
