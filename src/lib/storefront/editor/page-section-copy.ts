import { parse } from "@babel/parser";
import {
  readThemeFileImportTargets,
  resolveSpecifierToFile,
  rewriteThemeFileImportsForCopy,
} from "@/lib/storefront/ast/theme-file-move";
import { parseThemeRouteSourcePath } from "@/lib/storefront/compiler/theme-route-registry";
import { isValidThemeContentSlotId } from "@/lib/storefront/theme-content-slots";
import {
  THEME_PAGE_SECTION_FOLDER_PATH,
  THEME_SECTION_FOLDER_PATH,
} from "@/lib/storefront/theme-section-convention";
import { prepareNewThemeFile } from "./new-theme-file";

/**
 * Page-owned section copies.
 *
 * Every section a page renders is its own source: Add section copies the
 * template out of `src/components/sections/`, and a route only ever imports
 * the copy. That keeps the section library inert — editing a template changes
 * what the next Add section creates, never a page that is already live — and
 * lets Design mode change one page's structure and styles without reaching
 * any other.
 *
 * One placed instance owns one folder:
 *
 *   src/components/page-sections/<route key>/<slot id>/index.tsx
 *
 * Named by slot id because the Document already identifies the instance by
 * it; a second numbering scheme for files would be one more thing that could
 * disagree with the first. The route key is the route file's path in TanStack's
 * flat notation (`src/routes/products/$slug.tsx` → `products.$slug`), which is
 * one path segment, readable next to the routes tree, and collides only where
 * TanStack itself would reject the two route files as the same route.
 */

type SourceFile = Readonly<{ path: string; content: string; mimeType?: string }>;

/** Folder sections past this size are copied in Code mode, not by a click. */
const MAX_COPIED_FILES = 40;

/** Re-export hops followed before an entry is treated as the implementation. */
const MAX_REEXPORT_HOPS = 4;

const COPIED_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".css", ".json"];
const SCRIPT_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];
const ENTRY_EXTENSIONS = [".tsx", ".jsx"];

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

function directoryOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function extensionOf(path: string): string {
  const base = baseName(path);
  const index = base.lastIndexOf(".");
  return index <= 0 ? "" : base.slice(index).toLowerCase();
}

function isTestSource(path: string): boolean {
  return /\.(?:test|spec)\.[^./]+$/i.test(path);
}

function isScript(path: string): boolean {
  return SCRIPT_EXTENSIONS.includes(extensionOf(path));
}

/**
 * The directory a route's page-owned sections live in, or null for a path
 * that is not a page route.
 *
 * The root route is refused: what it renders is on every page, which is the
 * layout's job and stays shared.
 */
export function pageSectionRouteKey(routeSourcePath: string): string | null {
  const route = parseThemeRouteSourcePath(normalizePath(routeSourcePath));
  if (!route || route.routeType === "root") return null;
  const key = route.relativePath
    .replace(/\.[cm]?[jt]sx?$/, "")
    .split("/")
    .join(".");
  return key || null;
}

/** The folder one placed section instance owns. */
export function pageSectionInstanceRoot(
  routeSourcePath: string,
  slotId: string,
): string | null {
  if (!isValidThemeContentSlotId(slotId)) return null;
  const key = pageSectionRouteKey(routeSourcePath);
  return key ? `${THEME_PAGE_SECTION_FOLDER_PATH}/${key}/${slotId}` : null;
}

function hasFilesUnder(root: string, paths: Iterable<string>): boolean {
  const prefix = `${root}/`;
  for (const path of paths) {
    const normalized = normalizePath(path);
    if (normalized === root || normalized.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * The first slot id that is free both in the route and on disk.
 *
 * A folder left behind by something other than this editor — a hand-made
 * file, a copy whose removal kept it because it was still imported — is
 * skipped rather than written into, so a new section never inherits source
 * it did not create.
 */
export function choosePageSectionSlotId(args: {
  baseSlotId: string;
  usedSlotIds: ReadonlySet<string>;
  routeSourcePath: string;
  existingPaths: readonly string[];
}): string | null {
  const base = isValidThemeContentSlotId(args.baseSlotId)
    ? args.baseSlotId
    : "section";
  for (let suffix = 1; suffix <= 1000; suffix += 1) {
    const slotId = suffix === 1 ? base : `${base}-${suffix}`;
    if (args.usedSlotIds.has(slotId)) continue;
    const root = pageSectionInstanceRoot(args.routeSourcePath, slotId);
    if (!root) return null;
    if (hasFilesUnder(root, args.existingPaths)) continue;
    return slotId;
  }
  return null;
}

/**
 * The module a pure re-export entry forwards to, or null when the entry is
 * the implementation itself.
 *
 * `export { default, contentFields } from "../Hero"` is how a Theme can list
 * a component in the section folder without moving it. Copying that line
 * would give the page a copy that still renders the shared file, so the copy
 * is taken from where the line points instead. Only a file made of nothing
 * but re-exports of one local module qualifies; anything else is code the
 * author wrote on purpose.
 */
function readReexportTarget(
  path: string,
  content: string,
  paths: ReadonlySet<string>,
): string | null {
  let ast: any;
  try {
    ast = parse(content, { sourceType: "module", plugins: ["jsx", "typescript"] });
  } catch {
    return null;
  }
  const body: any[] = ast.program.body ?? [];
  if (body.length === 0) return null;
  let target: string | null = null;
  for (const statement of body) {
    const isReexport =
      (statement.type === "ExportNamedDeclaration" && statement.source) ||
      statement.type === "ExportAllDeclaration";
    if (!isReexport || statement.source?.type !== "StringLiteral") return null;
    const resolved = resolveSpecifierToFile(path, statement.source.value, paths);
    if (!resolved || (target !== null && resolved !== target)) return null;
    target = resolved;
  }
  return target;
}

function resolveImplementation(
  entryPath: string,
  byPath: ReadonlyMap<string, SourceFile>,
): string | null {
  const paths = new Set(byPath.keys());
  const visited = new Set<string>();
  let current = entryPath;
  for (let hop = 0; hop <= MAX_REEXPORT_HOPS; hop += 1) {
    if (visited.has(current)) return null;
    visited.add(current);
    const file = byPath.get(current);
    if (!file) return null;
    const next = readReexportTarget(current, file.content, paths);
    if (!next) return current;
    current = next;
  }
  return null;
}

/**
 * The folder a folder section is copied from, or null when copying it would
 * take more than the section.
 *
 * An `index.tsx` directly in `src/components/` would make the whole component
 * tree "the section", and one in a section library folder would copy every
 * template beside it.
 */
function folderSectionRoot(implementationPath: string): string | null {
  const root = directoryOf(implementationPath);
  const segments = root.split("/");
  if (segments.length < 3 || segments[0] !== "src" || segments[1] !== "components") {
    return null;
  }
  if (
    root === THEME_SECTION_FOLDER_PATH ||
    root === THEME_PAGE_SECTION_FOLDER_PATH ||
    directoryOf(root) === THEME_PAGE_SECTION_FOLDER_PATH
  ) {
    return null;
  }
  return root;
}

function isSectionSource(path: string): boolean {
  return (
    path.startsWith(`${THEME_SECTION_FOLDER_PATH}/`) ||
    path.startsWith(`${THEME_PAGE_SECTION_FOLDER_PATH}/`)
  );
}

export type PageSectionCopyFile = Readonly<{
  sourcePath: string;
  path: string;
  content: string;
  mimeType: string;
}>;

export type PageSectionCopyPlan =
  | Readonly<{
      ok: true;
      /** The folder the instance owns. */
      root: string;
      /** The file the route imports. */
      entryPath: string;
      /** Where the copied source came from, after following re-exports. */
      implementationPath: string;
      files: readonly PageSectionCopyFile[];
    }>
  | Readonly<{ ok: false; message: string }>;

/**
 * Plans the files one placed section instance owns.
 *
 * A single-file section becomes `<root>/index.tsx`; a folder section is copied
 * whole, so its private parts belong to the page too. Imports inside the copy
 * are pointed at the copy; imports of shared code (`ui/`, hooks, the content
 * contract) keep pointing at the shared file. A section that reaches into
 * another section is refused, because the copy would either drag a second
 * section along or keep rendering a template this page cannot own.
 */
export function planPageSectionCopy(args: {
  entryPath: string;
  routeSourcePath: string;
  slotId: string;
  files: readonly SourceFile[];
}): PageSectionCopyPlan {
  const root = pageSectionInstanceRoot(args.routeSourcePath, args.slotId);
  if (!root) {
    return {
      ok: false,
      message: "Sections can only be copied into a page route with a valid slot id.",
    };
  }
  const byPath = new Map(
    args.files.map((file) => [normalizePath(file.path), file] as const),
  );
  const paths = new Set(byPath.keys());
  if (hasFilesUnder(root, paths)) {
    return {
      ok: false,
      message: `${root} already contains files. Remove them in Code mode or choose another slot.`,
    };
  }

  const entryPath = normalizePath(args.entryPath);
  const implementationPath = resolveImplementation(entryPath, byPath);
  if (!implementationPath) {
    return {
      ok: false,
      message: `The section source ${entryPath} is unavailable or re-exports in a cycle.`,
    };
  }
  const implementationExtension = extensionOf(implementationPath);
  if (!ENTRY_EXTENSIONS.includes(implementationExtension)) {
    return {
      ok: false,
      message: `${implementationPath} does not render a component, so it cannot be copied as a section.`,
    };
  }

  const isFolder = /^index\.(?:tsx|jsx)$/i.test(baseName(implementationPath));
  let sources: string[];
  let targetFor: (sourcePath: string) => string;
  if (isFolder) {
    const sourceRoot = folderSectionRoot(implementationPath);
    if (!sourceRoot) {
      return {
        ok: false,
        message: `${implementationPath} is not inside a folder of its own, so its section cannot be copied safely.`,
      };
    }
    sources = [...paths]
      .filter(
        (path) =>
          path.startsWith(`${sourceRoot}/`) &&
          COPIED_EXTENSIONS.includes(extensionOf(path)) &&
          !isTestSource(path),
      )
      .sort();
    targetFor = (sourcePath) =>
      `${root}/${sourcePath.slice(sourceRoot.length + 1)}`;
  } else {
    sources = [implementationPath];
    targetFor = () => `${root}/index${implementationExtension}`;
  }
  if (sources.length > MAX_COPIED_FILES) {
    return {
      ok: false,
      message: `The section has ${sources.length} files; copy sections this large in Code mode.`,
    };
  }

  const pathMap = new Map(sources.map((source) => [source, targetFor(source)]));
  const workspace = [...byPath.values()].map((file) => ({
    path: normalizePath(file.path),
    content: file.content,
  }));
  const planned: PageSectionCopyFile[] = [];
  for (const sourcePath of sources) {
    const source = byPath.get(sourcePath)!;
    const targetPath = pathMap.get(sourcePath)!;

    if (isScript(sourcePath)) {
      const targets = readThemeFileImportTargets(sourcePath, source.content, paths);
      if (!targets) {
        return {
          ok: false,
          message: `${sourcePath} contains a syntax error. Fix it in Code mode before adding the section.`,
        };
      }
      for (const target of targets) {
        if (target.resolvedPath === null) {
          if (target.specifier.startsWith(".")) {
            return {
              ok: false,
              message: `${sourcePath} imports "${target.specifier}", which is not in the Theme. The copy would not build.`,
            };
          }
          if (/components\/(?:page-)?sections\//.test(target.specifier)) {
            return {
              ok: false,
              message: `${sourcePath} imports another section through "${target.specifier}". Move the shared part out of the section folders first.`,
            };
          }
          continue;
        }
        if (!pathMap.has(target.resolvedPath) && isSectionSource(target.resolvedPath)) {
          return {
            ok: false,
            message: `${sourcePath} imports ${target.resolvedPath}, which belongs to another section. Move the shared part out of the section folders first.`,
          };
        }
      }
    }

    const rewritten = isScript(sourcePath)
      ? rewriteThemeFileImportsForCopy({
          sourcePath,
          targetPath,
          content: source.content,
          files: workspace,
          pathMap,
        })
      : ({ ok: true, content: source.content } as const);
    if (!rewritten.ok) return { ok: false, message: rewritten.reason };

    const validated = prepareNewThemeFile(targetPath, [...paths]);
    if (!validated.ok) return { ok: false, message: validated.message };
    planned.push({
      sourcePath,
      path: targetPath,
      content: rewritten.content,
      mimeType: validated.mimeType,
    });
  }

  return {
    ok: true,
    root,
    entryPath: pathMap.get(implementationPath)!,
    implementationPath,
    files: planned,
  };
}

export type PageSectionRemovalPlan = Readonly<{
  /** Files removed together with the section. */
  paths: readonly string[];
  /** Why owned files were kept, when they were. */
  keptReason?: string;
}>;

/**
 * The files that go away with a removed section.
 *
 * Only the instance folder the removed slot owns on this route is eligible;
 * a section rendered from shared or hand-placed source loses its JSX and
 * nothing else. The folder is kept whole when anything outside it still
 * imports from it: deleting a file something imports would turn a removed
 * section into a failed build. `files` must already carry the edited route.
 */
export function planPageSectionRemoval(args: {
  componentSourcePath: string;
  routeSourcePath: string;
  slotId: string;
  files: readonly SourceFile[];
}): PageSectionRemovalPlan {
  const root = pageSectionInstanceRoot(args.routeSourcePath, args.slotId);
  const componentPath = normalizePath(args.componentSourcePath);
  if (!root || !componentPath.startsWith(`${root}/`)) return { paths: [] };

  const prefix = `${root}/`;
  const normalized = args.files.map((file) => ({
    ...file,
    path: normalizePath(file.path),
  }));
  const owned = normalized
    .filter((file) => file.path.startsWith(prefix))
    .map((file) => file.path)
    .sort();
  if (owned.length === 0) return { paths: [] };

  const ownedSet = new Set(owned);
  const paths = new Set(normalized.map((file) => file.path));
  const rootFromSrc = root.slice("src/".length);
  for (const file of normalized) {
    if (ownedSet.has(file.path) || !isScript(file.path)) continue;
    const targets = readThemeFileImportTargets(file.path, file.content, paths);
    // A file that does not parse cannot be read for imports. Keep the folder
    // whenever such a file so much as mentions the slot: leaving source behind
    // is recoverable, deleting what a build still needs is not.
    if (!targets) {
      if (file.content.includes(args.slotId)) {
        return {
          paths: [],
          keptReason: `${file.path} could not be parsed, so ${root} was kept in case it still imports it.`,
        };
      }
      continue;
    }
    const importer = targets.find(
      (target) =>
        (target.resolvedPath !== null && ownedSet.has(target.resolvedPath)) ||
        // An alias (`@/components/page-sections/...`) is not resolved here, so
        // it is matched on the folder name. `hero` must not match `hero-2`.
        (target.resolvedPath === null &&
          !target.specifier.startsWith(".") &&
          (target.specifier.endsWith(rootFromSrc) ||
            target.specifier.includes(`${rootFromSrc}/`))),
    );
    if (importer) {
      return {
        paths: [],
        keptReason: `${file.path} still imports from ${root}, so its files were kept.`,
      };
    }
  }
  return { paths: owned };
}
