import type { StorefrontThemeFileTreeNode } from "@/lib/storefront/dto/storefront-theme-file.dto";

/**
 * Folders explicitly created in the editor.
 *
 * A Theme is stored as a list of file paths, so a folder is only ever the
 * prefix that several of them share — there is nowhere to record an empty one.
 * Making a folder before its first file is still a reasonable thing to want, so
 * the editor keeps it in view. The local record is intentionally retained even
 * after a file arrives, so deleting that file does not unexpectedly remove the
 * folder the author created.
 */

/** Directory paths that already exist because a file lives under them. */
export function existingFolderPaths(
  paths: readonly string[],
): ReadonlySet<string> {
  const folders = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/");
    for (let depth = 1; depth < segments.length; depth += 1) {
      folders.add(segments.slice(0, depth).join("/"));
    }
  }
  return folders;
}

function insertFolder(
  nodes: StorefrontThemeFileTreeNode[],
  segments: readonly string[],
  prefix: string,
): StorefrontThemeFileTreeNode[] {
  const [head, ...rest] = segments;
  if (!head) return nodes;
  const path = prefix ? `${prefix}/${head}` : head;
  const existing = nodes.find(
    (node) => node.isDirectory && node.path === path,
  );

  if (existing) {
    return nodes.map((node) =>
      node === existing
        ? {
            ...node,
            children: insertFolder(node.children ?? [], rest, path),
          }
        : node,
    );
  }

  const created: StorefrontThemeFileTreeNode = {
    name: head,
    path,
    isDirectory: true,
    children: insertFolder([], rest, path),
  };
  // Folders before files, then alphabetical: the same order the server sends,
  // so a pending folder does not sit somewhere a real one never would.
  return [...nodes, created].sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

/** Returns the tree with every explicitly created folder present. */
export function withPendingFolders(
  tree: readonly StorefrontThemeFileTreeNode[],
  pending: readonly string[],
): StorefrontThemeFileTreeNode[] {
  return pending.reduce<StorefrontThemeFileTreeNode[]>(
    (nodes, folder) => insertFolder(nodes, folder.split("/"), ""),
    [...tree],
  );
}

/**
 * Returns the destination path for a folder dropped onto another folder.
 *
 * A folder move keeps the dragged folder's name, just like the explorer does
 * in VS Code. Invalid self/descendant drops are represented by `null` so the
 * caller can treat them as a no-op.
 */
export function folderMoveDestination(
  draggedPath: string,
  targetFolder: string,
): string | null {
  const source = draggedPath.replace(/\/+$/, "");
  const target = targetFolder.replace(/\/+$/, "");
  if (!source || source === target || target.startsWith(`${source}/`)) {
    return null;
  }
  const name = source.slice(source.lastIndexOf("/") + 1);
  const destination = target ? `${target}/${name}` : name;
  return destination === source ? null : destination;
}

/**
 * Updates explicit folder records after a folder move.
 *
 * The Theme backend only stores files, so these records are the editor's
 * source of truth for empty folders. Moving every matching prefix keeps an
 * empty folder and any explicitly created descendants in the new location.
 */
export function movePendingFolderPaths(
  pending: readonly string[],
  draggedPath: string,
  targetFolder: string,
): string[] {
  const destination = folderMoveDestination(draggedPath, targetFolder);
  if (!destination) return [...pending];
  const source = draggedPath.replace(/\/+$/, "");
  const next = pending.map((path) =>
    path === source || path.startsWith(`${source}/`)
      ? `${destination}${path.slice(source.length)}`
      : path,
  );
  return Array.from(new Set(next));
}

/** Removes a folder and all explicitly created descendants from Explorer state. */
export function removePendingFolderPaths(
  pending: readonly string[],
  folderPath: string,
): string[] {
  const folder = folderPath.replace(/\/+$/, "");
  return pending.filter(
    (path) => path !== folder && !path.startsWith(`${folder}/`),
  );
}

/** Where a workspace's pending folders are remembered between visits. */
export function pendingFolderStorageKey(
  storefrontId: string,
  themeId: string,
): string {
  return `morph:pending-folders:${storefrontId}:${themeId}`;
}

/**
 * Reads the explicitly created folders saved for a workspace.
 *
 * Kept in the browser rather than the database on purpose: an empty folder is
 * not part of the Theme — the build has nothing to do with it and publishing it
 * would mean nothing. It is explorer state for the person arranging files, so it
 * remains available when its last file is removed.
 */
export function readPendingFolders(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    // Private windows and cleared site data both land here; an editor that
    // cannot remember a folder still has to open.
    return [];
  }
}

export function writePendingFolders(key: string, folders: readonly string[]) {
  try {
    if (folders.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(folders));
  } catch {
    // Nothing to do: the folder still exists for this session.
  }
}
