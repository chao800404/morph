import { beforeEach, describe, expect, it } from "vitest";
import {
  unconfirmedPaths,
  useThemeWorkspaceStore,
} from "./theme-workspace-store";
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

describe("saves sent and never answered", () => {
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
    store.updateLocalContent(PATH, "sent", scope);
    store.markUnconfirmed(PATH, "sent", scope);
  });

  it("keeps the edit unsaved and remembers what was sent", () => {
    expect(hero()).toMatchObject({
      localContent: "sent",
      serverContent: "before",
      dirty: true,
      unconfirmedContent: "sent",
    });
    expect(
      unconfirmedPaths(
        useThemeWorkspaceStore
          .getState()
          .getWorkspaceFiles(scope.storefrontId, scope.themeId),
      ),
    ).toEqual([PATH]);
  });

  it("is answered by a save landing", () => {
    useThemeWorkspaceStore.getState().markSaved(file("sent", 2), scope);
    expect(hero()?.unconfirmedContent).toBeUndefined();
    expect(hero()?.dirty).toBe(false);
  });

  it("is answered by a version conflict, and by discarding the edit", () => {
    const store = useThemeWorkspaceStore.getState();
    store.markConflict(
      PATH,
      {
        kind: "modified",
        remoteExists: true,
        remoteFileId: "id-hero",
        remoteVersion: 2,
        remoteContent: "theirs",
      },
      scope,
    );
    expect(hero()?.unconfirmedContent).toBeUndefined();

    store.markUnconfirmed(PATH, "sent", scope);
    store.discardLocalChanges(PATH, scope);
    expect(hero()?.unconfirmedContent).toBeUndefined();
  });

  it("reads the server's copy of the sent content as landed, not as a conflict", () => {
    const store = useThemeWorkspaceStore.getState();
    // The author kept typing after the answer was lost.
    store.updateLocalContent(PATH, "sent and more", scope);
    store.hydrateFromQuery(scope.storefrontId, scope.themeId, [
      file("sent", 2),
    ]);

    expect(hero()).toMatchObject({
      serverContent: "sent",
      serverVersion: 2,
      localContent: "sent and more",
      dirty: true,
      saveState: "dirty",
    });
    expect(hero()?.conflict).toBeUndefined();
    expect(hero()?.unconfirmedContent).toBeUndefined();
  });

  it("still shows someone else's content as a conflict", () => {
    useThemeWorkspaceStore
      .getState()
      .hydrateFromQuery(scope.storefrontId, scope.themeId, [file("theirs", 2)]);

    expect(hero()).toMatchObject({
      localContent: "sent",
      saveState: "conflict",
      conflict: { kind: "modified", remoteContent: "theirs" },
    });
  });
});
