import { parse } from "@babel/parser";

export type ThemeRouteFileType =
  | "root"
  | "route"
  | "layout"
  | "pathless_layout"
  | "lazy"
  | "loader"
  | "component"
  | "errorComponent"
  | "notFoundComponent"
  | "pendingComponent";

export type ThemeRouteSourceMetadata = {
  sourcePath: string;
  relativePath: string;
  /** The internal file-route id (pathless/group markers are retained). */
  routeId: string;
  /** The public URL path used by Link and the preview matcher. */
  path: string;
  /** The canonical full path used by TanStack's generated route maps. */
  fullPath: string;
  routeType: ThemeRouteFileType;
  isRoutePiece: boolean;
  isIndex: boolean;
  isPathless: boolean;
  isNonNested: boolean;
  isSplat: boolean;
  /** Logical file-route segments used to resolve parent layouts. */
  treeSegments: string[];
  parentTreeSegments: string[];
  /**
   * A character that TanStack's generator rejects inside a square-bracket
   * escape. Keeping this on the source metadata lets callers surface the
   * same actionable diagnostic instead of silently compiling a different URL.
   */
  invalidEscapeCharacter?: string;
};

export type ThemeRouteRecord = {
  id: string;
  /** Public URL path. */
  path: string;
  /** Canonical full path; index routes retain TanStack's trailing slash. */
  fullPath?: string;
  /** Internal file-route id used by the generated route tree. */
  routeId?: string;
  sourcePath: string;
  kind: "root" | "route";
  dynamic: boolean;
  routeType?: Exclude<ThemeRouteFileType, "root">;
  isIndex?: boolean;
  isPathless?: boolean;
  isNonNested?: boolean;
  isSplat?: boolean;
  parentSourcePath?: string | null;
  /** Route pieces discovered by TanStack's file convention. */
  routePieces?: Partial<
    Record<
      Exclude<
        ThemeRouteFileType,
        "root" | "route" | "layout" | "pathless_layout"
      >,
      string
    >
  >;
  /** A lazy-only file gets a generated anchor route in the build tree. */
  isVirtual?: boolean;
  /** Named route component that the bounded Design runtime can execute. */
  componentName: string | null;
};

export type ThemeRouteDiagnostic = {
  level: "error" | "warning";
  code:
    | "DUPLICATE_ROUTE_PATH"
    | "INVALID_ROUTE_PATH"
    | "MALFORMED_ROUTE_SOURCE"
    | "MISSING_ROOT_ROUTE"
    | "UNDECLARED_ROUTE_MODULE"
    | "UNSUPPORTED_ROUTE_CONFIG"
    | "ROUTE_PATH_MISMATCH";
  message: string;
  sourcePath?: string;
};

type ThemeRoutePieceType = Exclude<
  ThemeRouteFileType,
  "root" | "route" | "layout" | "pathless_layout"
>;

export type ThemeRouteRegistry = {
  valid: boolean;
  routes: ThemeRouteRecord[];
  diagnostics: ThemeRouteDiagnostic[];
};

type ThemeRouteSourceFile = {
  path: string;
  content: string;
};

const ROUTE_CONFIG_PATH = "tsr.config.json";

const ROUTE_SOURCE_PATTERN = /\.(?:[cm]?[jt]sx?)$/;
const ROUTE_PIECE_SUFFIXES = new Map<string, ThemeRouteFileType>([
  ["lazy", "lazy"],
  ["loader", "loader"],
  ["component", "component"],
  ["errorComponent", "errorComponent"],
  ["notFoundComponent", "notFoundComponent"],
  ["pendingComponent", "pendingComponent"],
]);

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function splitFlatRouteSegments(value: string): string[] {
  const segments: string[] = [];
  let current = "";
  let bracketDepth = 0;
  for (const character of value) {
    if (character === "[") bracketDepth += 1;
    if (character === "]" && bracketDepth > 0) bracketDepth -= 1;
    if (character === "." && bracketDepth === 0) {
      if (current) segments.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current) segments.push(current);
  return segments;
}

function isFullyEscapedSegment(segment: string): boolean {
  return (
    segment.startsWith("[") &&
    segment.endsWith("]") &&
    !segment.slice(1, -1).includes("[") &&
    !segment.slice(1, -1).includes("]")
  );
}

function hasEscapedLeadingUnderscore(segment: string): boolean {
  return (
    segment.startsWith("[_]") ||
    (segment.startsWith("[_") && isFullyEscapedSegment(segment))
  );
}

function hasEscapedTrailingUnderscore(segment: string): boolean {
  return (
    segment.endsWith("[_]") ||
    (segment.endsWith("_]") && isFullyEscapedSegment(segment))
  );
}

function isEscapedToken(segment: string, token: string): boolean {
  return (
    segment === `[${token}]` ||
    (segment.startsWith(`[${token}`) && isFullyEscapedSegment(segment))
  );
}

// Keep this in sync with TanStack Router's file-route generator. Square
// brackets are only an escape mechanism for otherwise-special route tokens;
// these characters are explicitly rejected by the generator inside brackets.
const DISALLOWED_BRACKET_ESCAPE_CHARACTERS = new Set([
  "/",
  "\\",
  "?",
  "#",
  ":",
  "*",
  "<",
  ">",
  "|",
  "!",
  "$",
  "%",
]);

function invalidBracketEscapeCharacter(value: string): string | undefined {
  const matches = value.match(/\[([^\]]*)\]/g) ?? [];
  for (const match of matches) {
    const contents = match.slice(1, -1);
    const invalid = [...contents].find((character) =>
      DISALLOWED_BRACKET_ESCAPE_CHARACTERS.has(character),
    );
    if (invalid) return invalid;
  }
  return undefined;
}

function unescapeRouteSegment(segment: string): string {
  return segment.replace(/\[([^\]]+)\]/g, "$1");
}

function isPathlessSegment(segment: string | undefined): boolean {
  if (!segment) return false;
  return (
    (segment.startsWith("_") && !hasEscapedLeadingUnderscore(segment)) ||
    (segment.startsWith("(") && segment.endsWith(")"))
  );
}

/**
 * Parses the portion of TanStack Router's file convention that is useful to
 * the editor and the isolated preview. This is intentionally pure and does
 * not import the Node-only router generator, so it can run in the browser.
 */
export function parseThemeRouteSourcePath(
  path: string,
): ThemeRouteSourceMetadata | null {
  const normalized = normalizePath(path);
  if (!normalized.startsWith("src/routes/")) return null;
  if (!ROUTE_SOURCE_PATTERN.test(normalized)) return null;

  const relativePath = normalized.slice("src/routes/".length);
  if (
    !relativePath ||
    relativePath
      .split("/")
      .some(
        (segment) =>
          !segment || segment.startsWith("-") || segment.startsWith("."),
      )
  ) {
    return null;
  }

  const withoutExtension = relativePath.replace(/\.[cm]?[jt]sx?$/, "");
  const rawParts = withoutExtension.split("/").filter(Boolean);
  if (rawParts.length === 0) return null;
  const fileParts = splitFlatRouteSegments(rawParts.pop()!);
  const sourceSegments = [...rawParts, ...fileParts];
  const invalidEscapeCharacter = sourceSegments
    .map(invalidBracketEscapeCharacter)
    .find((character): character is string => Boolean(character));

  if (sourceSegments.length === 1 && sourceSegments[0] === "__root") {
    return {
      sourcePath: normalized,
      relativePath,
      routeId: "/",
      path: "/",
      fullPath: "/",
      routeType: "root",
      isRoutePiece: false,
      isIndex: false,
      isPathless: false,
      isNonNested: false,
      isSplat: false,
      treeSegments: [],
      parentTreeSegments: [],
      ...(invalidEscapeCharacter ? { invalidEscapeCharacter } : {}),
    };
  }

  let routeType: ThemeRouteFileType = "route";
  let isRoutePiece = false;
  let segments = [...sourceSegments];
  const finalSegment = segments.at(-1);
  if (
    finalSegment &&
    !finalSegment.startsWith("[") &&
    !finalSegment.endsWith("]")
  ) {
    const pieceType = ROUTE_PIECE_SUFFIXES.get(finalSegment);
    if (pieceType) {
      routeType = pieceType;
      isRoutePiece = true;
      segments = segments.slice(0, -1);
    }
  }

  // Root route pieces (for example `__root.lazy.tsx`) use the same `/` route
  // id as `__root.tsx`; they are attached to the root route rather than being
  // treated as a literal `/__root` path.
  if (segments.length === 1 && segments[0] === "__root") {
    return {
      sourcePath: normalized,
      relativePath,
      routeId: "/",
      path: "/",
      fullPath: "/",
      routeType,
      isRoutePiece,
      isIndex: false,
      isPathless: false,
      isNonNested: false,
      isSplat: false,
      treeSegments: [],
      parentTreeSegments: [],
      ...(invalidEscapeCharacter ? { invalidEscapeCharacter } : {}),
    };
  }

  let isIndex = false;
  if (segments.at(-1) === "index") {
    isIndex = true;
    segments = segments.slice(0, -1);
  }

  if (segments.at(-1) === "route") {
    if (!isRoutePiece) routeType = "layout";
    segments = segments.slice(0, -1);
  }

  // `src/routes/index.tsx` is the root index route. It is a real route node
  // (distinct from __root) and therefore must not be discarded when its URL
  // segments are empty.
  if (segments.length === 0 && !isIndex && routeType !== "layout") {
    return null;
  }
  const treeSegments = [...segments, ...(isIndex ? ["index"] : [])];
  // A pathless segment in an ancestor (for example `_marketing.about.tsx`)
  // only changes the nesting parent.  The route file itself is pathless only
  // when its final route segment is pathless (for example `_marketing.tsx`).
  const isPathless = isPathlessSegment(segments.at(-1));
  const isNonNested = segments.some(
    (segment) => segment.endsWith("_") && !hasEscapedTrailingUnderscore(segment),
  );
  const urlSegments = segments
    .filter((segment) => !isPathlessSegment(segment))
    .map((segment) => {
      const nonNestedSegment =
        segment.endsWith("_") && !hasEscapedTrailingUnderscore(segment)
          ? segment.slice(0, -1)
          : segment;
      return unescapeRouteSegment(nonNestedSegment);
    })
    .filter(Boolean);
  const publicPath = urlSegments.length ? `/${urlSegments.join("/")}` : "/";
  const idSegments = segments.map(unescapeRouteSegment);
  // TanStack keeps index routes distinct from their parent in generated route
  // maps by giving them a trailing slash in the internal id/full path, while
  // the public `to` path remains normalized (for example `/posts/` vs
  // `/posts`).
  const routeIdBase = idSegments.length ? `/${idSegments.join("/")}` : "/";
  const routeId =
    isIndex && routeIdBase !== "/" ? `${routeIdBase}/` : routeIdBase;
  const fullPath =
    isIndex && publicPath !== "/" ? `${publicPath}/` : publicPath;
  const parentTreeSegments = treeSegments.slice(0, -1);
  const finalUrlSegment = urlSegments.at(-1);
  const finalSourceSegment = segments.at(-1);

  // TanStack treats both a plain pathless file (`_marketing.tsx`) and a
  // route configuration file (`_marketing/route.tsx`) as pathless layouts.
  // Keeping the distinction here matters for parent resolution: a `route.tsx`
  // file is not a URL segment of its own and must remain in the tree so that
  // descendants inherit its layout.
  if ((routeType === "route" || routeType === "layout") && isPathless) {
    routeType = "pathless_layout";
  }

  return {
    sourcePath: normalized,
    relativePath,
    routeId: routeId === "//" ? "/" : routeId,
    path: publicPath,
    fullPath,
    routeType,
    isRoutePiece,
    isIndex,
    isPathless,
    isNonNested,
    isSplat:
      finalUrlSegment === "$" &&
      finalSourceSegment !== undefined &&
      !isEscapedToken(finalSourceSegment, "$"),
    treeSegments,
    parentTreeSegments,
    ...(invalidEscapeCharacter ? { invalidEscapeCharacter } : {}),
  };
}

export function isThemeRouteSourcePath(path: string): boolean {
  const metadata = parseThemeRouteSourcePath(path);
  // Companion modules (about.lazy.tsx, about.loader.ts, ...) are understood
  // by the filename parser but are not standalone route records.
  return metadata !== null && !metadata.isRoutePiece;
}

/** Public URL path used by Link and preview matching. */
export function themeRoutePathFromSourcePath(path: string): string | null {
  return parseThemeRouteSourcePath(path)?.path ?? null;
}

/** Internal route id used in a TanStack `createFileRoute` literal. */
export function themeRouteIdFromSourcePath(path: string): string | null {
  return parseThemeRouteSourcePath(path)?.routeId ?? null;
}

function walkAst(node: unknown, visit: (candidate: any) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkAst(item, visit);
    return;
  }
  const candidate = node as Record<string, unknown>;
  visit(candidate);
  for (const [key, value] of Object.entries(candidate)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    walkAst(value, visit);
  }
}

function readRouteFactoryCall(
  node: any,
): { kind: "root"; path: "/" } | { kind: "route"; path: string } | null {
  if (node?.type !== "CallExpression") return null;
  const callee = node.callee;
  if (callee?.type !== "Identifier") return null;
  if (
    callee.name === "createRootRoute" ||
    callee.name === "createRootRouteWithContext"
  ) {
    return { kind: "root", path: "/" };
  }
  if (
    callee.name !== "createFileRoute" &&
    callee.name !== "createLazyFileRoute"
  ) {
    return null;
  }
  const argument = node.arguments?.[0];
  const staticValue = readStaticRouteArgument(argument);
  if (staticValue !== null) {
    return { kind: "route", path: staticValue };
  }
  return { kind: "route", path: "" };
}

function readStaticRouteArgument(argument: any): string | null {
  if (argument?.type === "StringLiteral") return argument.value;
  if (
    argument?.type === "TemplateLiteral" &&
    argument.expressions?.length === 0
  ) {
    return argument.quasis?.[0]?.value?.cooked ?? "";
  }
  return null;
}

export const SAFE_THEME_INLINE_ROUTE_COMPONENT = "__MorphInlineRouteComponent";

function readObjectComponentProperty(object: any): string | null {
  if (object?.type !== "ObjectExpression") return null;
  const property = object.properties?.find(
    (candidate: any) =>
      candidate?.type === "ObjectProperty" &&
      !candidate.computed &&
      (candidate.key?.name === "component" ||
        candidate.key?.value === "component"),
  );
  if (property?.value?.type === "Identifier") return property.value.name;
  if (
    property?.value?.type === "ArrowFunctionExpression" ||
    property?.value?.type === "FunctionExpression"
  ) {
    return SAFE_THEME_INLINE_ROUTE_COMPONENT;
  }
  return null;
}

function readRouteDeclaration(ast: any): {
  kind: "root" | "route";
  path: string;
  componentName: string | null;
} | null {
  for (const statement of ast.program.body ?? []) {
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? statement.declaration
        : statement;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const variable of declaration.declarations ?? []) {
      if (variable.id?.type !== "Identifier" || variable.id.name !== "Route") {
        continue;
      }
      const initializer = variable.init;
      if (initializer?.type !== "CallExpression") continue;

      if (
        initializer.callee?.type === "Identifier" &&
        (initializer.callee.name === "createRootRoute" ||
          initializer.callee.name === "createRootRouteWithContext")
      ) {
        return {
          kind: "root",
          path: "/",
          componentName: readObjectComponentProperty(
            initializer.arguments?.[0],
          ),
        };
      }

      const factoryCall = initializer.callee;
      const declarationResult = readRouteFactoryCall(factoryCall);
      if (!declarationResult) continue;
      if (declarationResult.kind === "root") {
        return {
          kind: "root",
          path: "/",
          componentName: readObjectComponentProperty(initializer.arguments?.[0]),
        };
      }
      return {
        ...declarationResult,
        componentName: readObjectComponentProperty(initializer.arguments?.[0]),
      };
    }
  }
  return null;
}

function isValidRoutePath(path: string): boolean {
  return (
    path.startsWith("/") &&
    path.length <= 300 &&
    !path.includes("?") &&
    !path.includes("#") &&
    !path.includes("\\")
  );
}

function normalizeConfigPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

/**
 * The browser-side registry intentionally implements the platform's fixed
 * `src/routes` contract. A Theme may still include a tsr.config.json for
 * formatting/build options, but route-shape options that the bounded parser
 * cannot mirror must fail closed instead of letting preview and production
 * discover different trees.
 */
function readUnsupportedRouteConfigDiagnostics(
  files: readonly ThemeRouteSourceFile[],
): ThemeRouteDiagnostic[] {
  const configFile = files.find(
    (file) => normalizePath(file.path) === ROUTE_CONFIG_PATH,
  );
  if (!configFile) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(configFile.content);
  } catch {
    return [
      {
        level: "error",
        code: "UNSUPPORTED_ROUTE_CONFIG",
        message: `TanStack route config "${ROUTE_CONFIG_PATH}" must contain valid JSON.`,
        sourcePath: configFile.path,
      },
    ];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [
      {
        level: "error",
        code: "UNSUPPORTED_ROUTE_CONFIG",
        message: `TanStack route config "${ROUTE_CONFIG_PATH}" must be a JSON object.`,
        sourcePath: configFile.path,
      },
    ];
  }

  const config = parsed as Record<string, unknown>;
  const diagnostics: ThemeRouteDiagnostic[] = [];
  const unsupported = (field: string, reason: string) => {
    diagnostics.push({
      level: "error",
      code: "UNSUPPORTED_ROUTE_CONFIG",
      message: `TanStack route config field "${field}" is not supported in the bounded Theme editor: ${reason}`,
      sourcePath: configFile.path,
    });
  };

  if (typeof config.target === "string" && config.target !== "react") {
    unsupported("target", "Themes are compiled as React applications.");
  }
  if (
    typeof config.routesDirectory === "string" &&
    normalizeConfigPath(config.routesDirectory) !== "src/routes"
  ) {
    unsupported("routesDirectory", 'use the fixed "src/routes" directory.');
  }
  if (
    typeof config.generatedRouteTree === "string" &&
    normalizeConfigPath(config.generatedRouteTree) !== "src/routeTree.gen.ts"
  ) {
    unsupported(
      "generatedRouteTree",
      'use the fixed "src/routeTree.gen.ts" generated artifact.',
    );
  }
  if (config.disableTypes === true) {
    unsupported("disableTypes", "Code Mode requires the generated TypeScript route types.");
  }
  if (
    config.routeToken !== undefined &&
    (typeof config.routeToken !== "string" || config.routeToken !== "route")
  ) {
    unsupported("routeToken", 'use the default "route" token.');
  }
  if (
    config.indexToken !== undefined &&
    (typeof config.indexToken !== "string" || config.indexToken !== "index")
  ) {
    unsupported("indexToken", 'use the default "index" token.');
  }
  if (
    config.routeFilePrefix !== undefined &&
    config.routeFilePrefix !== ""
  ) {
    unsupported("routeFilePrefix", "custom route prefixes are not mirrored by Code Mode.");
  }
  if (
    config.routeFileIgnorePrefix !== undefined &&
    config.routeFileIgnorePrefix !== "-"
  ) {
    unsupported("routeFileIgnorePrefix", 'use the default "-" prefix.');
  }
  if (
    config.routeFileIgnorePattern !== undefined &&
    config.routeFileIgnorePattern !== ""
  ) {
    unsupported("routeFileIgnorePattern", "custom ignore patterns are not mirrored by Code Mode.");
  }
  if (config.virtualRouteConfig !== undefined) {
    unsupported("virtualRouteConfig", "virtual routes require executing user configuration code.");
  }
  if (config.plugins !== undefined) {
    unsupported("plugins", "generator plugins are not executed in the bounded editor registry.");
  }

  return diagnostics;
}

function equivalentRoutePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const trimmed = value.replace(/\/+$/, "");
    return trimmed || "/";
  };
  return normalize(left) === normalize(right);
}

/**
 * Builds a bounded, source-derived registry for Customer Theme routes.
 * It never executes Theme code and only accepts static TanStack route factory
 * arguments. The generated TanStack route tree remains a build artifact.
 */
export function buildThemeRouteRegistry(
  files: readonly ThemeRouteSourceFile[],
): ThemeRouteRegistry {
  const routes: ThemeRouteRecord[] = [];
  const diagnostics: ThemeRouteDiagnostic[] = [
    ...readUnsupportedRouteConfigDiagnostics(files),
  ];
  const routePieces: Array<{
    path: string;
    metadata: ThemeRouteSourceMetadata;
    type: ThemeRoutePieceType;
  }> = [];
  const declaredPathOwners = new Map<
    string,
    { sourcePath: string; allowShared: boolean }
  >();

  for (const file of files) {
    const metadata = parseThemeRouteSourcePath(file.path);
    if (!metadata) continue;
    if (metadata.invalidEscapeCharacter) {
      diagnostics.push({
        level: "error",
        code: "INVALID_ROUTE_PATH",
        message: `Route module "${file.path}" uses disallowed character "${metadata.invalidEscapeCharacter}" inside a square-bracket escape.`,
        sourcePath: file.path,
      });
      continue;
    }
    const sourceFileName = metadata.relativePath.split("/").at(-1) ?? "";
    const sourceFileStem = sourceFileName.replace(/\.[cm]?[jt]sx?$/, "");
    const finalSourceToken = splitFlatRouteSegments(sourceFileStem).at(-1);
    if (
      finalSourceToken?.startsWith("(") &&
      finalSourceToken.endsWith(")")
    ) {
      diagnostics.push({
        level: "error",
        code: "INVALID_ROUTE_PATH",
        message: `Route group file "${file.path}" cannot be a route configuration. Use a pathless layout (for example _layout.tsx) when the group needs a component.`,
        sourcePath: file.path,
      });
      continue;
    }
    if (metadata.isRoutePiece) {
      if (
        metadata.routeType !== "lazy" &&
        metadata.routeType !== "loader" &&
        metadata.routeType !== "component" &&
        metadata.routeType !== "errorComponent" &&
        metadata.routeType !== "notFoundComponent" &&
        metadata.routeType !== "pendingComponent"
      ) {
        continue;
      }
      routePieces.push({
        path: file.path,
        metadata,
        type: metadata.routeType,
      });
      continue;
    }

    let ast: any;
    try {
      ast = parse(file.content, {
        sourceType: "module",
        plugins: ["jsx", "typescript"],
      });
    } catch (error) {
      diagnostics.push({
        level: "error",
        code: "MALFORMED_ROUTE_SOURCE",
        message:
          error instanceof Error ? error.message : "Invalid route source",
        sourcePath: file.path,
      });
      continue;
    }

    const declaredRoute = readRouteDeclaration(ast);
    const declarations: Array<{ kind: "root" | "route"; path: string }> = [];
    if (!declaredRoute) {
      walkAst(ast.program, (node) => {
        const declaration = readRouteFactoryCall(node);
        if (declaration) declarations.push(declaration);
      });
    }

    const declaration =
      declaredRoute ??
      declarations.find((item) => item.kind === "root") ??
      declarations[0];
    if (!declaration) {
      diagnostics.push({
        level: "error",
        code: "UNDECLARED_ROUTE_MODULE",
        message: `Route module "${file.path}" does not declare a supported static TanStack route factory.`,
        sourcePath: file.path,
      });
      continue;
    }
    const isCanonicalRootFile = metadata.routeType === "root";
    if (declaration.kind === "root" && !isCanonicalRootFile) {
      diagnostics.push({
        level: "error",
        code: "INVALID_ROUTE_PATH",
        message: `Root route factory in "${file.path}" must be declared by the canonical src/routes/__root.tsx file.`,
        sourcePath: file.path,
      });
      continue;
    }
    if (isCanonicalRootFile && declaration.kind !== "root") {
      diagnostics.push({
        level: "error",
        code: "INVALID_ROUTE_PATH",
        message: `The canonical root file "${file.path}" must export createRootRoute() or createRootRouteWithContext().`,
        sourcePath: file.path,
      });
      continue;
    }
    if (!isValidRoutePath(declaration.path)) {
      diagnostics.push({
        level: "error",
        code: "INVALID_ROUTE_PATH",
        message: `Route module "${file.path}" must use a static absolute route path.`,
        sourcePath: file.path,
      });
      continue;
    }

    const expectedPath = metadata.routeType === "root" ? "/" : metadata.routeId;
    if (
      declaration.kind === "route" &&
      !equivalentRoutePath(declaration.path, expectedPath)
    ) {
      diagnostics.push({
        level: "warning",
        code: "ROUTE_PATH_MISMATCH",
        message: `Route module "${file.path}" declares "${declaration.path}"; TanStack file routing derives "${expectedPath}" from its filename.`,
        sourcePath: file.path,
      });
    }

    if (declaration.kind === "route") {
      const declaredPath = declaration.path.replace(/\/+$/, "") || "/";
      const existingOwner = declaredPathOwners.get(declaredPath);
      const allowsSharedPath = metadata.isIndex || metadata.isPathless;
      if (existingOwner && !existingOwner.allowShared && !allowsSharedPath) {
        diagnostics.push({
          level: "error",
          code: "DUPLICATE_ROUTE_PATH",
          message: `Route path "${declaration.path}" is declared by both "${existingOwner.sourcePath}" and "${file.path}".`,
          sourcePath: file.path,
        });
      } else {
        declaredPathOwners.set(
          declaredPath,
          existingOwner
            ? {
                sourcePath: existingOwner.sourcePath,
                allowShared: existingOwner.allowShared && allowsSharedPath,
              }
            : { sourcePath: file.path, allowShared: allowsSharedPath },
        );
      }
    }

    routes.push({
      id: declaration.kind === "root" ? "__root" : metadata.routeId,
      path: metadata.path,
      fullPath: metadata.fullPath,
      routeId: metadata.routeId,
      sourcePath: file.path,
      kind: declaration.kind,
      dynamic: metadata.path.includes("$"),
      routeType: metadata.routeType === "root" ? "layout" : metadata.routeType,
      isIndex: metadata.isIndex,
      isPathless: metadata.isPathless,
      isNonNested: metadata.isNonNested,
      isSplat: metadata.isSplat,
      parentSourcePath: null,
      componentName: declaredRoute?.componentName ?? null,
    });
  }

  // TanStack's generator associates companion files with the route that owns
  // the same route id. A lazy-only file creates a virtual anchor route; the
  // generated tree then imports the lazy file only when that route is matched.
  const routeById = new Map<string, ThemeRouteRecord>();
  for (const route of routes) {
    routeById.set(`${route.kind}:${route.routeId ?? route.path}`, route);
  }
  for (const piece of routePieces) {
    const routeId = piece.metadata.routeId;
    const isRootPiece =
      piece.path
        .replace(/\\/g, "/")
        .replace(/^src\/routes\//, "")
        .split("/")
        .at(-1)
        ?.startsWith("__root.") ?? false;
    const owner = routeById.get(`${isRootPiece ? "root" : "route"}:${routeId}`);
    if (owner) {
      owner.routePieces = {
        ...(owner.routePieces ?? {}),
        [piece.type]: piece.path,
      };
      continue;
    }
    if (piece.type === "lazy") {
      const virtualRoute: ThemeRouteRecord = {
        id: routeId,
        path: piece.metadata.path,
        fullPath: piece.metadata.fullPath,
        routeId,
        sourcePath: piece.path,
        kind: "route",
        dynamic: piece.metadata.path.includes("$"),
        routeType: "lazy",
        isIndex: piece.metadata.isIndex,
        isPathless: piece.metadata.isPathless,
        isNonNested: piece.metadata.isNonNested,
        isSplat: piece.metadata.isSplat,
        routePieces: { lazy: piece.path },
        isVirtual: true,
        parentSourcePath: null,
        componentName: null,
      };
      routes.push(virtualRoute);
      routeById.set(`route:${routeId}`, virtualRoute);
      continue;
    }
    diagnostics.push({
      level: "error",
      code: "UNDECLARED_ROUTE_MODULE",
      message: `Route piece "${piece.path}" has no matching route module for "${piece.metadata.path}".`,
      sourcePath: piece.path,
    });
  }

  const root = routes.find((route) => route.kind === "root");
  if (!root) {
    diagnostics.push({
      level: "error",
      code: "MISSING_ROOT_ROUTE",
      message:
        "Customer Theme routes require src/routes/__root.tsx with createRootRoute().",
      sourcePath: "src/routes/__root.tsx",
    });
  }

  const metadataBySource = new Map<string, ThemeRouteSourceMetadata>();
  for (const file of files) {
    const metadata = parseThemeRouteSourcePath(file.path);
    if (metadata) metadataBySource.set(normalizePath(file.path), metadata);
  }

  for (const route of routes) {
    if (route.kind === "root") {
      route.parentSourcePath = null;
      continue;
    }
    const metadata = metadataBySource.get(normalizePath(route.sourcePath));
    const parentSegments = metadata?.parentTreeSegments ?? [];
    let parent: ThemeRouteRecord | undefined;
    for (const candidate of routes) {
      if (candidate === route || candidate.kind !== "route") continue;
      const candidateMeta = metadataBySource.get(
        normalizePath(candidate.sourcePath),
      );
      if (!candidateMeta) continue;
      if (
        candidateMeta.treeSegments.length === parentSegments.length &&
        candidateMeta.treeSegments.every(
          (segment, index) => segment === parentSegments[index],
        )
      ) {
        parent = candidate;
        break;
      }
    }
    route.parentSourcePath = parent?.sourcePath ?? root?.sourcePath ?? null;
  }

  return {
    valid: diagnostics.every((diagnostic) => diagnostic.level !== "error"),
    routes: routes.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "root" ? -1 : 1;
      return (
        left.path.localeCompare(right.path) ||
        left.sourcePath.localeCompare(right.sourcePath)
      );
    }),
    diagnostics,
  };
}
