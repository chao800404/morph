import { beforeEach, describe, expect, it } from "vitest";
import {
  themeFileWritePrecondition,
  useThemeWorkspaceStore,
} from "./theme-workspace-store";
import type { StorefrontThemeFileDTO } from "../dto/storefront-theme-file.dto";

describe("ThemeWorkspaceStore", () => {
  beforeEach(() => {
    useThemeWorkspaceStore.setState({
      activeWorkspaceKey: null,
      workspaces: {},
      files: {},
      acceptedGenerations: {},
      observedGenerations: {},
      generations: {},
    });
  });

  it("isolates files between different workspaces (storefrontId:themeId)", () => {
    const store = useThemeWorkspaceStore.getState();

    const fileA: StorefrontThemeFileDTO = {
      id: "file-1",
      storefrontId: "store-a",
      themeId: "theme-a",
      path: "src/components/Hero.tsx",
      content: "export const Hero = () => <div>Theme A</div>;",
      mimeType: "text/plain",
      isEntry: false,
      version: 1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const fileB: StorefrontThemeFileDTO = {
      id: "file-2",
      storefrontId: "store-a",
      themeId: "theme-b",
      path: "src/components/Hero.tsx",
      content: "export const Hero = () => <div>Theme B</div>;",
      mimeType: "text/plain",
      isEntry: false,
      version: 1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    // Hydrate Theme A
    store.hydrateFromQuery("store-a", "theme-a", [fileA]);
    store.setActiveWorkspace("store-a", "theme-a");

    // Make local change in Theme A
    store.updateLocalContent(
      "src/components/Hero.tsx",
      "export const Hero = () => <div>Theme A Dirty</div>;",
    );
    expect(
      useThemeWorkspaceStore.getState().files["src/components/Hero.tsx"].dirty,
    ).toBe(true);
    expect(useThemeWorkspaceStore.getState().getDirtyFiles()).toEqual([
      "src/components/Hero.tsx",
    ]);

    // Hydrate and switch to Theme B
    store.hydrateFromQuery("store-a", "theme-b", [fileB]);
    store.setActiveWorkspace("store-a", "theme-b");

    // Theme B should be completely clean and isolated!
    const themeBFiles = useThemeWorkspaceStore.getState().files;
    expect(themeBFiles["src/components/Hero.tsx"].serverContent).toBe(
      "export const Hero = () => <div>Theme B</div>;",
    );
    expect(themeBFiles["src/components/Hero.tsx"].dirty).toBe(false);
    expect(useThemeWorkspaceStore.getState().getDirtyFiles()).toEqual([]);

    // Switch back to Theme A and verify dirty state is preserved intact without pollution
    store.setActiveWorkspace("store-a", "theme-a");
    const themeAFiles = useThemeWorkspaceStore.getState().files;
    expect(themeAFiles["src/components/Hero.tsx"].localContent).toBe(
      "export const Hero = () => <div>Theme A Dirty</div>;",
    );
    expect(themeAFiles["src/components/Hero.tsx"].dirty).toBe(true);
  });

  it("handles conflict resolution properly within active workspace", () => {
    const store = useThemeWorkspaceStore.getState();

    const file: StorefrontThemeFileDTO = {
      id: "file-1",
      storefrontId: "store-a",
      themeId: "theme-a",
      path: "src/pages/index.tsx",
      content: "initial content",
      mimeType: "text/plain",
      isEntry: true,
      version: 1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    store.hydrateFromQuery("store-a", "theme-a", [file]);
    store.setActiveWorkspace("store-a", "theme-a");

    // User edits file locally
    store.updateLocalContent("src/pages/index.tsx", "my local draft");

    // Server updates file concurrently (remote version = 2)
    store.hydrateFromQuery("store-a", "theme-a", [
      {
        ...file,
        version: 2,
        content: "concurrent server update",
      },
    ]);

    expect(useThemeWorkspaceStore.getState().hasActiveConflictsOrErrors()).toBe(
      true,
    );
    const fileState =
      useThemeWorkspaceStore.getState().files["src/pages/index.tsx"];
    expect(fileState.saveState).toBe("conflict");
    expect(fileState.conflict?.kind).toBe("modified");

    // Reload remote resolution
    store.resolveConflict("src/pages/index.tsx", "reload");
    expect(useThemeWorkspaceStore.getState().hasActiveConflictsOrErrors()).toBe(
      false,
    );
    expect(
      useThemeWorkspaceStore.getState().files["src/pages/index.tsx"]
        .localContent,
    ).toBe("concurrent server update");
  });

  it("never falls back to active workspace when explicit scope is given", () => {
    const store = useThemeWorkspaceStore.getState();

    const fileA: StorefrontThemeFileDTO = {
      id: "file-1",
      storefrontId: "store-a",
      themeId: "theme-a",
      path: "src/components/Hero.tsx",
      content: "Theme A original",
      mimeType: "text/plain",
      isEntry: false,
      version: 1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const fileB: StorefrontThemeFileDTO = {
      id: "file-2",
      storefrontId: "store-a",
      themeId: "theme-b",
      path: "src/components/Hero.tsx",
      content: "Theme B original",
      mimeType: "text/plain",
      isEntry: false,
      version: 1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    store.hydrateFromQuery("store-a", "theme-a", [fileA]);
    store.hydrateFromQuery("store-a", "theme-b", [fileB]);

    // Active workspace is Theme B
    store.setActiveWorkspace("store-a", "theme-b");

    // Async action completes for Theme A with explicit scope
    store.updateLocalContent("src/components/Hero.tsx", "Theme A async save", {
      storefrontId: "store-a",
      themeId: "theme-a",
    });

    // Active workspace (Theme B) must remain unchanged
    expect(
      useThemeWorkspaceStore.getState().files["src/components/Hero.tsx"]
        .localContent,
    ).toBe("Theme B original");

    // Theme A workspace received the change
    const themeAFiles = useThemeWorkspaceStore
      .getState()
      .getWorkspaceFiles("store-a", "theme-a");
    expect(themeAFiles["src/components/Hero.tsx"].localContent).toBe(
      "Theme A async save",
    );
  });

  it("distinguishes acceptedSourceGeneration and observedServerGeneration", () => {
    const scope = { storefrontId: "store-a", themeId: "theme-a" };

    // Initial hydrate sets both accepted and observed to 10
    useThemeWorkspaceStore
      .getState()
      .hydrateFromQuery("store-a", "theme-a", [], 10);
    expect(
      useThemeWorkspaceStore.getState().getAcceptedSourceGeneration(scope),
    ).toBe(10);
    expect(
      useThemeWorkspaceStore.getState().getObservedSourceGeneration(scope),
    ).toBe(10);
    expect(
      useThemeWorkspaceStore.getState().hasRemoteSourceChanged(scope),
    ).toBe(false);

    // Background poll observes server generation 12 (remote changed)
    useThemeWorkspaceStore
      .getState()
      .hydrateFromQuery("store-a", "theme-a", [], 12);
    // Accepted generation remains 10 because user hasn't saved or accepted
    expect(
      useThemeWorkspaceStore.getState().getAcceptedSourceGeneration(scope),
    ).toBe(10);
    expect(
      useThemeWorkspaceStore.getState().getObservedSourceGeneration(scope),
    ).toBe(12);
    expect(
      useThemeWorkspaceStore.getState().hasRemoteSourceChanged(scope),
    ).toBe(true);

    // Own save completes with generation 13, advancing both accepted and observed
    useThemeWorkspaceStore.getState().markSaved(
      {
        id: "f-1",
        storefrontId: "store-a",
        themeId: "theme-a",
        path: "src/pages/index.tsx",
        content: "console.log(1);",
        mimeType: "text/plain",
        isEntry: true,
        version: 2,
        createdAt: "now",
        updatedAt: "now",
        sourceGeneration: 13,
      },
      scope,
      13,
    );
    expect(
      useThemeWorkspaceStore.getState().getAcceptedSourceGeneration(scope),
    ).toBe(13);
    expect(
      useThemeWorkspaceStore.getState().getObservedSourceGeneration(scope),
    ).toBe(13);
    expect(
      useThemeWorkspaceStore.getState().hasRemoteSourceChanged(scope),
    ).toBe(false);
  });

  it("accepts the generation created by its own starter initialization", () => {
    const scope = { storefrontId: "store-a", themeId: "theme-a" };
    const store = useThemeWorkspaceStore.getState();

    store.hydrateFromQuery("store-a", "theme-a", [], 1);
    store.acceptRemoteGeneration(2, scope);
    store.hydrateFromQuery(
      "store-a",
      "theme-a",
      [
        {
          id: "principles-file",
          storefrontId: "store-a",
          themeId: "theme-a",
          path: "src/components/Principles.tsx",
          content: "export default function Principles() {}",
          mimeType: "text/typescript",
          isEntry: false,
          version: 1,
          createdAt: "now",
          updatedAt: "now",
        },
      ],
      2,
    );

    expect(store.getAcceptedSourceGeneration(scope)).toBe(2);
    expect(store.getObservedSourceGeneration(scope)).toBe(2);
    expect(store.hasRemoteSourceChanged(scope)).toBe(false);
  });

  it("acceptRemoteWorkspace accepts remote generation and resolves conflict states", () => {
    const scope = { storefrontId: "store-a", themeId: "theme-a" };
    const store = useThemeWorkspaceStore.getState();

    store.hydrateFromQuery(
      "store-a",
      "theme-a",
      [
        {
          id: "f-1",
          storefrontId: "store-a",
          themeId: "theme-a",
          path: "src/pages/index.tsx",
          content: "initial",
          mimeType: "text/plain",
          isEntry: true,
          version: 1,
          createdAt: "now",
          updatedAt: "now",
        },
      ],
      10,
    );

    // Make local change
    useThemeWorkspaceStore
      .getState()
      .updateLocalContent("src/pages/index.tsx", "local draft", scope);

    // Background refetch gets version 2, generation 15 -> creates conflict
    useThemeWorkspaceStore.getState().hydrateFromQuery(
      "store-a",
      "theme-a",
      [
        {
          id: "f-1",
          storefrontId: "store-a",
          themeId: "theme-a",
          path: "src/pages/index.tsx",
          content: "remote update",
          mimeType: "text/plain",
          isEntry: true,
          version: 2,
          createdAt: "now",
          updatedAt: "now",
        },
      ],
      15,
    );

    expect(
      useThemeWorkspaceStore.getState().hasRemoteSourceChanged(scope),
    ).toBe(true);
    expect(
      useThemeWorkspaceStore.getState().hasActiveConflictsOrErrors(scope),
    ).toBe(true);

    // Explicitly accept remote workspace
    useThemeWorkspaceStore.getState().acceptRemoteWorkspace(scope);

    expect(
      useThemeWorkspaceStore.getState().getAcceptedSourceGeneration(scope),
    ).toBe(15);
    expect(
      useThemeWorkspaceStore.getState().getObservedSourceGeneration(scope),
    ).toBe(15);
    expect(
      useThemeWorkspaceStore.getState().hasRemoteSourceChanged(scope),
    ).toBe(false);
    expect(
      useThemeWorkspaceStore.getState().hasActiveConflictsOrErrors(scope),
    ).toBe(false);
    expect(
      useThemeWorkspaceStore.getState().getWorkspaceFiles("store-a", "theme-a")[
        "src/pages/index.tsx"
      ]?.localContent,
    ).toBe("remote update");
  });

  it("markDirty preserves local dirty state on source generation conflict without marking as error", () => {
    const scope = { storefrontId: "store-a", themeId: "theme-a" };
    const store = useThemeWorkspaceStore.getState();

    store.hydrateFromQuery(
      "store-a",
      "theme-a",
      [
        {
          id: "f-hero",
          storefrontId: "store-a",
          themeId: "theme-a",
          path: "src/components/Hero.tsx",
          content: "export const Hero = () => <div>Original</div>;",
          mimeType: "text/plain",
          isEntry: false,
          version: 1,
          createdAt: "now",
          updatedAt: "now",
        },
      ],
      10,
    );

    // User edits Hero locally
    store.updateLocalContent(
      "src/components/Hero.tsx",
      "export const Hero = () => <div>My Dirty Hero</div>;",
      scope,
    );

    // Marked as saving
    store.markSaving("src/components/Hero.tsx", scope);
    expect(
      store.getWorkspaceFiles("store-a", "theme-a")["src/components/Hero.tsx"]
        ?.saveState,
    ).toBe("saving");

    // Source generation conflict occurs (e.g. Footer was modified concurrently)
    // Server rejects save with SOURCE_GENERATION_CONFLICT -> client calls markDirty
    store.markDirty("src/components/Hero.tsx", scope);

    const heroFile = store.getWorkspaceFiles("store-a", "theme-a")[
      "src/components/Hero.tsx"
    ];
    expect(heroFile?.dirty).toBe(true);
    expect(heroFile?.saveState).toBe("dirty");
    expect(heroFile?.errorMessage).toBeUndefined();
    expect(heroFile?.localContent).toBe(
      "export const Hero = () => <div>My Dirty Hero</div>;",
    );

    // Remote query background refetch observes generation 11
    store.hydrateFromQuery(
      "store-a",
      "theme-a",
      [
        {
          id: "f-hero",
          storefrontId: "store-a",
          themeId: "theme-a",
          path: "src/components/Hero.tsx",
          content: "export const Hero = () => <div>Original</div>;",
          mimeType: "text/plain",
          isEntry: false,
          version: 1,
          createdAt: "now",
          updatedAt: "now",
        },
      ],
      11,
    );
    expect(store.hasRemoteSourceChanged(scope)).toBe(true);

    // User accepts remote generation
    store.acceptRemoteGeneration(undefined, scope);
    expect(store.getAcceptedSourceGeneration(scope)).toBe(11);
    expect(store.hasRemoteSourceChanged(scope)).toBe(false);

    // Hero is still dirty with user's edits intact ready for next save!
    const heroAfterAccept = store.getWorkspaceFiles("store-a", "theme-a")[
      "src/components/Hero.tsx"
    ];
    expect(heroAfterAccept?.dirty).toBe(true);
    expect(heroAfterAccept?.saveState).toBe("dirty");
    expect(heroAfterAccept?.localContent).toBe(
      "export const Hero = () => <div>My Dirty Hero</div>;",
    );
  });
});

describe("themeFileWritePrecondition", () => {
  it("sends the id and version together for a file the server holds", () => {
    expect(
      themeFileWritePrecondition({
        serverExists: true,
        serverFileId: "file-1",
        serverVersion: 3,
      }),
    ).toEqual({
      expectMissing: false,
      expectedFileId: "file-1",
      expectedVersion: 3,
    });
  });

  it("asks for a create, and never a version, for a file the server lacks", () => {
    // The server rejects `expectMissing` combined with either expected field,
    // so the absent case has to omit them rather than send them as undefined.
    const precondition = themeFileWritePrecondition({
      serverExists: false,
      serverFileId: null,
      serverVersion: null,
    });

    expect(precondition).toEqual({ expectMissing: true });
    expect(precondition).not.toHaveProperty("expectedFileId");
    expect(precondition).not.toHaveProperty("expectedVersion");
  });

  it("treats a file the workspace has never seen as a create", () => {
    expect(themeFileWritePrecondition(undefined)).toEqual({
      expectMissing: true,
    });
  });
});

describe("server state stays indivisible", () => {
  const serverFile: StorefrontThemeFileDTO = {
    id: "file-1",
    storefrontId: "store-a",
    themeId: "theme-a",
    path: "src/app.tsx",
    content: "export const App = () => null;",
    version: 2,
    mimeType: "text/plain",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  } as StorefrontThemeFileDTO;

  const scope = { storefrontId: "store-a", themeId: "theme-a" };

  it("never records a file as present without an id and version", () => {
    const store = useThemeWorkspaceStore.getState();
    store.setActiveWorkspace(scope.storefrontId, scope.themeId);
    store.hydrateFromQuery(scope.storefrontId, scope.themeId, [serverFile], 1);

    // Walk the file through the transitions that used to write the three
    // fields independently: a local edit, a save landing, and a conflict.
    store.updateLocalContent(serverFile.path, "edited", scope);
    store.markSaved({ ...serverFile, content: "edited", version: 3 }, scope);
    store.updateLocalContent(serverFile.path, "edited again", scope);
    store.markConflict(
      serverFile.path,
      {
        kind: "modified",
        remoteExists: true,
        remoteFileId: serverFile.id,
        remoteVersion: 4,
        remoteContent: "remote",
      },
      scope,
    );
    useThemeWorkspaceStore
      .getState()
      .resolveConflict(serverFile.path, "force_mine", scope);

    for (const file of Object.values(
      useThemeWorkspaceStore
        .getState()
        .getWorkspaceFiles(scope.storefrontId, scope.themeId),
    )) {
      if (file.serverExists) {
        expect(file.serverFileId).toEqual(expect.any(String));
        expect(file.serverVersion).toEqual(expect.any(Number));
      } else {
        expect(file.serverFileId).toBeNull();
        expect(file.serverVersion).toBeNull();
      }
    }
  });

  it("keeps a locally created file addressable as a create", () => {
    const store = useThemeWorkspaceStore.getState();
    store.setActiveWorkspace(scope.storefrontId, scope.themeId);
    store.updateLocalContent(
      "src/new.tsx",
      "export const New = () => null;",
      scope,
    );

    const created = useThemeWorkspaceStore
      .getState()
      .getWorkspaceFiles(scope.storefrontId, scope.themeId)["src/new.tsx"];

    expect(created.serverExists).toBe(false);
    expect(themeFileWritePrecondition(created)).toEqual({
      expectMissing: true,
    });
  });
});
