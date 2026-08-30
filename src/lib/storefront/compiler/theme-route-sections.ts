import { parse } from "@babel/parser";
import { isValidThemeContentSlotId } from "@/lib/storefront/theme-content-slots";
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
}>;

export type ThemeRouteSectionResult = Readonly<{
  sections: readonly ThemeRouteSection[];
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
): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = normalizePath(`${dirname(sourcePath)}/${specifier}`);
  if (!base.startsWith("src/")) return null;
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
  return null;
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

function parsePositionedSections(
  files: readonly ThemeSourceFile[],
  routeSourcePath: string,
): {
  sections: PositionedSection[];
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
      diagnostics: [
        `${normalizedRoutePath}: ${error instanceof Error ? error.message : "Invalid route source"}`,
      ],
      ast: null,
      hasContentImport: false,
    };
  }

  const filePaths = new Set(files.map((file) => normalizePath(file.path)));
  const imports = new Map<string, { imported: string; sourcePath: string }>();
  for (const statement of ast.program.body ?? []) {
    if (statement?.type !== "ImportDeclaration") continue;
    const resolved = resolveLocalImport(
      normalizedRoutePath,
      statement.source?.value ?? "",
      filePaths,
    );
    if (!resolved) continue;
    for (const specifier of statement.specifiers ?? []) {
      if (specifier?.local?.type !== "Identifier") continue;
      const imported =
        specifier.type === "ImportDefaultSpecifier"
          ? "default"
          : (specifier.imported?.name ?? specifier.imported?.value);
      if (typeof imported === "string") {
        imports.set(specifier.local.name, { imported, sourcePath: resolved });
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

  return { sections, diagnostics, ast, hasContentImport };
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
  const manifestSources = readComponentSourcePaths(readManifestContent(files));
  const sources = new Map(manifestSources);
  const capabilities = resolveThemeContentCapabilitiesFromFiles(files);
  const rowComponents = readRowComponentPaths(files);
  for (const componentRef of Object.keys(capabilities.capabilities)) {
    if (
      componentRef.startsWith("src/") &&
      ![...sources.values()].includes(componentRef)
    ) {
      sources.set(componentRef, componentRef);
    }
  }
  return [...sources.entries()]
    .map(([componentRef, sourcePath]) => {
      const normalized = normalizePath(sourcePath);
      const basename = normalized
        .slice(normalized.lastIndexOf("/") + 1)
        .replace(/\.[^.]+$/, "");
      return {
        componentRef,
        sectionType: sectionTypeFromRef(componentRef, basename),
        componentName: basename.replace(/[^a-zA-Z0-9_$]/g, "") || "Section",
        componentSourcePath: normalized,
      };
    })
    .filter(
      (option) =>
        files.some(
          (file) => normalizePath(file.path) === option.componentSourcePath,
        ) &&
        !rowComponents.has(option.componentSourcePath) &&
        !rowComponents.has(
          option.componentSourcePath.replace(/\.(tsx|jsx)$/, ""),
        ),
    )
    .sort((left, right) => left.sectionType.localeCompare(right.sectionType));
}

function replaceRange(
  source: string,
  start: number,
  end: number,
  replacement: string,
): string {
  return source.slice(0, start) + replacement + source.slice(end);
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
  const parent = parsed.sections[0]?.parent;
  if (
    !parent ||
    parent.type !== "JSXElement" ||
    parsed.sections.some((section) => section.parent !== parent)
  ) {
    return {
      code: source,
      changed: false,
      diagnostic:
        "Only section components that are direct JSX siblings can be reordered.",
    };
  }
  const sorted = [...parsed.sections].sort(
    (a, b) => a.node.start - b.node.start,
  );
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
  const element = `${childIndent}<${componentName} {...content(${JSON.stringify(args.slotId)})} />\n`;
  let code = onOwnLine
    ? replaceRange(args.source, lineStart, lineStart, element)
    : replaceRange(
        args.source,
        closeStart,
        closeStart,
        `\n${element}${closingIndent}`,
      );

  const componentAlreadyImported = existingComponentName !== null;
  const hasContentImport = (ast.program.body ?? []).some(
    (statement: any) =>
      statement.type === "ImportDeclaration" &&
      statement.specifiers?.some(
        (specifier: any) =>
          specifier.type === "ImportSpecifier" &&
          (specifier.imported?.name ?? specifier.imported?.value) === "content",
      ),
  );
  const imports: string[] = [];
  if (!hasContentImport) {
    imports.push(
      `import { content } from ${JSON.stringify(relativeImport(normalizedRoutePath, "src/morph/content.ts"))};`,
    );
  }
  if (!componentAlreadyImported) {
    imports.push(
      `import ${componentName} from ${JSON.stringify(relativeImport(normalizedRoutePath, args.option.componentSourcePath))};`,
    );
  }
  if (imports.length) {
    const lastImport = [...(ast.program.body ?? [])]
      .reverse()
      .find((statement: any) => statement.type === "ImportDeclaration");
    const insertAt = typeof lastImport?.end === "number" ? lastImport.end : 0;
    code = replaceRange(
      code,
      insertAt,
      insertAt,
      `${insertAt ? "\n" : ""}${imports.join("\n")}`,
    );
  }
  return { code, changed: true };
}
