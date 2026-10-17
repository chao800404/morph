import {
  isThemeSourceModulePath,
  packageImportUsesOnlySafeBoundary,
  parseThemeSourceModule,
} from "./theme-import-protection";
import type { ThemeFrameworkId } from "../theme-framework/theme-framework.types";

/**
 * What a TanStack Start Theme uses that the client-only Live Preview cannot
 * run.
 *
 * The default Live Preview builds only the browser half of the Theme
 * (theme-preview-server-stub.ts): a `createServerFn` handler never runs, so
 * its call resolves to nothing; `createServerOnlyFn` and the
 * `@tanstack/react-start/server` APIs throw from their stubs; and a route's
 * `server` handlers are never served. The page then renders without that
 * data, which looks like a Theme bug rather than a preview limit.
 *
 * This reports where the Theme *uses* those, so the editor can say so. It is
 * a static reading of the source, not of what ran, and it is neither exact
 * nor complete:
 *
 * - It over-approximates. A definition counts even if nothing calls it, and
 *   a use that the page never reaches is still reported. That is the
 *   intended side to err on: the notice says the Theme uses them, never that
 *   they failed.
 * - It can miss uses. It follows only static imports of the Start modules
 *   into the module that calls them (aliased or namespaced imports
 *   included). It does not follow a re-export through another Theme module,
 *   a Start function stored in a variable or passed around, a computed
 *   member (`start["createServerFn"]`), or a dynamic `import()` whose
 *   specifier is not a string literal. A Theme can therefore use server code
 *   this does not report; an empty result is not proof that it uses none.
 *
 * Not reported, by design:
 * - server APIs used only inside a boundary Start strips from the browser
 *   (`createServerFn().handler`, `createIsomorphicFn().server`,
 *   `createServerOnlyFn`, a route's `server` option): the enclosing
 *   `createServerFn`, `createServerOnlyFn` or route is reported instead, and
 *   the preview runs an isomorphic function's client branch. Known gap: an
 *   isomorphic function with a `.server` branch and no `.client` branch runs
 *   its server branch in the preview stub and is not reported.
 * - `*.server.*` modules and server-only markers: the import protection
 *   already refuses those in the client graph before the preview starts.
 */
export type ThemeClientOnlyPreviewLimitKind =
  | "createServerFn"
  | "createServerOnlyFn"
  | "server-api"
  | "server-route";

export type ThemeClientOnlyPreviewLimit = Readonly<{
  file: string;
  line: number;
  kind: ThemeClientOnlyPreviewLimitKind;
  /** The server API names a `server-api` import brings in. */
  names?: readonly string[];
}>;

/** Enough to name every file in a notice without sending a whole Theme back. */
export const MAX_CLIENT_ONLY_PREVIEW_LIMITS = 100;

const START_MODULE = "@tanstack/react-start";
const ROUTER_MODULE = "@tanstack/react-router";
const START_SERVER_MODULE = "@tanstack/react-start/server";

const SERVER_FUNCTION_KINDS = new Map<
  string,
  Extract<ThemeClientOnlyPreviewLimitKind, "createServerFn" | "createServerOnlyFn">
>([
  ["createServerFn", "createServerFn"],
  ["createServerOnlyFn", "createServerOnlyFn"],
]);

function isStartServerSource(source: unknown): source is string {
  return (
    typeof source === "string" &&
    (source === START_SERVER_MODULE ||
      source.startsWith(`${START_SERVER_MODULE}/`))
  );
}

function importedName(specifier: any): string | undefined {
  const imported = specifier?.imported;
  return imported?.name ?? imported?.value;
}

function lineOf(node: any): number {
  return Number(node?.loc?.start?.line ?? 1);
}

/**
 * Names declared in the module itself. A local `createServerFn` is the
 * author's own function, not Start's, the same rule the import protection
 * applies to its safe boundaries.
 */
function declaredNames(ast: any): Set<string> {
  const names = new Set<string>();
  const visit = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (
      (node.type === "FunctionDeclaration" ||
        node.type === "ClassDeclaration") &&
      node.id?.name
    ) {
      names.add(node.id.name);
    }
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier") {
      names.add(node.id.name);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
  };
  visit(ast.program);
  return names;
}

function collectFileLimits(
  path: string,
  content: string,
): ThemeClientOnlyPreviewLimit[] {
  let ast: any;
  try {
    ast = parseThemeSourceModule(content);
  } catch {
    // Syntax errors are the compiler's to report; nothing is guessed here.
    return [];
  }

  const serverFunctionNames = new Map<
    string,
    "createServerFn" | "createServerOnlyFn"
  >();
  const startNamespaces = new Set<string>();
  const fileRouteNames = new Set<string>();
  const routerNamespaces = new Set<string>();
  const serverApiImports: Array<{
    source: string;
    line: number;
    names: string[];
  }> = [];

  for (const statement of ast.program?.body ?? []) {
    if (statement.type !== "ImportDeclaration") continue;
    if (statement.importKind === "type") continue;
    const source = statement.source?.value;
    const specifiers: any[] = statement.specifiers ?? [];
    if (source === START_MODULE || source === ROUTER_MODULE) {
      for (const specifier of specifiers) {
        if (specifier.importKind === "type" || !specifier.local?.name) continue;
        if (specifier.type === "ImportNamespaceSpecifier") {
          (source === START_MODULE ? startNamespaces : routerNamespaces).add(
            specifier.local.name,
          );
          continue;
        }
        const name = importedName(specifier);
        if (!name) continue;
        const kind =
          source === START_MODULE ? SERVER_FUNCTION_KINDS.get(name) : undefined;
        if (kind) serverFunctionNames.set(specifier.local.name, kind);
        if (name === "createFileRoute") fileRouteNames.add(specifier.local.name);
      }
    } else if (isStartServerSource(source)) {
      const runtime = specifiers.filter(
        (specifier) => specifier.importKind !== "type",
      );
      if (specifiers.length > 0 && runtime.length === 0) continue;
      serverApiImports.push({
        source,
        line: lineOf(statement),
        names: runtime
          .map((specifier) =>
            specifier.type === "ImportSpecifier"
              ? importedName(specifier)
              : specifier.local?.name,
          )
          .filter((name): name is string => typeof name === "string"),
      });
    }
  }

  const shadowed = declaredNames(ast);
  for (const name of shadowed) {
    serverFunctionNames.delete(name);
    startNamespaces.delete(name);
    fileRouteNames.delete(name);
    routerNamespaces.delete(name);
  }

  const limits: ThemeClientOnlyPreviewLimit[] = [];

  const serverFunctionKindOf = (
    callee: any,
  ): "createServerFn" | "createServerOnlyFn" | undefined => {
    if (callee?.type === "Identifier") {
      return serverFunctionNames.get(callee.name);
    }
    if (
      callee?.type === "MemberExpression" &&
      !callee.computed &&
      callee.object?.type === "Identifier" &&
      startNamespaces.has(callee.object.name) &&
      callee.property?.type === "Identifier"
    ) {
      return SERVER_FUNCTION_KINDS.get(callee.property.name);
    }
    return undefined;
  };
  const isCreateFileRoute = (callee: any): boolean => {
    if (callee?.type === "Identifier") return fileRouteNames.has(callee.name);
    return (
      callee?.type === "MemberExpression" &&
      !callee.computed &&
      callee.object?.type === "Identifier" &&
      (startNamespaces.has(callee.object.name) ||
        routerNamespaces.has(callee.object.name)) &&
      callee.property?.type === "Identifier" &&
      callee.property.name === "createFileRoute"
    );
  };

  const seen = new Set<object>();
  const visit = (node: any): void => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (node.type === "CallExpression") {
      const kind = serverFunctionKindOf(node.callee);
      if (kind) limits.push({ file: path, line: lineOf(node), kind });

      // `createFileRoute(path)({ server: { handlers } })`: never served by
      // the client-only preview.
      if (
        node.callee?.type === "CallExpression" &&
        isCreateFileRoute(node.callee.callee)
      ) {
        const options = node.arguments?.[0];
        if (options?.type === "ObjectExpression") {
          for (const property of options.properties ?? []) {
            if (property?.type !== "ObjectProperty" || property.computed) {
              continue;
            }
            const key = property.key;
            const name = key?.type === "Identifier" ? key.name : key?.value;
            if (name === "server") {
              limits.push({ file: path, line: lineOf(property), kind: "server-route" });
            }
          }
        }
      }

      // `import("@tanstack/react-start/server")` cannot be proved to stay
      // inside a stripped boundary.
      if (
        node.callee?.type === "Import" &&
        isStartServerSource(node.arguments?.[0]?.value)
      ) {
        limits.push({ file: path, line: lineOf(node), kind: "server-api", names: [] });
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
  };
  visit(ast.program);

  for (const serverImport of serverApiImports) {
    if (
      packageImportUsesOnlySafeBoundary(content, serverImport.source, "client")
    ) {
      continue;
    }
    limits.push({
      file: path,
      line: serverImport.line,
      kind: "server-api",
      names: serverImport.names,
    });
  }
  return limits;
}

/**
 * Every use in these Theme files of something the client-only Live Preview
 * cannot run, ordered by file and line, at most
 * `MAX_CLIENT_ONLY_PREVIEW_LIMITS`. Files without text content (binary
 * files) and non-module files are skipped.
 *
 * For TanStack Start Themes only; the caller decides that.
 */
export function collectThemeClientOnlyPreviewLimits(
  files: ReadonlyArray<Readonly<{ path: string; content?: unknown }>>,
): ThemeClientOnlyPreviewLimit[] {
  const limits: ThemeClientOnlyPreviewLimit[] = [];
  for (const file of files) {
    if (typeof file.content !== "string") continue;
    const path = file.path.replace(/\\/g, "/").replace(/^\.\//, "");
    if (
      !isThemeSourceModulePath(path) ||
      path.endsWith(".d.ts") ||
      path.split("/").includes("node_modules")
    ) {
      continue;
    }
    limits.push(...collectFileLimits(path, file.content));
  }
  const unique = new Map<string, ThemeClientOnlyPreviewLimit>();
  for (const limit of limits) {
    const key = `${limit.file}:${limit.line}:${limit.kind}`;
    if (!unique.has(key)) unique.set(key, limit);
  }
  return [...unique.values()]
    .sort((a, b) =>
      a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1,
    )
    .slice(0, MAX_CLIENT_ONLY_PREVIEW_LIMITS);
}

/** The only framework whose preview has a client-only and a full Start mode. */
const TANSTACK_START_FRAMEWORK_ID: ThemeFrameworkId = "tanstack-start";

/**
 * What a start response says about the Live Preview runtime that served it.
 *
 * Only a TanStack Start Theme gets the two fields: `previewRuntime` names the
 * full Start server (`MORPH_THEME_PREVIEW_RUNTIME=start`) or the default
 * client-only build, and `clientOnlyLimits` lists, for the client-only one,
 * where the Theme uses what that build cannot run (empty for `start`).
 *
 * Any other framework (Astro), and a framework that did not resolve, gets
 * neither field. "Client-only" and "full Start" are not modes those previews
 * have, so the start says nothing rather than something that reads like one.
 * A reader treats a missing field as "nothing to say", never as a mode.
 */
export type ThemePreviewRuntimeReport =
  | Readonly<{
      previewRuntime: "client";
      clientOnlyLimits: readonly ThemeClientOnlyPreviewLimit[];
    }>
  | Readonly<{
      previewRuntime: "start";
      clientOnlyLimits: readonly ThemeClientOnlyPreviewLimit[];
    }>
  | Readonly<{ previewRuntime?: never; clientOnlyLimits?: never }>;

/**
 * What a Live Preview start tells the editor about the runtime it used, read
 * from the same files the start previews. Never changes how the preview
 * runs: the author is told, and nothing is switched for them.
 */
export function themePreviewRuntimeReport(input: {
  previewRuntime: "start" | undefined;
  /** The resolved framework's id, or null when it did not resolve. */
  frameworkId: string | null;
  files: ReadonlyArray<Readonly<{ path: string; content?: unknown }>>;
}): ThemePreviewRuntimeReport {
  if (input.frameworkId !== TANSTACK_START_FRAMEWORK_ID) return {};
  if (input.previewRuntime === "start") {
    return { previewRuntime: "start", clientOnlyLimits: [] };
  }
  return {
    previewRuntime: "client",
    clientOnlyLimits: collectThemeClientOnlyPreviewLimits(input.files),
  };
}
