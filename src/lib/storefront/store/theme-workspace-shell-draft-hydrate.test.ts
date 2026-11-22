import { beforeEach, describe, expect, it } from "vitest";
import {
  themeFileWritePrecondition,
  useThemeWorkspaceStore,
  type ThemeWorkspaceFileState,
} from "./theme-workspace-store";
import type { StorefrontThemeFileDTO } from "../dto/storefront-theme-file.dto";
import { isThemePublicPath } from "../theme-public-files";

/**
 * Reproduction (no fix): the Code workspace hydrates the store from the file
 * list the shell hands it, and that list carries the author's drafts.
 *
 * `visual-editor-shell.tsx` builds `effectiveThemeFiles` with
 * `content: workspaceFiles[path]?.localContent ?? file.content` and appends
 * local-only drafts as `{ id: "local:<path>", version: 1 }`. It passes that
 * list to `EditorCodeWorkspace` as `files`. When an editable public text file
 * loads, `editor-code-workspace.tsx` calls
 * `hydrateFromQuery(storefrontId, themeId, [...sourceFiles, loaded], ...)`,
 * so `hydrateFromQuery` (which treats every entry as the server copy) sees
 * the drafts as remote content.
 *
 * Each case below states the correct behaviour and is marked `it.fails`
 * while the bug stands. Once the bug is fixed they fail as `it.fails`; flip
 * them to `it`.
 */

const scope = { storefrontId: "store", themeId: "theme" };

const hero: StorefrontThemeFileDTO = {
  id: "hero-id",
  ...scope,
  path: "src/components/Hero.tsx",
  content: "export const Hero = () => <h1>Server</h1>;",
  mimeType: "text/typescript",
  isEntry: false,
  version: 4,
  createdAt: "",
  updatedAt: "",
};

const robots: StorefrontThemeFileDTO = {
  id: "robots-id",
  ...scope,
  path: "public/robots.txt",
  content: "User-agent: *\n",
  mimeType: "text/plain",
  isEntry: false,
  version: 2,
  createdAt: "",
  updatedAt: "",
};

const DRAFT = "export const Hero = () => <h1>My unsaved draft</h1>;";
const NEW_PATH = "src/components/Banner.tsx";
const NEW_DRAFT = "export const Banner = () => <p>new</p>;";

/** The list the shell passes as `files` (visual-editor-shell.tsx effectiveThemeFiles). */
function shellFileList(
  serverFiles: StorefrontThemeFileDTO[],
  workspaceFiles: Record<string, ThemeWorkspaceFileState>,
): StorefrontThemeFileDTO[] {
  const serverPaths = new Set(serverFiles.map((file) => file.path));
  return [
    ...serverFiles.map((file) => ({
      ...file,
      content: workspaceFiles[file.path]?.localContent ?? file.content,
    })),
    ...Object.values(workspaceFiles)
      .filter((file) => !serverPaths.has(file.path) && !isThemePublicPath(file.path))
      .map((file) => ({
        id: `local:${file.path}`,
        ...scope,
        path: file.path,
        content: file.localContent,
        mimeType: file.path.endsWith(".css") ? "text/css" : "text/plain",
        isEntry: false,
        version: 1,
        createdAt: "",
        updatedAt: "",
      })),
  ];
}

/** What the Code workspace's public-text effect sends to the store. */
function openPublicText() {
  const store = useThemeWorkspaceStore.getState();
  const sourceFiles = shellFileList([hero], store.getWorkspaceFiles(scope.storefrontId, scope.themeId));
  store.hydrateFromQuery(scope.storefrontId, scope.themeId, [...sourceFiles, robots], undefined, [robots.path]);
}

function heroState() {
  return useThemeWorkspaceStore.getState().getWorkspaceFiles(scope.storefrontId, scope.themeId)[hero.path]!;
}

describe("Code workspace hydration from the shell's draft-carrying file list", () => {
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
    store.setActiveWorkspace(scope.storefrontId, scope.themeId);
    // What the shell's own hydrate does with the real server read.
    store.hydrateFromQuery(scope.storefrontId, scope.themeId, [hero], 9, [robots.path]);
  });

  it.fails("opening a public text file does not mark an unsaved source draft as a server conflict", () => {
    useThemeWorkspaceStore.getState().updateLocalContent(hero.path, DRAFT, scope);
    expect(heroState()).toMatchObject({ dirty: true, saveState: "dirty" });

    openPublicText();

    expect(heroState().conflict).toBeUndefined();
    expect(heroState()).toMatchObject({
      saveState: "dirty",
      serverContent: hero.content,
      localContent: DRAFT,
    });
  });

  it.fails("'Reload remote' on that conflict does not record the draft as the server's copy", () => {
    useThemeWorkspaceStore.getState().updateLocalContent(hero.path, DRAFT, scope);
    openPublicText();
    // If a conflict is shown at all, "Reload remote" must load the server's copy.
    if (heroState().conflict) {
      useThemeWorkspaceStore.getState().resolveConflict(hero.path, "reload", scope);
    }
    const { saveState, dirty, localContent, serverContent } = heroState();
    // Not "clean" with the unsent draft recorded as the server's copy.
    expect(serverContent).toBe(hero.content);
    expect({ saveState, dirty, localContent }).not.toEqual({
      saveState: "clean",
      dirty: false,
      localContent: DRAFT,
    });
  });

  it.fails("a new local-only source file is not given a 'created' conflict against its own draft", () => {
    useThemeWorkspaceStore.getState().updateLocalContent(NEW_PATH, NEW_DRAFT, scope);
    openPublicText();
    const banner = useThemeWorkspaceStore.getState().getWorkspaceFiles(scope.storefrontId, scope.themeId)[NEW_PATH]!;
    expect(banner.conflict).toBeUndefined();
    expect(banner.saveState).toBe("dirty");
  });

  it.fails("'Keep mine' on that created conflict still writes as a create, not against id 'local:<path>'", () => {
    useThemeWorkspaceStore.getState().updateLocalContent(NEW_PATH, NEW_DRAFT, scope);
    openPublicText();
    useThemeWorkspaceStore.getState().resolveConflict(NEW_PATH, "force_mine", scope);
    const banner = useThemeWorkspaceStore.getState().getWorkspaceFiles(scope.storefrontId, scope.themeId)[NEW_PATH];
    expect(themeFileWritePrecondition(banner)).toEqual({ expectMissing: true });
  });

  it.fails("'Reload remote' on that created conflict, then the next server read, does not drop the new file's draft", () => {
    useThemeWorkspaceStore.getState().updateLocalContent(NEW_PATH, NEW_DRAFT, scope);
    openPublicText();
    useThemeWorkspaceStore.getState().resolveConflict(NEW_PATH, "reload", scope);
    // The shell invalidates the tree after a reload; the server still has no Banner.
    useThemeWorkspaceStore.getState().hydrateFromQuery(scope.storefrontId, scope.themeId, [hero], 9, [robots.path]);
    const banner = useThemeWorkspaceStore.getState().getWorkspaceFiles(scope.storefrontId, scope.themeId)[NEW_PATH];
    expect(banner?.localContent).toBe(NEW_DRAFT);
  });

  it("control: the same open with the server's own copies leaves the draft alone", () => {
    useThemeWorkspaceStore.getState().updateLocalContent(hero.path, DRAFT, scope);
    useThemeWorkspaceStore.getState().hydrateFromQuery(scope.storefrontId, scope.themeId, [hero, robots], undefined, [robots.path]);
    expect(heroState().conflict).toBeUndefined();
    expect(heroState()).toMatchObject({ saveState: "dirty", serverContent: hero.content, localContent: DRAFT });
  });
});
