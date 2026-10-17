import {
  isThemeSourceModulePath,
  moduleImportUsesOnlySafeBoundary,
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
 *   a use that the page never reaches is still reported. Only top-level
 *   declarations count as shadowing an imported Start name: a nested
 *   declaration of the same name is not modelled, so a call to it inside
 *   that scope is still reported. That is the intended side to err on: the
 *   notice says the Theme uses them, never that they failed.
 * - It can miss uses. It follows only static imports of the Start modules
 *   into the module that calls them (aliased or namespaced imports
 *   included). It does not follow a re-export through another Theme module,
 *   a Start function stored in a variable or passed around, a computed
 *   member (`start["createServerFn"]`), a dynamic `import()` whose specifier
 *   is not a string literal or a template literal without substitutions,
 *   `createMiddleware().server(…)` (server middleware), or route options
 *   that are spread into `createFileRoute(path)({ ...options })`. A Theme
 *   can therefore use server code this does not report; an empty result is
 *   not proof that it uses none.
 * - It is bounded. A file over `MAX_CLIENT_ONLY_PREVIEW_FILE_BYTES`, the
 *   files past `MAX_CLIENT_ONLY_PREVIEW_TOTAL_BYTES`, and a file it cannot
 *   parse or finish reading (a syntax error, or input deep enough to exhaust
 *   the parser) are skipped, and the result says it is incomplete instead
 *   of reading as "nothing found". It never throws.
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

/**
 * The largest source file read, in UTF-8 bytes (256 KiB). Hand-written Theme
 * modules are far smaller; a file this large is generated or vendored, and
 * reading it would cost the preview start more than the notice is worth.
 */
export const MAX_CLIENT_ONLY_PREVIEW_FILE_BYTES = 256 * 1024;

/**
 * The most source read for one start, in UTF-8 bytes (4 MiB), files taken in
 * path order. Bounds the start's cost on a very large Theme.
 */
export const MAX_CLIENT_ONLY_PREVIEW_TOTAL_BYTES = 4 * 1024 * 1024;

/** What the analysis found, and whether it could read everything it meant to. */
export type ThemeClientOnlyPreviewLimitsResult = Readonly<{
  /** Ordered by file and line, at most `MAX_CLIENT_ONLY_PREVIEW_LIMITS`. */
  limits: readonly ThemeClientOnlyPreviewLimit[];
  /** How many more were found than `limits` lists. */
  omitted: number;
  /**
   * Some source file was not read, or not read to the end: over a byte
   * limit, unparsable, or the analysis failed on it. `limits` is then only
   * what the rest showed.
   */
  incomplete: boolean;
}>;

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

/** A string literal, or a template literal without substitutions. */
function staticSpecifier(node: any): string | undefined {
  if (node?.type === "StringLiteral") return node.value;
  if (
    node?.type === "TemplateLiteral" &&
    (node.expressions?.length ?? 0) === 0 &&
    node.quasis?.length === 1
  ) {
    const cooked = node.quasis[0]?.value?.cooked;
    return typeof cooked === "string" ? cooked : undefined;
  }
  return undefined;
}

/** UTF-8 length, without allocating; stops counting past `limit`. */
function utf8ByteLength(text: string, limit: number): number {
  // Every UTF-16 unit is at least one byte.
  if (text.length > limit) return limit + 1;
  let bytes = 0;
  for (let index = 0; index < text.length && bytes <= limit; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}

/** Binding names a declaration pattern introduces (`const { a, b: [c] } = …`). */
function patternNames(pattern: any, names: Set<string>): void {
  const stack = [pattern];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    switch (node.type) {
      case "Identifier":
        names.add(node.name);
        break;
      case "ObjectPattern":
        for (const property of node.properties ?? []) {
          stack.push(property.type === "RestElement" ? property.argument : property.value);
        }
        break;
      case "ArrayPattern":
        stack.push(...(node.elements ?? []));
        break;
      case "AssignmentPattern":
        stack.push(node.left);
        break;
      case "RestElement":
        stack.push(node.argument);
        break;
    }
  }
}

/**
 * Names the module declares at its top level. A top-level `createServerFn`
 * is the author's own function, not Start's, the same rule the import
 * protection applies to its safe boundaries.
 *
 * Only the top level: a nested `const start = …` or `const createServerFn =
 * …` shadows the import only inside its own scope, so it must not hide the
 * uses everywhere else in the file. Scopes are not modelled, so a call to
 * such a nested binding inside its scope is still reported
 * (over-approximation, stated in the module doc).
 */
function topLevelDeclaredNames(ast: any): Set<string> {
  const names = new Set<string>();
  for (const statement of ast.program?.body ?? []) {
    const declaration =
      (statement.type === "ExportNamedDeclaration" ||
        statement.type === "ExportDefaultDeclaration") &&
      statement.declaration
        ? statement.declaration
        : statement;
    switch (declaration?.type) {
      case "FunctionDeclaration":
      case "ClassDeclaration":
      case "TSDeclareFunction":
      case "TSEnumDeclaration":
        if (declaration.id?.name) names.add(declaration.id.name);
        break;
      case "VariableDeclaration":
        for (const declarator of declaration.declarations ?? []) {
          patternNames(declarator.id, names);
        }
        break;
    }
  }
  return names;
}

/** The children of an AST node, for an iterative walk. */
function pushChildren(node: any, stack: any[]): void {
  for (const key in node) {
    if (key === "loc" || key === "start" || key === "end" || key === "extra") {
      continue;
    }
    const value = node[key];
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        const child = value[index];
        if (child && typeof child === "object") stack.push(child);
      }
    } else {
      stack.push(value);
    }
  }
}

/** Uses in one parsed module. Throws only if the analysis itself fails. */
function collectModuleLimits(path: string, ast: any): ThemeClientOnlyPreviewLimit[] {
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

  for (const name of topLevelDeclaredNames(ast)) {
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

  // Iterative: a deep member chain or deeply nested JSX must not exhaust the
  // call stack of the Worker answering the preview start.
  const stack: any[] = [ast.program];
  // Comments are shared between neighbouring nodes; read each node once.
  const seen = new Set<object>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (seen.has(node)) continue;
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
        isStartServerSource(staticSpecifier(node.arguments?.[0]))
      ) {
        limits.push({ file: path, line: lineOf(node), kind: "server-api", names: [] });
      }
    } else if (
      node.type === "ImportExpression" &&
      isStartServerSource(staticSpecifier(node.source))
    ) {
      limits.push({ file: path, line: lineOf(node), kind: "server-api", names: [] });
    }
    pushChildren(node, stack);
  }

  for (const serverImport of serverApiImports) {
    if (moduleImportUsesOnlySafeBoundary(ast, serverImport.source, "client")) {
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

function eligibleSourcePath(path: string): boolean {
  return (
    isThemeSourceModulePath(path) &&
    !path.endsWith(".d.ts") &&
    !path.split("/").includes("node_modules")
  );
}

/**
 * Every use in these Theme files of something the client-only Live Preview
 * cannot run, within the byte limits. Files without text content (binary
 * files) and non-module files are not source and are not counted as
 * skipped. Each file is parsed once. Never throws: a file that cannot be
 * read to the end marks the result incomplete.
 *
 * For TanStack Start Themes only; the caller decides that.
 */
export function collectThemeClientOnlyPreviewLimits(
  files: ReadonlyArray<Readonly<{ path: string; content?: unknown }>>,
): ThemeClientOnlyPreviewLimitsResult {
  const sources: Array<{ path: string; content: string }> = [];
  for (const file of files) {
    if (typeof file.content !== "string") continue;
    const path = file.path.replace(/\\/g, "/").replace(/^\.\//, "");
    if (eligibleSourcePath(path)) sources.push({ path, content: file.content });
  }
  sources.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  let incomplete = false;
  let budget = MAX_CLIENT_ONLY_PREVIEW_TOTAL_BYTES;
  const limits: ThemeClientOnlyPreviewLimit[] = [];
  for (const source of sources) {
    const bytes = utf8ByteLength(
      source.content,
      MAX_CLIENT_ONLY_PREVIEW_FILE_BYTES,
    );
    if (bytes > MAX_CLIENT_ONLY_PREVIEW_FILE_BYTES || bytes > budget) {
      incomplete = true;
      continue;
    }
    budget -= bytes;
    try {
      // A syntax error is the compiler's to report; here it only means the
      // file was not read.
      const ast = parseThemeSourceModule(source.content);
      limits.push(...collectModuleLimits(source.path, ast));
    } catch {
      incomplete = true;
    }
  }

  const unique = new Map<string, ThemeClientOnlyPreviewLimit>();
  for (const limit of limits) {
    const key = `${limit.file}:${limit.line}:${limit.kind}`;
    if (!unique.has(key)) unique.set(key, limit);
  }
  const ordered = [...unique.values()].sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1,
  );
  return {
    limits: ordered.slice(0, MAX_CLIENT_ONLY_PREVIEW_LIMITS),
    omitted: Math.max(0, ordered.length - MAX_CLIENT_ONLY_PREVIEW_LIMITS),
    incomplete,
  };
}

/** The only framework whose preview has a client-only and a full Start mode. */
const TANSTACK_START_FRAMEWORK_ID: ThemeFrameworkId = "tanstack-start";

/**
 * What a start response says about the Live Preview runtime that served it.
 *
 * Only a TanStack Start Theme gets these fields: `previewRuntime` names the
 * full Start server or the default client-only build, and for the
 * client-only one `clientOnlyLimits` lists where the Theme uses what that
 * build cannot run (`clientOnlyLimitsOmitted` more were found than listed;
 * `clientOnlyLimitsIncomplete` some source could not be read, so the list
 * is partial). `start` lists none.
 *
 * Any other framework (Astro), and a framework that did not resolve, gets
 * none of them. "Client-only" and "full Start" are not modes those previews
 * have, so the start says nothing rather than something that reads like one.
 * A reader treats a missing field as "nothing to say", never as a mode.
 */
export type ThemePreviewRuntimeReport =
  | Readonly<{
      previewRuntime: "client";
      clientOnlyLimits: readonly ThemeClientOnlyPreviewLimit[];
      clientOnlyLimitsOmitted: number;
      clientOnlyLimitsIncomplete: boolean;
    }>
  | Readonly<{
      previewRuntime: "start";
      clientOnlyLimits: readonly ThemeClientOnlyPreviewLimit[];
      clientOnlyLimitsOmitted?: never;
      clientOnlyLimitsIncomplete?: never;
    }>
  | Readonly<{
      previewRuntime?: never;
      clientOnlyLimits?: never;
      clientOnlyLimitsOmitted?: never;
      clientOnlyLimitsIncomplete?: never;
    }>;

/**
 * What a Live Preview start tells the editor about the runtime it used, read
 * from the same files the start previews. Never changes how the preview
 * runs: the author is told, and nothing is switched for them. Never throws:
 * the preview has already started when this runs, and a failed analysis is
 * reported as incomplete, not as "nothing found".
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
  let result: ThemeClientOnlyPreviewLimitsResult;
  try {
    result = collectThemeClientOnlyPreviewLimits(input.files);
  } catch {
    result = { limits: [], omitted: 0, incomplete: true };
  }
  return {
    previewRuntime: "client",
    clientOnlyLimits: result.limits,
    clientOnlyLimitsOmitted: result.omitted,
    clientOnlyLimitsIncomplete: result.incomplete,
  };
}
