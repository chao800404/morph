type ThemeCopySource = Readonly<{
  path: string;
  content: string;
  mimeType: string;
}>;

export type ThemeFileCopyPlan =
  | Readonly<{
      ok: true;
      files: readonly ThemeCopySource[];
      createdFolders: readonly string[];
    }>
  | Readonly<{ ok: false; reason: string }>;

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

function splitExtension(name: string): { stem: string; extension: string } {
  const index = name.lastIndexOf(".");
  if (index <= 0) return { stem: name, extension: "" };
  return { stem: name.slice(0, index), extension: name.slice(index) };
}

function availableName(
  name: string,
  destinationFolder: string,
  occupied: Set<string>,
): string {
  const direct = joinPath(destinationFolder, name);
  if (
    !occupied.has(direct) &&
    ![...occupied].some((p) => p.startsWith(`${direct}/`))
  ) {
    return name;
  }
  const { stem, extension } = splitExtension(name);
  for (let copy = 1; copy <= 1_000; copy += 1) {
    const suffix = copy === 1 ? "-copy" : `-copy-${copy}`;
    const candidate = `${stem}${suffix}${extension}`;
    const path = joinPath(destinationFolder, candidate);
    if (
      !occupied.has(path) &&
      ![...occupied].some((p) => p.startsWith(`${path}/`))
    ) {
      return candidate;
    }
  }
  return `${stem}-copy-${Date.now()}${extension}`;
}

function removeNestedSelections(paths: readonly string[]): string[] {
  const sorted = [...new Set(paths)].sort((a, b) => a.length - b.length);
  return sorted.filter(
    (path, index) =>
      !sorted.slice(0, index).some((parent) => path.startsWith(`${parent}/`)),
  );
}

/**
 * Plans Explorer copy/paste without touching the workspace.
 *
 * Every target is new and receives `expectMissing` at the server boundary. A
 * folder copy is expanded to its files so the existing atomic batch write can
 * preserve the virtual filesystem and OCC invariants.
 */
export function planThemeFileCopies(args: {
  files: readonly ThemeCopySource[];
  selectedPaths: readonly string[];
  destinationFolder: string;
  pendingFolders?: readonly string[];
}): ThemeFileCopyPlan {
  const sourceByPath = new Map(args.files.map((file) => [file.path, file]));
  const occupied = new Set([
    ...args.files.map((file) => file.path),
    ...(args.pendingFolders ?? []),
  ]);
  const selected = removeNestedSelections(args.selectedPaths);
  if (selected.length === 0) return { ok: false, reason: "Nothing is copied." };

  const writes: ThemeCopySource[] = [];
  const createdFolders = new Set<string>();
  for (const sourcePath of selected) {
    const sourceFile = sourceByPath.get(sourcePath);
    const sourceIsFolder =
      !sourceFile &&
      (args.files.some((file) => file.path.startsWith(`${sourcePath}/`)) ||
        (args.pendingFolders ?? []).some(
          (folder) =>
            folder === sourcePath || folder.startsWith(`${sourcePath}/`),
        ));
    if (!sourceFile && !sourceIsFolder) {
      return { ok: false, reason: `"${sourcePath}" is no longer available.` };
    }
    if (
      sourceIsFolder &&
      (args.destinationFolder === sourcePath ||
        args.destinationFolder.startsWith(`${sourcePath}/`))
    ) {
      return {
        ok: false,
        reason: "A folder cannot be copied inside itself.",
      };
    }

    const targetName = availableName(
      basename(sourcePath),
      args.destinationFolder,
      occupied,
    );
    const targetRoot = joinPath(args.destinationFolder, targetName);
    if (sourceFile) {
      const target = { ...sourceFile, path: targetRoot };
      writes.push(target);
      occupied.add(target.path);
      continue;
    }

    createdFolders.add(targetRoot);
    occupied.add(targetRoot);
    for (const file of args.files.filter((candidate) =>
      candidate.path.startsWith(`${sourcePath}/`),
    )) {
      const relative = file.path.slice(sourcePath.length + 1);
      const target = { ...file, path: `${targetRoot}/${relative}` };
      writes.push(target);
      occupied.add(target.path);
    }
    for (const folder of args.pendingFolders ?? []) {
      if (folder === sourcePath || folder.startsWith(`${sourcePath}/`)) {
        const relative = folder.slice(sourcePath.length).replace(/^\//, "");
        createdFolders.add(relative ? `${targetRoot}/${relative}` : targetRoot);
      }
    }
  }

  return { ok: true, files: writes, createdFolders: [...createdFolders] };
}
