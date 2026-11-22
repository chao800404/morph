import { beforeEach, describe, expect, it } from "vitest";
import {
  LOCAL_DRAFT_FILE_ID_PREFIX,
  themeFileWritePrecondition,
  useThemeWorkspaceStore,
  type ThemeWorkspaceFileState,
} from "./theme-workspace-store";
import type { StorefrontThemeFileDTO } from "../dto/storefront-theme-file.dto";
import { isThemePublicPath } from "../theme-public-files";

/**
 * The Code workspace used to hydrate the store from the file list the shell
 * hands it, and that list carries the author's drafts.
 *
 * `visual-editor-shell.tsx` builds `effectiveThemeFiles` with
 * `content: workspaceFiles[path]?.localContent ?? file.content` and appends
 * local-only drafts as `{ id: "local:<path>", version: 1 }`. It passes that
 * list to `EditorCodeWorkspace` as `files`. When an editable public text file
 * loaded, `editor-code-workspace.tsx` called
 * `hydrateFromQuery(storefrontId, themeId, [...sourceFiles, loaded], ...)`,
 * so `hydrateFromQuery` (which treats every entry as the server copy) saw
 * the drafts as remote content.
 *
 * The effect now sends only the loaded server copy, through
 * `hydrateServerFile`; `openPublicText` below does what it sends. As a
 * defence, `hydrateFromQuery` refuses entries under a minted local id, which
 * the second block checks with the shell's mixed list itself.
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
        id: `${LOCAL_DRAFT_FILE_ID_PREFIX}${file.path}`,
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
function openPublicText(loaded: StorefrontThemeFileDTO = robots) {
  useThemeWorkspaceStore.getState().hydrateServerFile(scope.storefrontId, scope.themeId, loaded);
}

/** What the effect sent before the fix: the shell's draft-carrying list. */
function hydrateWithShellList() {
  const store = useThemeWorkspaceStore.getState();
  const sourceFiles = shellFileList([hero], store.getWorkspaceFiles(scope.storefrontId, scope.themeId));
  store.hydrateFromQuery(scope.storefrontId, scope.themeId, [...sourceFiles, robots], undefined, [robots.path]);
}

function workspaceFile(path: string) {
  return useThemeWorkspaceStore.getState().getWorkspaceFiles(scope.storefrontId, scope.themeId)[path];
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

  it("opening a public text file does not mark an unsaved source draft as a server conflict", () => {
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

  it("'Reload remote' on that conflict does not record the draft as the server's copy", () => {
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

  it("a new local-only source file is not given a 'created' conflict against its own draft", () => {
    useThemeWorkspaceStore.getState().updateLocalContent(NEW_PATH, NEW_DRAFT, scope);
    openPublicText();
    const banner = useThemeWorkspaceStore.getState().getWorkspaceFiles(scope.storefrontId, scope.themeId)[NEW_PATH]!;
    expect(banner.conflict).toBeUndefined();
    expect(banner.saveState).toBe("dirty");
  });

  it("'Keep mine' on that created conflict still writes as a create, not against id 'local:<path>'", () => {
    useThemeWorkspaceStore.getState().updateLocalContent(NEW_PATH, NEW_DRAFT, scope);
    openPublicText();
    useThemeWorkspaceStore.getState().resolveConflict(NEW_PATH, "force_mine", scope);
    const banner = useThemeWorkspaceStore.getState().getWorkspaceFiles(scope.storefrontId, scope.themeId)[NEW_PATH];
    expect(themeFileWritePrecondition(banner)).toEqual({ expectMissing: true });
  });

  it("'Reload remote' on that created conflict, then the next server read, does not drop the new file's draft", () => {
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

  it("opening a public text file records it as the server's copy and leaves every other path alone", () => {
    useThemeWorkspaceStore.getState().updateLocalContent(hero.path, DRAFT, scope);
    useThemeWorkspaceStore.getState().updateLocalContent(NEW_PATH, NEW_DRAFT, scope);
    const before = useThemeWorkspaceStore.getState();
    const heroBefore = heroState();
    const bannerBefore = workspaceFile(NEW_PATH);

    openPublicText();

    expect(workspaceFile(robots.path)).toMatchObject({
      serverExists: true,
      serverFileId: robots.id,
      serverVersion: robots.version,
      serverContent: robots.content,
      localContent: robots.content,
      saveState: "clean",
    });
    expect(heroState()).toBe(heroBefore);
    expect(workspaceFile(NEW_PATH)).toBe(bannerBefore);
    const after = useThemeWorkspaceStore.getState();
    expect(after.acceptedGenerations).toBe(before.acceptedGenerations);
    expect(after.observedGenerations).toBe(before.observedGenerations);
  });

  it("a genuine server change to a source file with a draft is still a 'modified' conflict", () => {
    useThemeWorkspaceStore.getState().updateLocalContent(hero.path, DRAFT, scope);
    openPublicText();
    const remote = { ...hero, version: 5, content: "export const Hero = () => <h1>Someone else</h1>;" };
    useThemeWorkspaceStore.getState().hydrateFromQuery(scope.storefrontId, scope.themeId, [remote], 10, [robots.path]);
    expect(heroState()).toMatchObject({
      saveState: "conflict",
      serverContent: hero.content,
      localContent: DRAFT,
      conflict: {
        kind: "modified",
        remoteExists: true,
        remoteFileId: hero.id,
        remoteVersion: 5,
        remoteContent: remote.content,
      },
    });
  });

  it("a genuine server change to an opened public text file with a draft is a 'modified' conflict", () => {
    openPublicText();
    useThemeWorkspaceStore.getState().updateLocalContent(robots.path, "User-agent: mine\n", scope);
    const remote = { ...robots, version: 3, content: "User-agent: theirs\n" };
    openPublicText(remote);
    expect(workspaceFile(robots.path)).toMatchObject({
      saveState: "conflict",
      serverContent: robots.content,
      localContent: "User-agent: mine\n",
      conflict: { kind: "modified", remoteFileId: robots.id, remoteVersion: 3, remoteContent: remote.content },
    });
  });

  it("hydrateServerFile refuses an id minted for a local draft", () => {
    useThemeWorkspaceStore.getState().updateLocalContent(NEW_PATH, NEW_DRAFT, scope);
    const bannerBefore = workspaceFile(NEW_PATH);
    openPublicText({ ...robots, id: `${LOCAL_DRAFT_FILE_ID_PREFIX}${NEW_PATH}`, path: NEW_PATH, content: NEW_DRAFT, version: 1 });
    expect(workspaceFile(NEW_PATH)).toBe(bannerBefore);
  });
});

describe("hydrateFromQuery given the shell's draft-carrying list (defence)", () => {
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
    store.hydrateFromQuery(scope.storefrontId, scope.themeId, [hero], 9, [robots.path]);
  });

  it("refuses an entry under a minted local id: no 'created' conflict, the draft stays a create", () => {
    useThemeWorkspaceStore.getState().updateLocalContent(NEW_PATH, NEW_DRAFT, scope);
    hydrateWithShellList();
    const banner = workspaceFile(NEW_PATH)!;
    expect(banner.conflict).toBeUndefined();
    expect(banner).toMatchObject({ saveState: "dirty", serverExists: false, localContent: NEW_DRAFT });
    expect(themeFileWritePrecondition(banner)).toEqual({ expectMissing: true });

    // The next real server read, still without Banner, keeps the draft.
    useThemeWorkspaceStore.getState().hydrateFromQuery(scope.storefrontId, scope.themeId, [hero], 9, [robots.path]);
    expect(workspaceFile(NEW_PATH)?.localContent).toBe(NEW_DRAFT);
  });

  it("still hydrates the real server copies in the same list", () => {
    hydrateWithShellList();
    expect(workspaceFile(robots.path)).toMatchObject({ serverFileId: robots.id, serverContent: robots.content });
    expect(heroState()).toMatchObject({ saveState: "clean", serverFileId: hero.id, serverVersion: hero.version });
  });
});
