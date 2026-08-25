import { parse } from "@babel/parser";

export type ThemeRouteRecord = {
  id: string;
  path: string;
  sourcePath: string;
  kind: "root" | "route";
  dynamic: boolean;
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
    | "UNDECLARED_ROUTE_MODULE";
  message: string;
  sourcePath?: string;
};

export type ThemeRouteRegistry = {
  valid: boolean;
  routes: ThemeRouteRecord[];
  diagnostics: ThemeRouteDiagnostic[];
};

type ThemeRouteSourceFile = {
  path: string;
  content: string;
};

const ROUTE_SOURCE_PATTERN = /\.(?:[cm]?[jt]sx?)$/;

export function isThemeRouteSourcePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  if (!normalized.startsWith("src/routes/")) return false;
  if (!ROUTE_SOURCE_PATTERN.test(normalized)) return false;
  const relative = normalized.slice("src/routes/".length);
  if (
    !relative ||
    relative.endsWith(".lazy.tsx") ||
    relative.endsWith(".lazy.ts")
  ) {
    return false;
  }
  return !relative.split("/").some((segment) => segment.startsWith("-"));
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
  if (callee.name !== "createFileRoute") return null;
  const argument = node.arguments?.[0];
  if (argument?.type === "StringLiteral") {
    return { kind: "route", path: argument.value };
  }
  return { kind: "route", path: "" };
}

export const SAFE_THEME_INLINE_ROUTE_COMPONENT =
  "__MorphInlineRouteComponent";

function readObjectComponentProperty(
  object: any,
): string | null {
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

function readRouteDeclaration(
  ast: any,
): { kind: "root" | "route"; path: string; componentName: string | null } | null {
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
          componentName: readObjectComponentProperty(initializer.arguments?.[0]),
        };
      }

      const factoryCall = initializer.callee;
      const declarationResult = readRouteFactoryCall(factoryCall);
      if (!declarationResult || declarationResult.kind !== "route") continue;
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

/**
 * Builds a bounded, source-derived registry for Customer Theme routes.
 * It never executes Theme code and only accepts static TanStack route factory
 * arguments. The generated TanStack route tree remains a build artifact.
 */
export function buildThemeRouteRegistry(
  files: readonly ThemeRouteSourceFile[],
): ThemeRouteRegistry {
  const routes: ThemeRouteRecord[] = [];
  const diagnostics: ThemeRouteDiagnostic[] = [];

  for (const file of files) {
    if (!isThemeRouteSourcePath(file.path)) continue;
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
    if (!isValidRoutePath(declaration.path)) {
      diagnostics.push({
        level: "error",
        code: "INVALID_ROUTE_PATH",
        message: `Route module "${file.path}" must use a static absolute route path.`,
        sourcePath: file.path,
      });
      continue;
    }

    routes.push({
      id: declaration.kind === "root" ? "__root" : declaration.path,
      path: declaration.path,
      sourcePath: file.path,
      kind: declaration.kind,
      dynamic: declaration.path.includes("$"),
      componentName: declaredRoute?.componentName ?? null,
    });
  }

  if (
    routes.some((route) => route.kind === "route") &&
    !routes.some((route) => route.kind === "root")
  ) {
    diagnostics.push({
      level: "error",
      code: "MISSING_ROOT_ROUTE",
      message:
        "Customer Theme routes require src/routes/__root.tsx with createRootRoute().",
      sourcePath: "src/routes/__root.tsx",
    });
  }

  const byPath = new Map<string, ThemeRouteRecord>();
  for (const route of routes.filter((item) => item.kind === "route")) {
    const existing = byPath.get(route.path);
    if (existing) {
      diagnostics.push({
        level: "error",
        code: "DUPLICATE_ROUTE_PATH",
        message: `Route path "${route.path}" is declared by both "${existing.sourcePath}" and "${route.sourcePath}".`,
        sourcePath: route.sourcePath,
      });
    } else {
      byPath.set(route.path, route);
    }
  }

  return {
    valid: diagnostics.every((diagnostic) => diagnostic.level !== "error"),
    routes: routes.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "root" ? -1 : 1;
      return left.path.localeCompare(right.path);
    }),
    diagnostics,
  };
}
