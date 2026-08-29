import { describe, expect, it } from "vitest";

import type { StorefrontThemeFileTreeNode } from "@/lib/storefront/dto/storefront-theme-file.dto";
import {
  existingFolderPaths,
  folderMoveDestination,
  movePendingFolderPaths,
  pendingFolderStorageKey,
  readPendingFolders,
  removePendingFolderPaths,
  writePendingFolders,
  withPendingFolders,
} from "@/lib/storefront/editor/pending-theme-folders";

const tree: StorefrontThemeFileTreeNode[] = [
  {
    name: "src",
    path: "src",
    isDirectory: true,
    children: [
      {
        name: "components",
        path: "src/components",
        isDirectory: true,
        children: [
          { name: "Hero.tsx", path: "src/components/Hero.tsx", isDirectory: false },
        ],
      },
    ],
  },
];

describe("pending folders", () => {
  it("adds a folder inside one that already exists", () => {
    const next = withPendingFolders(tree, ["src/components/ui"]);
    const components = next[0].children?.[0];

    expect(components?.children?.map((node) => node.path)).toContain(
      "src/components/ui",
    );
  });

  it("creates every missing level of a nested path", () => {
    const next = withPendingFolders(tree, ["src/lib/utils/format"]);
    const lib = next[0].children?.find((node) => node.path === "src/lib");

    expect(lib?.children?.[0]?.path).toBe("src/lib/utils");
    expect(lib?.children?.[0]?.children?.[0]?.path).toBe("src/lib/utils/format");
  });

  it("keeps folders before files, as the server orders them", () => {
    const next = withPendingFolders(tree, ["src/components/ui"]);
    const children = next[0].children?.[0]?.children ?? [];

    expect(children[0]?.isDirectory).toBe(true);
    expect(children[1]?.isDirectory).toBe(false);
  });

  it("reads the folders that files already imply", () => {
    const folders = existingFolderPaths([
      "src/components/Hero.tsx",
      "morph.theme.json",
    ]);

    expect(Array.from(folders).sort()).toEqual(["src", "src/components"]);
  });

  it("keeps an explicitly created folder visible after its files disappear", () => {
    const treeAfterFileRemoval = withPendingFolders(tree, ["src/components/hello"]);
    const children = treeAfterFileRemoval[0]?.children?.[0]?.children ?? [];

    expect(children.map((node) => node.path)).toContain("src/components/hello");
  });

  it("moves explicit folder records with the folder", () => {
    expect(
      movePendingFolderPaths(
        ["src/components/hello", "src/components/hello/nested"],
        "src/components/hello",
        "src/components/ui",
      ),
    ).toEqual(["src/components/ui/hello", "src/components/ui/hello/nested"]);
  });

  it("removes a folder and its explicit descendants", () => {
    expect(
      removePendingFolderPaths(
        ["src/components/hello", "src/components/hello/nested", "src/components/other"],
        "src/components/hello",
      ),
    ).toEqual(["src/components/other"]);
  });

  it("rejects folder moves into itself and treats same-parent drops as no-ops", () => {
    expect(folderMoveDestination("src/components/hello", "src/components/hello")).toBeNull();
    expect(folderMoveDestination("src/components/hello", "src/components")).toBeNull();
    expect(folderMoveDestination("src/components/hello", "src/components/ui")).toBe(
      "src/components/ui/hello",
    );
  });
});

describe("remembering pending folders between visits", () => {
  const key = pendingFolderStorageKey("store-1", "theme-1");

  it("keeps them per workspace, so two themes do not share folders", () => {
    expect(key).not.toBe(pendingFolderStorageKey("store-1", "theme-2"));
  });

  it("writes and reads back what it was given", () => {
    writePendingFolders(key, ["src/components/ui"]);
    expect(readPendingFolders(key)).toEqual(["src/components/ui"]);
  });

  it("clears the entry rather than storing an empty list", () => {
    writePendingFolders(key, ["src/x"]);
    writePendingFolders(key, []);
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("survives a stored value that is not a list of folders", () => {
    // Cleared site data, another version's format, a private window: an editor
    // that cannot remember a folder still has to open.
    window.localStorage.setItem(key, '{"not":"an array"}');
    expect(readPendingFolders(key)).toEqual([]);
  });
});
