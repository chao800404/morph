import { parse } from "@babel/parser";
import { isValidThemeContentSlotId } from "@/lib/storefront/theme-content-slots";
import {
  listThemeSectionEntries,
  readThemePageSectionEntry,
} from "@/lib/storefront/theme-section-convention";
import {
  readComponentSourcePaths,
  resolveThemeContentCapabilitiesFromFiles,
} from "@/lib/storefront/theme-content-capability-resolver";
import type { StorefrontPageDocument } from "@/db/storefront.schema";

type ThemeSourceFile = Readonly<{ path: string; content?: string | null }>;

export type ThemeRouteSection = Readonly<{
  slotId: string;
  sectionType: string;
  componentRef: string;
  componentName: string;
  componentSourcePath: string;
  routeSourcePath: string;
  /**
   * Where a document-layout slot sits relative to the page content it wraps.
   *
   * Route sections leave this unset. The editor uses it to paint shared
   * Header/Footer-style roots before the preview iframe has reported its DOM.
   */
  layoutPlacement?: "before-page" | "after-page";
  /**
   * Set when the route imports this slot's component from a file the workspace
   * no longer has.
   *
   * Deleting a file is a real edit and stays allowed, but one deleted file used
   * to take every page down with it: the slot stopped resolving, the route
   * reported a diagnostic, and nothing rendered at all — including the panel
   * the author would use to put the file back. Marking the slot instead keeps
   * the failure the size of the thing that failed.
   */
  missingComponentSourcePath?: string;
}>;

export type ThemeRouteSectionResult = Readonly<{
  sections: readonly ThemeRouteSection[];
  /** Direct section candidates that render without the content contract yet. */
  unboundSections: readonly ThemeUnboundRouteSection[];
  diagnostics: readonly string[];
  /** True when the route imports the Theme content contract, even if it has no slots yet. */
  hasContentImport: boolean;
}>;

export type ThemeRouteSectionOption = Readonly<{
  componentRef: string;
  sectionType: string;
  componentName: string;
  componentSourcePath: string;
}>;

export type ThemeUnboundRouteSection = Readonly<{
  componentRef: string;
  sectionType: string;
  componentName: string;
  componentSourcePath: string;
  routeSourcePath: string;
  /** Stable source position used to patch exactly this JSX instance. */
  sourceLocation: string;
  sourceStart: number;
  sourceEnd: number;
  /** Only confirmed direct JSX positions may expose the bind action. */
  canBind: boolean;
  diagnostic?: string;
}>;

/**
 * Presents stored values through route-owned structure. Missing slots are
 * virtual until their first content edit; stale Document-only sections are not
 * rendered because the route no longer declares them.
 */
export function mergeDocumentWithRouteSections(
  document: StorefrontPageDocument,
  routeSections: readonly ThemeRouteSection[],
  options?: Readonly<{ routeOwnsStructure?: boolean }>,
): StorefrontPageDocument {
  // A route that declares no slots has not adopted route-owned structure, so
  // its stored sections stand. Returning nothing here would silently strip
  // every editable section from a Theme whose routes simply render components
  // directly — which is every Theme before it migrates.
  if (routeSections.length === 0 && !options?.routeOwnsStructure) {
    return document;
  }

  const storedById = new Map(
    document.sections.map((section) => [section.id, section] as const),
  );
  return {
    version: 1,
    sections: routeSections.map((routeSection) => {
      const stored = storedById.get(routeSection.slotId);
      return {
        id: routeSection.slotId,
        type: routeSection.sectionType,
        componentRef: routeSection.componentRef,
        // The route owns which slots exist and which component fills them; the
        // document owns everything the author put into one. A name is theirs,
        // so it survives a rebuild of the structure exactly as the props do.
        ...(stored?.name ? { name: stored.name } : {}),
        enabled: stored?.enabled !== false,
        props: stored?.props ?? {},
      };
    }),
  };
}

type PositionedSection = ThemeRouteSection &
  Readonly<{
    node: any;
    parent: any;
  }>;

const SOURCE_EXTENSIONS = ["", ".tsx", ".ts", ".jsx", ".js"] as const;

function normalizePath(path: string): string {
  const stack: string[] = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) return "";
      stack.pop();
    } else {
      stack.push(segment);
    }
  }
  return stack.join("/");
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
}

function resolveLocalImport(
  sourcePath: string,
  specifier: string,
  filePaths: ReadonlySet<string>,
): string | { missing: string } | null {
  if (!specifier.startsWith(".")) return null;
  const base = normalizePath(`${dirname(sourcePath)}/${specifier}`);
  if (!base.startsWith("src/")) return null;
  // Remembered before the file check so a relative import of a file that is
  // gone can be told apart from something that was never a local module.
  const localBase = base;
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (filePaths.has(candidate)) return candidate;
  }
  for (const extension of [
    "/index.tsx",
    "/index.ts",
    "/index.jsx",
    "/index.js",
  ] as const) {
    const candidate = `${base}${extension}`;
    if (filePaths.has(candidate)) return candidate;
  }
  return { missing: `${localBase}.tsx` };
}

function kebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function sectionTypeFromRef(
  componentRef: string,
  componentName: string,
): string {
  if (!componentRef.startsWith("src/")) {
    const prefix = componentRef.split(".")[0]?.trim();
    if (prefix) return prefix;
  }
  return kebabCase(componentName) || "section";
}

function readManifestContent(files: readonly ThemeSourceFile[]): string | null {
  const content = files.find(
    (file) => normalizePath(file.path) === "morph.theme.json",
  )?.content;
  return typeof content === "string" ? content : null;
}

function walkWithParent(
  node: unknown,
  parent: unknown,
  visit: (candidate: any, parent: any) => void,
): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkWithParent(item, parent, visit);
    return;
  }
  const candidate = node as Record<string, unknown>;
  visit(candidate, parent);
  for (const [key, value] of Object.entries(candidate)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    walkWithParent(value, candidate, visit);
  }
}

function readSlotId(node: any): string | null {
  if (node?.type !== "JSXElement") return null;
  for (const attribute of node.openingElement?.attributes ?? []) {
    const call =
      attribute?.type === "JSXSpreadAttribute" ? attribute.argument : null;
    if (
      call?.type !== "CallExpression" ||
      call.callee?.type !== "Identifier" ||
      call.callee.name !== "content"
    ) {
      continue;
    }
    const argument = call.arguments?.[0];
    if (
      argument?.type === "StringLiteral" &&
      isValidThemeContentSlotId(argument.value)
    ) {
      return argument.value;
    }
  }
  return null;
}

function jsxIdentifier(node: any): string | null {
  const name = node?.openingElement?.name;
  return name?.type === "JSXIdentifier" ? name.name : null;
}

function sourceLocationFor(routeSourcePath: string, node: any): string | null {
  const line = node?.loc?.start?.line;
  const column = node?.loc?.start?.column;
  return typeof line === "number" && typeof column === "number"
    ? `${routeSourcePath}:${line}:${column + 1}`
    : null;
}

function hasContentSpread(node: any): boolean {
  return (node?.openingElement?.attributes ?? []).some(
    (attribute: any) =>
      attribute?.type === "JSXSpreadAttribute" &&
      attribute.argument?.type === "CallExpression" &&
      attribute.argument.callee?.type === "Identifier" &&
      attribute.argument.callee.name === "content",
  );
}

function isDirectSectionPosition(parent: any): boolean {
  if (parent?.type === "JSXElement" || parent?.type === "JSXFragment") {
    return true;
  }
  // A route may return one section as its complete JSX tree. A conditional,
  // map callback, or arbitrary expression is intentionally not accepted: one
  // source position could then represent zero or many rendered instances.
  return parent?.type === "ReturnStatement";
}

function parsePositionedSections(
  files: readonly ThemeSourceFile[],
  routeSourcePath: string,
): {
  sections: PositionedSection[];
  unboundSections: ThemeUnboundRouteSection[];
  diagnostics: string[];
  ast: any | null;
  hasContentImport: boolean;
} {
  const normalizedRoutePath = normalizePath(routeSourcePath);
  const routeFile = files.find(
    (file) => normalizePath(file.path) === normalizedRoutePath,
  );
  if (typeof routeFile?.content !== "string") {
    return {
      sections: [],
      unboundSections: [],
      diagnostics: [`Theme route "${normalizedRoutePath}" is unavailable.`],
      ast: null,
      hasContentImport: false,
    };
  }

  let ast: any;
  try {
    ast = parse(routeFile.content, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch (error) {
    return {
      sections: [],
      unboundSections: [],
      diagnostics: [
        `${normalizedRoutePath}: ${error instanceof Error ? error.message : "Invalid route source"}`,
      ],
      ast: null,
      hasContentImport: false,
    };
  }

  const filePaths = new Set(files.map((file) => normalizePath(file.path)));
  const imports = new Map<
    string,
    { imported: string; sourcePath: string; missing?: string }
  >();
  for (const statement of ast.program.body ?? []) {
    if (statement?.type !== "ImportDeclaration") continue;
    const resolved = resolveLocalImport(
      normalizedRoutePath,
      statement.source?.value ?? "",
      filePaths,
    );
    if (!resolved) continue;
    const missing = typeof resolved === "string" ? undefined : resolved.missing;
    const sourcePath =
      typeof resolved === "string" ? resolved : resolved.missing;
    for (const specifier of statement.specifiers ?? []) {
      if (specifier?.local?.type !== "Identifier") continue;
      const imported =
        specifier.type === "ImportDefaultSpecifier"
          ? "default"
          : (specifier.imported?.name ?? specifier.imported?.value);
      if (typeof imported === "string") {
        imports.set(specifier.local.name, { imported, sourcePath, missing });
      }
    }
  }

  const manifestSources = readComponentSourcePaths(readManifestContent(files));
  const refsBySource = new Map<string, string[]>();
  for (const [componentRef, sourcePath] of manifestSources) {
    const normalized = normalizePath(sourcePath);
    refsBySource.set(normalized, [
      ...(refsBySource.get(normalized) ?? []),
      componentRef,
    ]);
  }

  const diagnostics: string[] = [];
  const sections: PositionedSection[] = [];
  const hasContentImport = Array.from(imports.values()).some(
    ({ imported, sourcePath }) =>
      imported === "content" &&
      normalizePath(sourcePath) === "src/morph/content.ts",
  );
  const seenSlots = new Set<string>();
  walkWithParent(ast.program, null, (node, parent) => {
    const slotId = readSlotId(node);
    if (!slotId) return;
    const componentName = jsxIdentifier(node);
    const imported = componentName ? imports.get(componentName) : null;
    if (!componentName || !imported) {
      diagnostics.push(
        `${normalizedRoutePath}: content slot "${slotId}" must feed a directly imported local component.`,
      );
      return;
    }
    // The slot is wired correctly; the file it points at is simply not here.
    // That is a deletion the author can undo, so it is carried as a marked
    // section rather than a diagnostic that blanks the page they would undo it
    // from.
    if (imported.missing) {
      seenSlots.add(slotId);
      sections.push({
        slotId,
        sectionType: kebabCase(componentName),
        componentRef: imported.missing,
        componentName,
        componentSourcePath: imported.missing,
        routeSourcePath: normalizedRoutePath,
        missingComponentSourcePath: imported.missing,
        node,
        parent,
      });
      return;
    }
    if (seenSlots.has(slotId)) {
      diagnostics.push(
        `${normalizedRoutePath}: duplicate content slot "${slotId}".`,
      );
      return;
    }
    seenSlots.add(slotId);
    const refs = refsBySource.get(imported.sourcePath) ?? [];
    const componentRef =
      refs.length === 1
        ? refs[0]!
        : (refs.find((ref) =>
            imported.imported === "default"
              ? ref.endsWith(".default")
              : ref.endsWith(`.${imported.imported}`),
          ) ?? imported.sourcePath);
    sections.push({
      slotId,
      sectionType: sectionTypeFromRef(componentRef, componentName),
      componentRef,
      componentName,
      componentSourcePath: imported.sourcePath,
      routeSourcePath: normalizedRoutePath,
      node,
      parent,
    });
  });

  const addableBySource = new Map(
    listBindableSectionOptions(files).map(
      (option) => [normalizePath(option.componentSourcePath), option] as const,
    ),
  );
  const unboundSections: ThemeUnboundRouteSection[] = [];
  walkWithParent(ast.program, null, (node, parent) => {
    if (node?.type !== "JSXElement") return;
    const componentName = jsxIdentifier(node);
    if (!componentName) return;
    const imported = imports.get(componentName);
    if (!imported || imported.missing) return;
    const option = addableBySource.get(normalizePath(imported.sourcePath));
    if (!option || readSlotId(node)) return;
    const sourceStart = node.start;
    const sourceEnd = node.end;
    const sourceLocation = sourceLocationFor(normalizedRoutePath, node);
    if (
      typeof sourceStart !== "number" ||
      typeof sourceEnd !== "number" ||
      !sourceLocation
    ) {
      return;
    }
    const hasInvalidBinding = hasContentSpread(node);
    const canBind = !hasInvalidBinding && isDirectSectionPosition(parent);
    unboundSections.push({
      componentRef: option.componentRef,
      sectionType: option.sectionType,
      componentName,
      componentSourcePath: normalizePath(imported.sourcePath),
      routeSourcePath: normalizedRoutePath,
      sourceLocation,
      sourceStart,
      sourceEnd,
      canBind,
      ...(hasInvalidBinding
        ? {
            diagnostic:
              "This component already has an invalid content binding and must be repaired in Code mode.",
          }
        : !isDirectSectionPosition(parent)
          ? {
              diagnostic:
                "This component is rendered inside a conditional or repeated expression and cannot be bound to one section instance.",
            }
          : {}),
    });
  });

  return { sections, unboundSections, diagnostics, ast, hasContentImport };
}

/**
 * Derives section identity and order from the route's rendered JSX. The
 * Document is deliberately absent: it supplies values, never structure.
 */
export function deriveThemeRouteSections(
  files: readonly ThemeSourceFile[],
  routeSourcePath: string,
): ThemeRouteSectionResult {
  const parsed = parsePositionedSections(files, routeSourcePath);
  return {
    sections: parsed.sections.map(
      ({ node: _node, parent: _parent, ...section }) => section,
    ),
    unboundSections: parsed.unboundSections,
    diagnostics: parsed.diagnostics,
    hasContentImport: parsed.hasContentImport,
  };
}

/**
 * Path of the shell every route renders inside, as the manifest declares it.
 *
 * Read here rather than imported from the AST transformer so this module keeps
 * its single dependency on a file list.
 */
function deriveDocumentLayoutPathFromRoute(
  files: readonly ThemeSourceFile[],
): string | null {
  const routeFile = files.find((file) => {
    const path = normalizePath(file.path);
    return /^src\/routes\/__root\.(?:tsx|jsx|ts|js)$/.test(path);
  });
  if (typeof routeFile?.content !== "string") return null;

  let ast: any;
  try {
    ast = parse(routeFile.content, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch {
    return null;
  }

  const filePaths = new Set(files.map((file) => normalizePath(file.path)));
  const layoutImports = new Map<string, string>();
  for (const statement of ast.program.body ?? []) {
    if (statement?.type !== "ImportDeclaration") continue;
    const resolved = resolveLocalImport(
      normalizePath(routeFile.path),
      statement.source?.value ?? "",
      filePaths,
    );
    if (typeof resolved !== "string" || !resolved.startsWith("src/layouts/")) {
      continue;
    }
    for (const specifier of statement.specifiers ?? []) {
      if (specifier?.local?.type === "Identifier") {
        layoutImports.set(specifier.local.name, resolved);
      }
    }
  }

  const candidates = new Set<string>();
  walkWithParent(ast.program, null, (node) => {
    const componentName = jsxIdentifier(node);
    if (!componentName) return;
    const sourcePath = layoutImports.get(componentName);
    if (!sourcePath) return;

    let containsPageOutlet = false;
    walkWithParent(node.children ?? [], node, (descendant) => {
      if (
        descendant?.type === "JSXElement" &&
        jsxIdentifier(descendant) === "Outlet"
      ) {
        containsPageOutlet = true;
      }
    });
    if (containsPageOutlet) candidates.add(sourcePath);
  });

  return candidates.size === 1 ? [...candidates][0]! : null;
}

/**
 * Derives the page shell from the authored root route when the legacy
 * manifest is absent. A shell is accepted only when the root route imports a
 * local `src/layouts/*` component that contains the page `Outlet`; ambiguous
 * layouts intentionally return null so callers can fail closed.
 */
export function deriveThemeDocumentLayoutPath(
  files: readonly ThemeSourceFile[],
): string | null {
  const derived = deriveDocumentLayoutPathFromRoute(files);
  if (derived) return derived;

  const manifest = readManifestContent(files);
  if (!manifest) return null;
  try {
    const parsed: unknown = JSON.parse(manifest);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const documentLayout = (parsed as Record<string, unknown>).documentLayout;
    if (
      !documentLayout ||
      typeof documentLayout !== "object" ||
      Array.isArray(documentLayout)
    ) {
      return null;
    }
    const source = (documentLayout as Record<string, unknown>).source;
    if (typeof source !== "string" || source.trim() === "") return null;
    const normalized = normalizePath(source);
    return files.some((file) => normalizePath(file.path) === normalized)
      ? normalized
      : null;
  } catch {
    return null;
  }
}

function readDocumentLayoutPath(
  files: readonly ThemeSourceFile[],
): string | null {
  return deriveThemeDocumentLayoutPath(files);
}

function readLayoutPageBoundary(
  ast: any,
  sections: readonly PositionedSection[],
): number | null {
  const candidates: number[] = [];
  walkWithParent(ast, null, (candidate) => {
    if (typeof candidate?.start !== "number") return;
    const expression =
      candidate.type === "JSXExpressionContainer" ? candidate.expression : null;
    const isChildrenIdentifier =
      expression?.type === "Identifier" && expression.name === "children";
    const isChildrenMember =
      expression?.type === "MemberExpression" &&
      !expression.computed &&
      expression.property?.type === "Identifier" &&
      expression.property.name === "children";
    const isOutlet =
      candidate.type === "JSXElement" && jsxIdentifier(candidate) === "Outlet";
    if (!isChildrenIdentifier && !isChildrenMember && !isOutlet) return;
    candidates.push(candidate.start);
  });
  if (candidates.length === 0 || sections.length === 0) return null;
  const starts = sections
    .map((section) => section.node?.start)
    .filter((value): value is number => typeof value === "number");
  const ends = sections
    .map((section) => section.node?.end)
    .filter((value): value is number => typeof value === "number");
  if (starts.length === 0 || ends.length === 0) return candidates[0] ?? null;
  const firstSection = Math.min(...starts);
  const lastSection = Math.max(...ends);
  // A file may define a helper component that also renders `{children}`.
  // Prefer the page placeholder among the layout slots; otherwise choose the
  // candidate nearest that range rather than the first one in the file.
  const withinSlots = candidates.filter(
    (position) => position > firstSection && position < lastSection,
  );
  if (withinSlots.length > 0) return withinSlots[0] ?? null;
  return candidates.reduce((nearest, position) => {
    const distance =
      position < firstSection
        ? firstSection - position
        : position > lastSection
          ? position - lastSection
          : 0;
    const nearestDistance =
      nearest < firstSection
        ? firstSection - nearest
        : nearest > lastSection
          ? nearest - lastSection
          : 0;
    return distance < nearestDistance ? position : nearest;
  });
}

/**
 * Sections the layout shell declares, which every route renders.
 *
 * Structurally identical to a route's sections — the same `content("slot")`
 * call, read out of a different file — because a header is a section that
 * happens to be on every page. Keeping the two derivations one function is
 * what lets the header be edited, stored, published and served by exactly the
 * machinery a section already uses.
 */
export function deriveThemeLayoutSections(
  files: readonly ThemeSourceFile[],
): ThemeRouteSectionResult {
  const layoutPath = readDocumentLayoutPath(files);
  if (!layoutPath) {
    return {
      sections: [],
      unboundSections: [],
      diagnostics: [],
      hasContentImport: false,
    };
  }
  const parsed = parsePositionedSections(files, layoutPath);
  const pageBoundary = readLayoutPageBoundary(parsed.ast, parsed.sections);
  return {
    sections: parsed.sections.map(({ node, parent: _parent, ...section }) => ({
      ...section,
      layoutPlacement:
        pageBoundary !== null &&
        typeof node?.start === "number" &&
        node.start > pageBoundary
          ? "after-page"
          : "before-page",
    })),
    unboundSections: parsed.unboundSections,
    diagnostics: parsed.diagnostics,
    hasContentImport: parsed.hasContentImport,
  };
}

/** Components the route author may add as editable sections. */
/**
 * Components that exist only to render one row of a repeated field.
 *
 * A row component expects its identity and values from the list that renders
 * it, so offering it as a standalone section would produce a section whose
 * component can never be given what it needs.
 */
function readRowComponentPaths(
  files: readonly ThemeSourceFile[],
): ReadonlySet<string> {
  const rowPaths = new Set<string>();
  const { capabilities } = resolveThemeContentCapabilitiesFromFiles(files);
  for (const [componentRef, capability] of Object.entries(capabilities)) {
    if (!componentRef.startsWith("src/")) continue;
    for (const definition of Object.values(capability.fields)) {
      if (definition.type !== "array" || !definition.of) continue;
      const resolved = resolveRelativeComponentPath(
        componentRef,
        definition.of,
      );
      if (resolved) rowPaths.add(resolved);
    }
  }
  return rowPaths;
}

/** Resolves a relative `of` specifier to a workspace path. */
function resolveRelativeComponentPath(
  declaringPath: string,
  specifier: string,
): string | null {
  const base = declaringPath.slice(0, declaringPath.lastIndexOf("/"));
  const parts: string[] = [];
  for (const segment of `${base}/${specifier}`.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  const path = parts.join("/");
  return path.startsWith("src/") ? path : null;
}

export function listThemeRouteSectionOptions(
  files: readonly ThemeSourceFile[],
): readonly ThemeRouteSectionOption[] {
  const rowComponents = readRowComponentPaths(files);
  // Add section is deliberately driven by the source folder convention. The
  // manifest still participates in capability resolution above so existing
  // route slots and legacy content fields keep working, but a component must
  // opt into the Add section library by living at a recognized section entry.
  return listThemeSectionEntries(files)
    .map((entry) => ({
      componentRef: entry.componentRef,
      sectionType: entry.sectionType,
      componentName: entry.componentName,
      componentSourcePath: entry.componentSourcePath,
    }))
    .filter(
      (option) =>
        !rowComponents.has(option.componentSourcePath) &&
        !rowComponents.has(
          option.componentSourcePath.replace(/\.(tsx|jsx)$/, ""),
        ),
    )
    .sort((left, right) => left.sectionType.localeCompare(right.sectionType));
}

/**
 * Components a route may render as a section without being offered by Add
 * section: the library, plus page-owned copies.
 *
 * A copy is never a candidate to add — it already belongs to one page — but a
 * route can render one without `content(...)`, most often after the binding
 * was removed in Code mode. It is still a section, and it has to show up under
 * "Sections needing binding" rather than disappear from the editor.
 */
function listBindableSectionOptions(
  files: readonly ThemeSourceFile[],
): readonly ThemeRouteSectionOption[] {
  const rowComponents = readRowComponentPaths(files);
  const pageCopies = files
    .map((file) => readThemePageSectionEntry(file.path))
    .filter((entry) => entry !== null)
    .filter(
      (entry) =>
        !rowComponents.has(entry.componentSourcePath) &&
        !rowComponents.has(
          entry.componentSourcePath.replace(/\.(tsx|jsx)$/, ""),
        ),
    )
    .map((entry) => ({
      componentRef: entry.componentRef,
      sectionType: entry.sectionType,
      componentName: entry.componentName,
      componentSourcePath: entry.componentSourcePath,
    }));
  return [...listThemeRouteSectionOptions(files), ...pageCopies];
}

function replaceRange(
  source: string,
  start: number,
  end: number,
  replacement: string,
): string {
  return source.slice(0, start) + replacement + source.slice(end);
}

function replaceRanges(
  source: string,
  ranges: readonly Readonly<{
    start: number;
    end: number;
    replacement: string;
  }>[],
): string {
  return [...ranges]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, range) =>
        replaceRange(current, range.start, range.end, range.replacement),
      source,
    );
}

/**
 * Forks one route section onto a sibling component file without changing the
 * shared component definition. When the route uses the imported component more
 * than once, only the selected JSX instance receives a fresh local binding.
 */
export function replaceThemeRouteSectionComponent(args: {
  source: string;
  files: readonly ThemeSourceFile[];
  routeSourcePath: string;
  slotId: string;
  componentSourcePath: string;
  nextComponentSourcePath: string;
}): { code: string; changed: boolean; diagnostic?: string } {
  const normalizedRoutePath = normalizePath(args.routeSourcePath);
  const normalizedSourcePath = normalizePath(args.componentSourcePath);
  const normalizedNextPath = normalizePath(args.nextComponentSourcePath);
  if (
    !normalizedSourcePath ||
    !normalizedNextPath ||
    normalizedSourcePath === normalizedNextPath
  ) {
    return {
      code: args.source,
      changed: false,
      diagnostic: "The page-specific component path is invalid.",
    };
  }

  const sourceFiles = args.files.map((file) =>
    normalizePath(file.path) === normalizedRoutePath
      ? { ...file, content: args.source }
      : file,
  );
  const parsed = parsePositionedSections(sourceFiles, normalizedRoutePath);
  if (parsed.diagnostics.length > 0 || !parsed.ast) {
    return {
      code: args.source,
      changed: false,
      diagnostic: parsed.diagnostics[0] ?? "Invalid route source.",
    };
  }

  const section = parsed.sections.find(
    (candidate) => candidate.slotId === args.slotId,
  );
  if (!section) {
    return {
      code: args.source,
      changed: false,
      diagnostic: `Section "${args.slotId}" no longer exists in the route source.`,
    };
  }
  if (normalizePath(section.componentSourcePath) !== normalizedSourcePath) {
    return {
      code: args.source,
      changed: false,
      diagnostic:
        "The section component changed since it was selected. Refresh the preview and try again.",
    };
  }

  const filePaths = new Set(sourceFiles.map((file) => normalizePath(file.path)));
  const declaration = (parsed.ast.program.body ?? []).find(
    (statement: any) =>
      statement?.type === "ImportDeclaration" &&
      resolveLocalImport(
        normalizedRoutePath,
        statement.source?.value ?? "",
        filePaths,
      ) === normalizedSourcePath &&
      statement.specifiers?.some(
        (specifier: any) => specifier.local?.name === section.componentName,
      ),
  );
  const specifier = declaration?.specifiers?.find(
    (candidate: any) => candidate.local?.name === section.componentName,
  );
  if (!declaration || !specifier) {
    return {
      code: args.source,
      changed: false,
      diagnostic:
        "The section import cannot be located safely. Edit the route in Code mode.",
    };
  }
  if (specifier.type === "ImportNamespaceSpecifier") {
    return {
      code: args.source,
      changed: false,
      diagnostic:
        "Namespace-imported sections must be detached in Code mode.",
    };
  }

  const usages: any[] = [];
  walkWithParent(parsed.ast.program, null, (node) => {
    if (
      node?.type === "JSXElement" &&
      node.openingElement?.name?.type === "JSXIdentifier" &&
      node.openingElement.name.name === section.componentName
    ) {
      usages.push(node);
    }
  });
  const target = usages.find(
    (node) => node.start === section.node.start && node.end === section.node.end,
  );
  if (!target || usages.length === 0) {
    return {
      code: args.source,
      changed: false,
      diagnostic:
        "The selected section instance cannot be located uniquely in the route source.",
    };
  }

  const nextImport = relativeImport(normalizedRoutePath, normalizedNextPath);
  if (usages.length === 1) {
    if (
      typeof declaration.source?.start !== "number" ||
      typeof declaration.source?.end !== "number"
    ) {
      return {
        code: args.source,
        changed: false,
        diagnostic: "The section import source range is unavailable.",
      };
    }
    return {
      code: replaceRange(
        args.source,
        declaration.source.start,
        declaration.source.end,
        JSON.stringify(nextImport),
      ),
      changed: true,
    };
  }

  const usedNames = new Set<string>();
  walkWithParent(parsed.ast.program, null, (node) => {
    if (node?.type === "Identifier" && typeof node.name === "string") {
      usedNames.add(node.name);
    }
  });
  let nextLocalName = `${section.componentName}PageCopy`;
  let suffix = 2;
  while (usedNames.has(nextLocalName)) {
    nextLocalName = `${section.componentName}PageCopy${suffix}`;
    suffix += 1;
  }

  const importedName =
    specifier.type === "ImportDefaultSpecifier"
      ? null
      : (specifier.imported?.name ?? specifier.imported?.value);
  if (
    typeof importedName !== "string" &&
    importedName !== null
  ) {
    return {
      code: args.source,
      changed: false,
      diagnostic:
        "This section import shape cannot be detached safely in Design mode.",
    };
  }

  const importStatement =
    importedName === null
      ? `import ${nextLocalName} from ${JSON.stringify(nextImport)};`
      : `import { ${importedName} as ${nextLocalName} } from ${JSON.stringify(nextImport)};`;
  const ranges: {
    start: number;
    end: number;
    replacement: string;
  }[] = [
    {
      start: declaration.end,
      end: declaration.end,
      replacement: `\n${importStatement}`,
    },
  ];
  if (
    typeof target.openingElement?.name?.start !== "number" ||
    typeof target.openingElement?.name?.end !== "number"
  ) {
    return {
      code: args.source,
      changed: false,
      diagnostic: "The selected section tag range is unavailable.",
    };
  }
  ranges.push({
    start: target.openingElement.name.start,
    end: target.openingElement.name.end,
    replacement: nextLocalName,
  });
  if (
    target.closingElement?.name &&
    typeof target.closingElement.name.start === "number" &&
    typeof target.closingElement.name.end === "number"
  ) {
    ranges.push({
      start: target.closingElement.name.start,
      end: target.closingElement.name.end,
      replacement: nextLocalName,
    });
  }
  return {
    code: replaceRanges(args.source, ranges),
    changed: true,
  };
}

/** Reorders direct sibling route sections without touching their source. */
export function reorderThemeRouteSections(
  source: string,
  files: readonly ThemeSourceFile[],
  routeSourcePath: string,
  orderedSlotIds: readonly string[],
): { code: string; changed: boolean; diagnostic?: string } {
  const sourceFiles = files.map((file) =>
    normalizePath(file.path) === normalizePath(routeSourcePath)
      ? { ...file, content: source }
      : file,
  );
  const parsed = parsePositionedSections(sourceFiles, routeSourcePath);
  const currentIds = parsed.sections.map((section) => section.slotId);
  if (
    currentIds.length !== orderedSlotIds.length ||
    new Set(currentIds).size !== currentIds.length ||
    // Without this a repeated id passes every other check and the section it
    // displaced is written out of the route entirely — a silent deletion, not
    // a failed reorder.
    new Set(orderedSlotIds).size !== orderedSlotIds.length ||
    orderedSlotIds.some((id) => !currentIds.includes(id))
  ) {
    return {
      code: source,
      changed: false,
      diagnostic: "Section order no longer matches the current route source.",
    };
  }
  if (currentIds.every((id, index) => id === orderedSlotIds[index])) {
    return { code: source, changed: false };
  }
  const parentOf = buildParentMap(parsed.ast);
  const movable = new Map(
    parsed.sections.map((section) => [
      section.slotId,
      resolveMovableSection(section, parentOf),
    ]),
  );
  const parent = movable.get(parsed.sections[0]!.slotId)?.parent;
  if (
    !parent ||
    parent.type !== "JSXElement" ||
    parsed.sections.some(
      (section) => movable.get(section.slotId)?.parent !== parent,
    )
  ) {
    return {
      code: source,
      changed: false,
      diagnostic:
        "Only section components that are direct JSX siblings can be reordered.",
    };
  }
  const sorted = [...parsed.sections]
    .map((section) => ({
      slotId: section.slotId,
      node: movable.get(section.slotId)!.node,
    }))
    .sort((a, b) => a.node.start - b.node.start);
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const between = source.slice(
      sorted[index]!.node.end,
      sorted[index + 1]!.node.start,
    );
    if (!/^\s*$/.test(between)) {
      return {
        code: source,
        changed: false,
        diagnostic:
          "Comments or expressions between route sections must be moved in Code mode.",
      };
    }
  }
  const separator =
    sorted.length > 1
      ? source.slice(sorted[0]!.node.end, sorted[1]!.node.start)
      : "\n";
  const snippets = new Map(
    sorted.map((section) => [
      section.slotId,
      source.slice(section.node.start, section.node.end),
    ]),
  );
  const replacement = orderedSlotIds
    .map((id) => snippets.get(id)!)
    .join(separator);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  return {
    code: replaceRange(source, first.node.start, last.node.end, replacement),
    changed: true,
  };
}

/**
 * The node that actually moves when a section is reordered.
 *
 * A section is rarely a bare child of its parent element. The editor writes
 * visibility as a guard around it — `{!isSectionHidden("id") && <Hero />}` —
 * and the starter ships that shape, so the `<Hero />` element's parent is a
 * logical expression rather than the `<main>` it appears in. Reordering the
 * elements alone would leave each guard behind, matched to whatever section
 * landed in its place; refusing instead is what the home page did, out of the
 * box, for every store.
 *
 * So the unit is the outermost wrapper that exists only to hold this section:
 * a logical expression whose right side it is, inside an expression container.
 * Anything looser is left alone, because moving it would move code that is not
 * the section's.
 */
function resolveMovableSection(
  section: PositionedSection,
  parentOf: Map<unknown, unknown>,
): { node: any; parent: any } {
  let node: any = section.node;
  let parent: any = parentOf.get(node) ?? section.parent;
  while (parent) {
    const climbs =
      (parent.type === "LogicalExpression" && parent.right === node) ||
      (parent.type === "JSXExpressionContainer" && parent.expression === node);
    if (!climbs) break;
    node = parent;
    parent = parentOf.get(parent) ?? null;
  }
  return { node, parent };
}

function buildParentMap(ast: unknown): Map<unknown, unknown> {
  const parents = new Map<unknown, unknown>();
  walkWithParent(ast, null, (node, parent) => {
    if (parent) parents.set(node, parent);
  });
  return parents;
}

/** Removes one route-owned section while preserving the surrounding source. */
export function removeThemeRouteSection(
  source: string,
  files: readonly ThemeSourceFile[],
  routeSourcePath: string,
  slotId: string,
): { code: string; changed: boolean; diagnostic?: string } {
  if (!isValidThemeContentSlotId(slotId)) {
    return {
      code: source,
      changed: false,
      diagnostic: "Invalid content slot id.",
    };
  }

  const normalizedRoutePath = normalizePath(routeSourcePath);
  const sourceFiles = files.map((file) =>
    normalizePath(file.path) === normalizedRoutePath
      ? { ...file, content: source }
      : file,
  );
  const parsed = parsePositionedSections(sourceFiles, normalizedRoutePath);
  if (parsed.diagnostics.length > 0) {
    return {
      code: source,
      changed: false,
      diagnostic: parsed.diagnostics[0],
    };
  }

  const section = parsed.sections.find(
    (candidate) => candidate.slotId === slotId,
  );
  if (!section) {
    return {
      code: source,
      changed: false,
      diagnostic: `Section "${slotId}" no longer exists in the route source.`,
    };
  }
  if (
    !section.parent ||
    (section.parent.type !== "JSXElement" &&
      section.parent.type !== "JSXFragment") ||
    !Array.isArray(section.parent.children) ||
    !section.parent.children.includes(section.node)
  ) {
    return {
      code: source,
      changed: false,
      diagnostic:
        "Only sections that are direct JSX children can be removed from the tree.",
    };
  }

  const start = section.node.start;
  const end = section.node.end;
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    start < 0 ||
    end <= start
  ) {
    return {
      code: source,
      changed: false,
      diagnostic: "The section source range is unavailable.",
    };
  }

  // When the section occupies a complete line, remove its indentation and
  // trailing newline too. This avoids leaving a blank row in the authored
  // route while still preserving inline JSX and comments exactly as written.
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = source.indexOf("\n", end);
  const before = source.slice(lineStart, start);
  const after = source.slice(end, lineEnd < 0 ? source.length : lineEnd);
  const isOwnLine = before.trim() === "" && after.trim() === "";
  const removeStart = isOwnLine ? lineStart : start;
  const removeEnd = isOwnLine
    ? lineEnd < 0
      ? source.length
      : lineEnd + 1
    : end;

  const withoutSection = replaceRange(source, removeStart, removeEnd, "");
  return {
    code: removeUnusedLocalImport(
      withoutSection,
      files,
      normalizedRoutePath,
      section.componentName,
      section.componentSourcePath,
    ),
    changed: true,
  };
}

/**
 * A route component import becomes unused when its only JSX occurrence was
 * removed. Keep the generated route type-safe by removing that import too,
 * but only after parsing the edited source and proving there are no remaining
 * references to the same local binding.
 */
function removeUnusedLocalImport(
  source: string,
  files: readonly ThemeSourceFile[],
  routeSourcePath: string,
  localName: string,
  componentSourcePath: string,
): string {
  let ast: any;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch {
    return source;
  }

  const filePaths = new Set(files.map((file) => normalizePath(file.path)));
  const normalizedComponentPath = normalizePath(componentSourcePath);
  const declaration = (ast.program.body ?? []).find(
    (statement: any) =>
      statement?.type === "ImportDeclaration" &&
      resolveLocalImport(
        normalizePath(routeSourcePath),
        statement.source?.value ?? "",
        filePaths,
      ) === normalizedComponentPath &&
      statement.specifiers?.some(
        (specifier: any) => specifier.local?.name === localName,
      ),
  );
  if (!declaration) return source;

  const specifier = declaration.specifiers.find(
    (candidate: any) => candidate.local?.name === localName,
  );
  if (!specifier) return source;

  let hasReference = false;
  walkWithParent(ast.program, null, (node, parent) => {
    if (
      hasReference ||
      (node.type !== "Identifier" && node.type !== "JSXIdentifier") ||
      node.name !== localName ||
      parent?.type?.startsWith("Import")
    ) {
      return;
    }
    hasReference = true;
  });
  if (hasReference) return source;

  const specifiers = declaration.specifiers as any[];
  const specifierIndex = specifiers.indexOf(specifier);
  const start = specifier.start;
  const end = specifier.end;
  if (typeof start !== "number" || typeof end !== "number") return source;

  if (specifiers.length === 1) {
    const lineStart = source.lastIndexOf("\n", declaration.start - 1) + 1;
    const lineEnd = source.indexOf("\n", declaration.end);
    const before = source.slice(lineStart, declaration.start);
    const after = source.slice(
      declaration.end,
      lineEnd < 0 ? source.length : lineEnd,
    );
    const ownLine = before.trim() === "" && after.trim() === "";
    return replaceRange(
      source,
      ownLine ? lineStart : declaration.start,
      ownLine ? (lineEnd < 0 ? source.length : lineEnd + 1) : declaration.end,
      "",
    );
  }

  if (specifier.type === "ImportSpecifier") {
    const namedSpecifiers = specifiers.filter(
      (candidate) => candidate.type === "ImportSpecifier",
    );
    if (namedSpecifiers.length === 1) {
      const openBrace = source.lastIndexOf("{", start);
      const closeBrace = source.indexOf("}", end);
      if (openBrace >= declaration.start && closeBrace > end) {
        const preceding = source.slice(declaration.start, openBrace);
        const comma = preceding.lastIndexOf(",");
        return replaceRange(
          source,
          comma >= 0 ? comma : openBrace,
          closeBrace + 1,
          "",
        );
      }
    }
    const nextNamed = namedSpecifiers.find(
      (candidate) => candidate.start > start,
    );
    const previousNamed = [...namedSpecifiers]
      .reverse()
      .find((candidate) => candidate.end < end);
    return nextNamed
      ? replaceRange(source, start, nextNamed.start, "")
      : previousNamed
        ? replaceRange(source, previousNamed.end, end, "")
        : source;
  }

  // Removing a default/namespace binding while keeping named imports should
  // preserve the named import braces (`import { Other } from ...`).
  const openBrace = source.indexOf("{", end);
  if (openBrace >= end && openBrace < declaration.end) {
    return replaceRange(source, start, openBrace, "");
  }
  const nextSpecifier = specifiers[specifierIndex + 1];
  return nextSpecifier
    ? replaceRange(source, start, nextSpecifier.start, "")
    : source;
}

function relativeImport(fromPath: string, targetPath: string): string {
  const from = dirname(fromPath).split("/").filter(Boolean);
  const target = targetPath
    .replace(/\.(?:tsx?|jsx?)$/, "")
    .split("/")
    .filter(Boolean);
  while (from.length && target.length && from[0] === target[0]) {
    from.shift();
    target.shift();
  }
  const value = `${"../".repeat(from.length)}${target.join("/")}`;
  return value.startsWith(".") ? value : `./${value}`;
}

type ContentBindingImport = Readonly<{
  localName: string;
  needsImport: boolean;
}>;

function contentBindingImport(
  ast: any,
  files: readonly ThemeSourceFile[],
  routeSourcePath: string,
): ContentBindingImport {
  const filePaths = new Set(files.map((file) => normalizePath(file.path)));
  const usedNames = new Set<string>();
  for (const statement of ast.program.body ?? []) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const specifier of statement.specifiers ?? []) {
      if (specifier.local?.type === "Identifier") {
        usedNames.add(specifier.local.name);
      }
    }
    const resolved = resolveLocalImport(
      normalizePath(routeSourcePath),
      statement.source?.value ?? "",
      filePaths,
    );
    if (resolved !== "src/morph/content.ts") continue;
    const contentSpecifier = statement.specifiers?.find(
      (specifier: any) =>
        specifier.type === "ImportSpecifier" &&
        (specifier.imported?.name ?? specifier.imported?.value) === "content",
    );
    if (contentSpecifier?.local?.type === "Identifier") {
      return { localName: contentSpecifier.local.name, needsImport: false };
    }
  }

  let localName = "content";
  let suffix = 2;
  while (usedNames.has(localName)) {
    localName = `morphContent${suffix > 2 ? suffix : ""}`;
    suffix += 1;
  }
  return { localName, needsImport: true };
}

function contentImportStatement(
  routeSourcePath: string,
  localName: string,
): string {
  const imported =
    localName === "content" ? "{ content }" : `{ content as ${localName} }`;
  return `import ${imported} from ${JSON.stringify(
    relativeImport(normalizePath(routeSourcePath), "src/morph/content.ts"),
  )};`;
}

function contentSpreadAttribute(localName: string, slotId: string): string {
  return `{...${localName}(${JSON.stringify(slotId)})}`;
}

function insertImportStatements(
  source: string,
  ast: any,
  statements: readonly string[],
): string {
  if (statements.length === 0) return source;
  const lastImport = [...(ast.program.body ?? [])]
    .reverse()
    .find((statement: any) => statement.type === "ImportDeclaration");
  const insertAt = typeof lastImport?.end === "number" ? lastImport.end : 0;
  return replaceRange(
    source,
    insertAt,
    insertAt,
    `${insertAt ? "\n" : ""}${statements.join("\n")}`,
  );
}

function insertContentImport(
  source: string,
  ast: any,
  routeSourcePath: string,
  localName: string,
): string {
  return insertImportStatements(source, ast, [
    contentImportStatement(routeSourcePath, localName),
  ]);
}

function insertContentSpread(
  source: string,
  ast: any,
  sourceStart: number,
  sourceEnd: number,
  slotId: string,
  localName: string,
  expectedComponentName?: string,
): { code: string; changed: boolean; diagnostic?: string } {
  let target: any | null = null;
  walkWithParent(ast.program, null, (node) => {
    if (
      node?.type === "JSXElement" &&
      node.start === sourceStart &&
      node.end === sourceEnd
    ) {
      target = node;
    }
  });
  if (!target?.openingElement?.name?.end) {
    return {
      code: source,
      changed: false,
      diagnostic: "The section source location no longer matches the route.",
    };
  }
  if (
    expectedComponentName &&
    jsxIdentifier(target) !== expectedComponentName
  ) {
    return {
      code: source,
      changed: false,
      diagnostic:
        "The section source changed since it was listed. Refresh the route and try again.",
    };
  }
  if (hasContentSpread(target)) {
    return {
      code: source,
      changed: false,
      diagnostic: "This section already has a content binding.",
    };
  }
  return {
    code: replaceRange(
      source,
      target.openingElement.name.end,
      target.openingElement.name.end,
      // The leading space is the caller's, not the attribute's: this offset
      // sits immediately after the tag name, so the separator has to come from
      // here. Sharing the attribute itself is what keeps the bind path and the
      // add path from drifting apart on the `content(...)` spelling.
      ` ${contentSpreadAttribute(localName, slotId)}`,
    ),
    changed: true,
  };
}

/** Binds one existing native JSX section to the existing content contract. */
export function bindThemeRouteSection(args: {
  source: string;
  files: readonly ThemeSourceFile[];
  routeSourcePath: string;
  candidate: ThemeUnboundRouteSection;
  slotId: string;
}): { code: string; changed: boolean; diagnostic?: string } {
  if (!isValidThemeContentSlotId(args.slotId)) {
    return {
      code: args.source,
      changed: false,
      diagnostic: "Invalid content slot id.",
    };
  }
  if (!args.candidate.canBind) {
    return {
      code: args.source,
      changed: false,
      diagnostic:
        args.candidate.diagnostic ?? "This section cannot be bound safely.",
    };
  }

  let ast: any;
  try {
    ast = parse(args.source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch (error) {
    return {
      code: args.source,
      changed: false,
      diagnostic:
        error instanceof Error ? error.message : "Invalid route source",
    };
  }

  const current = parsePositionedSections(
    args.files.map((file) =>
      normalizePath(file.path) === normalizePath(args.routeSourcePath)
        ? { ...file, content: args.source }
        : file,
    ),
    args.routeSourcePath,
  );
  if (current.sections.some((section) => section.slotId === args.slotId)) {
    return {
      code: args.source,
      changed: false,
      diagnostic: "That content slot already exists.",
    };
  }
  const currentCandidate = current.unboundSections.find(
    (candidate) =>
      candidate.sourceStart === args.candidate.sourceStart &&
      candidate.sourceEnd === args.candidate.sourceEnd &&
      candidate.componentName === args.candidate.componentName &&
      candidate.componentSourcePath === args.candidate.componentSourcePath,
  );
  if (!currentCandidate) {
    return {
      code: args.source,
      changed: false,
      diagnostic:
        "The section source changed since it was listed. Refresh the route and try again.",
    };
  }
  if (!currentCandidate.canBind) {
    return {
      code: args.source,
      changed: false,
      diagnostic:
        currentCandidate.diagnostic ??
        "This section cannot be bound safely from the current route.",
    };
  }
  const binding = contentBindingImport(ast, args.files, args.routeSourcePath);
  const inserted = insertContentSpread(
    args.source,
    ast,
    args.candidate.sourceStart,
    args.candidate.sourceEnd,
    args.slotId,
    binding.localName,
    args.candidate.componentName,
  );
  if (!inserted.changed) return inserted;
  return {
    code: binding.needsImport
      ? insertContentImport(
          inserted.code,
          ast,
          args.routeSourcePath,
          binding.localName,
        )
      : inserted.code,
    changed: true,
  };
}

/** Adds one route-owned section and its imports. */
export function addThemeRouteSection(args: {
  source: string;
  files: readonly ThemeSourceFile[];
  routeSourcePath: string;
  option: ThemeRouteSectionOption;
  slotId: string;
}): { code: string; changed: boolean; diagnostic?: string } {
  if (!isValidThemeContentSlotId(args.slotId)) {
    return {
      code: args.source,
      changed: false,
      diagnostic: "Invalid content slot id.",
    };
  }
  const normalizedRoutePath = normalizePath(args.routeSourcePath);
  const sourceFiles = args.files.map((file) =>
    normalizePath(file.path) === normalizedRoutePath
      ? { ...file, content: args.source }
      : file,
  );
  const current = parsePositionedSections(sourceFiles, normalizedRoutePath);
  if (current.sections.some((section) => section.slotId === args.slotId)) {
    return {
      code: args.source,
      changed: false,
      diagnostic: "That content slot already exists.",
    };
  }
  let ast: any;
  try {
    ast = parse(args.source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch (error) {
    return {
      code: args.source,
      changed: false,
      diagnostic:
        error instanceof Error ? error.message : "Invalid route source",
    };
  }

  const usedNames = new Set<string>();
  const filePaths = new Set(
    sourceFiles.map((file) => normalizePath(file.path)),
  );
  let existingComponentName: string | null = null;
  for (const statement of ast.program.body ?? []) {
    if (statement.type === "ImportDeclaration") {
      for (const specifier of statement.specifiers ?? []) {
        if (specifier.local?.type === "Identifier")
          usedNames.add(specifier.local.name);
      }
      if (
        resolveLocalImport(
          normalizedRoutePath,
          statement.source?.value ?? "",
          filePaths,
        ) === args.option.componentSourcePath
      ) {
        const defaultSpecifier = statement.specifiers?.find(
          (specifier: any) => specifier.type === "ImportDefaultSpecifier",
        );
        if (defaultSpecifier?.local?.type === "Identifier") {
          existingComponentName = defaultSpecifier.local.name;
        }
      }
    }
  }
  let componentName = existingComponentName ?? args.option.componentName;
  let suffix = 2;
  while (!existingComponentName && usedNames.has(componentName)) {
    componentName = `${args.option.componentName}${suffix}`;
    suffix += 1;
  }
  const contentBinding = contentBindingImport(
    ast,
    sourceFiles,
    normalizedRoutePath,
  );

  const allJsx: any[] = [];
  walkWithParent(ast.program, null, (node) => {
    if (node.type === "JSXElement") allJsx.push(node);
  });
  const parent = current.sections[0]?.parent ?? allJsx[0];
  const closeStart = parent?.closingElement?.start;
  if (parent?.type !== "JSXElement" || typeof closeStart !== "number") {
    return {
      code: args.source,
      changed: false,
      diagnostic:
        "The route must return a JSX container before a section can be added.",
    };
  }

  const lineStart = args.source.lastIndexOf("\n", closeStart - 1) + 1;
  const closingIndent =
    args.source.slice(lineStart, closeStart).match(/^\s*/)?.[0] ?? "";
  const childIndent = `${closingIndent}  `;
  // Inserted as a whole line above the closing tag rather than at the tag's
  // own offset: appending there leaves the new element sharing a line with
  // `</main>` and strands the closing tag's indentation on a blank line above.
  // This is source the author reads and edits, so it has to come out formatted.
  const onOwnLine = /^\s*$/.test(args.source.slice(lineStart, closeStart));
  const element = `${childIndent}<${componentName} ${contentSpreadAttribute(contentBinding.localName, args.slotId)} />\n`;
  let code = onOwnLine
    ? replaceRange(args.source, lineStart, lineStart, element)
    : replaceRange(
        args.source,
        closeStart,
        closeStart,
        `\n${element}${closingIndent}`,
      );

  const componentAlreadyImported = existingComponentName !== null;
  const imports: string[] = [];
  if (contentBinding.needsImport) {
    imports.push(
      contentImportStatement(normalizedRoutePath, contentBinding.localName),
    );
  }
  if (!componentAlreadyImported) {
    imports.push(
      `import ${componentName} from ${JSON.stringify(relativeImport(normalizedRoutePath, args.option.componentSourcePath))};`,
    );
  }
  code = insertImportStatements(code, ast, imports);
  return { code, changed: true };
}
