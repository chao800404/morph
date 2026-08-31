import { parse } from "@babel/parser";
import { parseThemeRouteSourcePath } from "@/lib/storefront/compiler/theme-route-registry";

/**
 * Moving a Theme file, with every reference to it brought along.
 *
 * A path in this project is not just a label: relative imports resolve through
 * it, the manifest names components by it, and a Document section records the
 * component it renders by it. Changing the path alone leaves a Theme that no
 * longer compiles, so a move is only meaningful as one edit across every file
 * that mentions it.
 *
 * Built on `@babel/parser` for the same reason the other Theme transforms are:
 * it runs unchanged in a Worker. TypeScript's own `getEditsForFileRename` would
 * answer this too, but it is not exposed by the editor's language worker and
 * bundling the compiler to reach it costs megabytes for one operation.
 */

export type ThemeSourceFile = { path: string; content: string };

export type ThemeFileMove = Readonly<{ from: string; to: string }>;

export type ThemeFileMoveResult =
  | Readonly<{
      ok: true;
      /** Files whose content changed, plus the moved files at their new paths. */
      writes: ThemeSourceFile[];
      /** Old paths that must be removed once the writes land. */
      deletions: string[];
      /** Every specifier that was rewritten, for the change description. */
      rewrites: ReadonlyArray<{ file: string; from: string; to: string }>;
    }>
  | Readonly<{ ok: false; reason: string }>;

/** Extensions a relative specifier may omit, in the order a bundler tries them. */
const IMPLICIT_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

function parseModule(source: string) {
  return parse(source, { sourceType: "module", plugins: ["jsx", "typescript"] });
}

/** Directory part of a path, without a trailing slash. */
export function directoryOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

/** Joins a directory and a relative specifier into a normalized path. */
export function resolveRelativePath(
  fromDirectory: string,
  specifier: string,
): string {
  const segments = fromDirectory ? fromDirectory.split("/") : [];
  for (const part of specifier.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return segments.join("/");
}

/**
 * The specifier that reaches `target` from a file in `fromDirectory`.
 *
 * Always relative and always explicit about staying local: a specifier that
 * came out as `components/Hero` would be read as a package, not a sibling
 * directory.
 */
export function relativeSpecifier(
  fromDirectory: string,
  target: string,
): string {
  const from = fromDirectory ? fromDirectory.split("/") : [];
  const to = target.split("/");
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) {
    shared += 1;
  }
  const up = from.length - shared;
  const rest = to.slice(shared);
  const prefix = up > 0 ? Array.from({ length: up }, () => "..") : ["."];
  return [...prefix, ...rest].join("/");
}

/** Strips the extension a specifier is allowed to omit. */
function withoutImplicitExtension(path: string): string {
  for (const extension of IMPLICIT_EXTENSIONS) {
    if (path.endsWith(extension)) return path.slice(0, -extension.length);
  }
  return path;
}

/** Which file a relative specifier points at, or null when it points nowhere. */
export function resolveSpecifierToFile(
  importerPath: string,
  specifier: string,
  paths: ReadonlySet<string>,
): string | null {
  if (!specifier.startsWith(".")) return null;
  const resolved = resolveRelativePath(directoryOf(importerPath), specifier);
  if (paths.has(resolved)) return resolved;
  for (const extension of IMPLICIT_EXTENSIONS) {
    if (paths.has(`${resolved}${extension}`)) return `${resolved}${extension}`;
  }
  // `./ui` may mean `./ui/index.tsx`, which a bundler resolves and a move must
  // therefore keep pointing at the same file.
  for (const extension of IMPLICIT_EXTENSIONS) {
    if (paths.has(`${resolved}/index${extension}`)) {
      return `${resolved}/index${extension}`;
    }
  }
  return null;
}

/** The manifest names components by their file path. */
const MANIFEST_PATH = "morph.theme.json";

/**
 * Repoints the manifest at the moved files.
 *
 * Done by replacing the exact quoted path rather than by parsing and
 * re-serialising: a round trip through `JSON.parse` would reformat a file the
 * Theme author wrote by hand, turning a one-line move into a whole-file diff.
 */
function rewriteManifestPaths(
  content: string,
  moves: ReadonlyMap<string, string>,
): string {
  let next = content;
  for (const [from, to] of moves) {
    next = next.split(JSON.stringify(from)).join(JSON.stringify(to));
  }
  return next;
}

type SpecifierSite = { value: string; start: number; end: number };

/** Every module specifier in a file, with the exact source range to replace. */
function readSpecifierSites(source: string): SpecifierSite[] {
  const sites: SpecifierSite[] = [];
  const ast = parseModule(source);

  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    const isStatic =
      (node.type === "ImportDeclaration" ||
        node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") &&
      node.source?.type === "StringLiteral";
    const isDynamic =
      node.type === "ImportExpression" &&
      node.source?.type === "StringLiteral";
    if (isStatic || isDynamic) {
      const literal = node.source;
      sites.push({
        value: literal.value,
        start: literal.start,
        end: literal.end,
      });
    }
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "comments") continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(ast);
  return sites.sort((left, right) => left.start - right.start);
}

/** Applies replacements to a source string from the end, so offsets stay valid. */
function replaceRanges(
  source: string,
  edits: ReadonlyArray<{ start: number; end: number; text: string }>,
): string {
  return [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (text, edit) =>
        text.slice(0, edit.start) + edit.text + text.slice(edit.end),
      source,
    );
}

/**
 * TanStack's generator rewrites a route file's createFileRoute literal when
 * its filename changes. Keep that invariant in Code Mode as well, otherwise
 * moving `routes/about.tsx` to `routes/company/about.tsx` leaves a stale route
 * id and TypeScript reports a type error until a build happens.
 */
export function rewriteThemeRouteFactoryPath(
  source: string,
  routeId: string,
): { content: string; changed: boolean } | { error: string } {
  const ast = parseModule(source);
  let routeArgument: { start: number; end: number; value: string } | null = null;
  let dynamicRouteArgument = false;

  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (
      !routeArgument &&
      node.type === "CallExpression" &&
      node.callee?.type === "Identifier" &&
      (node.callee.name === "createFileRoute" ||
        node.callee.name === "createLazyFileRoute")
    ) {
      const argument = node.arguments?.[0];
      if (
        argument?.type === "StringLiteral" ||
        (argument?.type === "TemplateLiteral" &&
          argument.expressions?.length === 0)
      ) {
        routeArgument = {
          start: argument.start,
          end: argument.end,
          value:
            argument.type === "StringLiteral"
              ? argument.value
              : argument.quasis?.[0]?.value?.cooked ?? "",
        };
      } else if (argument) {
        dynamicRouteArgument = true;
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "comments") continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(ast);

  if (dynamicRouteArgument && !routeArgument) {
    return {
      error:
        "Cannot move a route whose createFileRoute path is not a string literal.",
    };
  }
  const resolvedRouteArgument = routeArgument as {
    start: number;
    end: number;
    value: string;
  } | null;
  if (!resolvedRouteArgument || resolvedRouteArgument.value === routeId) {
    return { content: source, changed: false };
  }
  return {
    content: replaceRanges(source, [
      {
        start: resolvedRouteArgument.start,
        end: resolvedRouteArgument.end,
        text: JSON.stringify(routeId),
      },
    ]),
    changed: true,
  };
}

/**
 * Plans a move of one or more Theme files.
 *
 * Returns every file that has to be written and every old path that has to go,
 * so the caller can apply the whole thing as one transaction — a move that
 * lands halfway leaves a Theme that cannot build.
 */
export function planThemeFileMove(
  files: readonly ThemeSourceFile[],
  moves: readonly ThemeFileMove[],
): ThemeFileMoveResult {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const movesByFrom = new Map<string, string>();

  for (const move of moves) {
    if (!byPath.has(move.from)) {
      return { ok: false, reason: `"${move.from}" is not part of this Theme.` };
    }
    if (move.from === move.to) {
      return { ok: false, reason: `"${move.from}" is already at that path.` };
    }
    if (byPath.has(move.to)) {
      return { ok: false, reason: `"${move.to}" already exists.` };
    }
    if (movesByFrom.has(move.from)) {
      return { ok: false, reason: `"${move.from}" is moved twice.` };
    }
    movesByFrom.set(move.from, move.to);
  }
  if (movesByFrom.size === 0) return { ok: false, reason: "Nothing to move." };

  const destinations = new Set(movesByFrom.values());
  if (destinations.size !== movesByFrom.size) {
    return { ok: false, reason: "Two files would land on the same path." };
  }

  // Resolution happens against the paths as they are now; the rewrite then
  // describes where each of those files ends up.
  const currentPaths = new Set(byPath.keys());
  const finalPath = (path: string) => movesByFrom.get(path) ?? path;

  const writes: ThemeSourceFile[] = [];
  const rewrites: Array<{ file: string; from: string; to: string }> = [];

  for (const file of files) {
    const destination = finalPath(file.path);
    const isSource = /\.(tsx|ts|jsx|js)$/.test(file.path);
    let content = file.content;

    if (file.path === MANIFEST_PATH) {
      content = rewriteManifestPaths(content, movesByFrom);
    } else if (isSource) {
      const oldRouteMetadata = parseThemeRouteSourcePath(file.path);
      const newRouteMetadata = parseThemeRouteSourcePath(destination);
      if (
        oldRouteMetadata &&
        newRouteMetadata &&
        oldRouteMetadata.routeType !== "root" &&
        newRouteMetadata.routeType !== "root"
      ) {
        let routeRewrite: ReturnType<typeof rewriteThemeRouteFactoryPath>;
        try {
          routeRewrite = rewriteThemeRouteFactoryPath(
            content,
            newRouteMetadata.routeId,
          );
        } catch {
          return {
            ok: false,
            reason: `Cannot move: ${file.path} contains a syntax error.`,
          };
        }
        if ("error" in routeRewrite) {
          return { ok: false, reason: routeRewrite.error };
        }
        if (routeRewrite.changed) {
          rewrites.push({
            file: destination,
            from: oldRouteMetadata.routeId,
            to: newRouteMetadata.routeId,
          });
          content = routeRewrite.content;
        }
      }
      let sites: SpecifierSite[];
      try {
        sites = readSpecifierSites(content);
      } catch {
        return {
          ok: false,
          reason: `Cannot move: ${file.path} contains a syntax error.`,
        };
      }

      const edits: Array<{ start: number; end: number; text: string }> = [];
      for (const site of sites) {
        const target = resolveSpecifierToFile(
          file.path,
          site.value,
          currentPaths,
        );
        if (!target) continue;
        const nextTarget = finalPath(target);
        // Nothing moved on either end: the specifier already says what it means.
        if (nextTarget === target && destination === file.path) continue;

        const hadExtension = site.value !== withoutImplicitExtension(site.value);
        const specifier = relativeSpecifier(
          directoryOf(destination),
          hadExtension ? nextTarget : withoutImplicitExtension(nextTarget),
        );
        if (specifier === site.value) continue;
        edits.push({
          start: site.start,
          end: site.end,
          text: JSON.stringify(specifier),
        });
        rewrites.push({ file: destination, from: site.value, to: specifier });
      }
      if (edits.length > 0) content = replaceRanges(content, edits);
    }

    if (destination !== file.path || content !== file.content) {
      writes.push({ path: destination, content });
    }
  }

  return {
    ok: true,
    writes,
    deletions: Array.from(movesByFrom.keys()),
    rewrites,
  };
}

/**
 * The moves a drop represents.
 *
 * Dropping is a gesture; a move is a set of path changes. Working that out here
 * rather than in the tree keeps the rules — what may be dropped where, and what
 * a folder even is — testable without a pointer.
 */
export function planDropMoves(
  paths: readonly string[],
  draggedPath: string,
  targetFolder: string,
): ThemeFileMove[] {
  const normalizedTarget = targetFolder.replace(/\/+$/, "");
  const isFolder = !paths.includes(draggedPath);

  if (!isFolder) {
    const name = draggedPath.slice(draggedPath.lastIndexOf("/") + 1);
    const to = normalizedTarget ? `${normalizedTarget}/${name}` : name;
    return to === draggedPath ? [] : [{ from: draggedPath, to }];
  }

  // A folder cannot be dropped inside itself: every path under it would have to
  // move under a path that is itself moving, which has no stable answer.
  if (
    normalizedTarget === draggedPath ||
    normalizedTarget.startsWith(`${draggedPath}/`)
  ) {
    return [];
  }

  const folderName = draggedPath.slice(draggedPath.lastIndexOf("/") + 1);
  const destination = normalizedTarget
    ? `${normalizedTarget}/${folderName}`
    : folderName;
  if (destination === draggedPath) return [];

  return paths
    .filter((path) => path.startsWith(`${draggedPath}/`))
    .map((path) => ({
      from: path,
      to: `${destination}/${path.slice(draggedPath.length + 1)}`,
    }));
}
