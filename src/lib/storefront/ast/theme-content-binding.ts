/**
 * The page-object spelling of a content binding.
 *
 *   const home = await morph.pages.get("/");
 *   <Hero {...home.hero} />
 *   <Gallery {...home["summer-sale"]} />
 *
 * `<Hero {...content("hero")} />` stays the other spelling. Both name the slot
 * at the call site, which is what the editor needs: the section stays one
 * self-contained element, so adding, moving or removing it never has to edit a
 * second place. That is why this is member access and not destructuring — a
 * destructuring pattern is shared by every section on the page.
 *
 * Only a literal key on a variable whose declaration is a literal
 * `await morph.pages.get("…")` counts. Anything the analysis cannot resolve
 * statically is not a binding, and callers treat it as unbound rather than
 * guess from a variable name.
 */

import { parseThemeSourceAst } from "./theme-source-ast";

const CONTENT_MODULE_SPECIFIER = /(?:^|\/)morph\/content(?:\.[cm]?[jt]sx?)?$/;

type AnyNode = any;

type LoaderBindingInput = Readonly<{
  path: string;
  files: readonly LoaderBindingFile[];
  /** Operation-scoped AST lookup supplied by callers that already parsed sources. */
  parsedAstFor?: (path: string, content: string) => AnyNode | null;
}>;

export function walk(node: AnyNode, visit: (node: AnyNode) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    walk(value, visit);
  }
}

/** The local names `morph` is imported under from the Theme content module. */
function morphLocalNames(ast: AnyNode): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of ast?.program?.body ?? []) {
    if (
      statement?.type !== "ImportDeclaration" ||
      typeof statement.source?.value !== "string" ||
      !CONTENT_MODULE_SPECIFIER.test(statement.source.value)
    ) {
      continue;
    }
    for (const specifier of statement.specifiers ?? []) {
      const imported = specifier.imported?.name ?? specifier.imported?.value;
      if (
        specifier?.type === "ImportSpecifier" &&
        imported === "morph" &&
        specifier.local?.type === "Identifier"
      ) {
        names.add(specifier.local.name);
      }
    }
  }
  return names;
}

function isPagesGetCall(call: AnyNode, morphNames: ReadonlySet<string>) {
  const callee = call?.callee;
  return (
    call?.type === "CallExpression" &&
    callee?.type === "MemberExpression" &&
    !callee.computed &&
    callee.property?.name === "get" &&
    callee.object?.type === "MemberExpression" &&
    !callee.object.computed &&
    callee.object.property?.name === "pages" &&
    callee.object.object?.type === "Identifier" &&
    morphNames.has(callee.object.object.name) &&
    call.arguments?.length === 1 &&
    call.arguments[0]?.type === "StringLiteral"
  );
}

/**
 * The props a section's call site sets in place of what its content spread
 * hands over, or `"any"` when which ones is only known at runtime.
 *
 * JSX builds one props object left to right, so an attribute after the spread
 * replaces the spread's prop of that name, whatever the stored content holds:
 * `<Hero {...content("hero")} title={other.title} />` shows `other.title`.
 * A later spread may set any prop. Children given between the tags replace
 * `children`. An attribute before the spread is replaced by the spread
 * whenever the stored content has that field — which is when a write to it
 * lands — so it is a default, like the component's own, and replaces nothing.
 */
export function propsReplacingSpread(
  element: AnyNode,
  spread: AnyNode,
): ReadonlySet<string> | "any" {
  const replaced = new Set<string>();
  const attributes: AnyNode[] = element?.openingElement?.attributes ?? [];
  const at = attributes.indexOf(spread);
  for (const attribute of attributes.slice(at + 1)) {
    if (attribute?.type === "JSXSpreadAttribute") return "any";
    if (attribute?.type !== "JSXAttribute") return "any";
    if (attribute.name?.type !== "JSXIdentifier") continue;
    if (attribute.name.name === "key") continue;
    replaced.add(attribute.name.name);
  }
  // React drops whitespace-only text that spans a line break; anything else
  // between the tags is a child.
  const hasChildren = (element?.children ?? []).some((child: AnyNode) =>
    child?.type === "JSXText"
      ? !(child.value.trim() === "" && child.value.includes("\n"))
      : !(
          child?.type === "JSXExpressionContainer" &&
          child.expression?.type === "JSXEmptyExpression"
        ),
  );
  if (hasChildren) replaced.add("children");
  return replaced;
}

/**
 * Variables declared as `const x = await morph.pages.get("/path")`.
 *
 * Name-based, with no scope tracking: two functions in one route that both
 * name their page `home` resolve to the same set, which is only wrong if they
 * read different paths — and the route is then reading two pages, which the
 * section model does not support yet.
 */
export function collectPageVariables(ast: AnyNode): ReadonlySet<string> {
  const morphNames = morphLocalNames(ast);
  const variables = new Set<string>();
  if (morphNames.size === 0) return variables;
  walk(ast?.program, (node) => {
    if (
      node?.type === "VariableDeclarator" &&
      node.id?.type === "Identifier" &&
      node.init?.type === "AwaitExpression" &&
      isPagesGetCall(node.init.argument, morphNames)
    ) {
      variables.add(node.id.name);
    }
  });
  return variables;
}

export const NO_PAGE_VARIABLES: ReadonlySet<string> = new Set();

function isPageMember(
  expression: AnyNode,
  pageVariables: ReadonlySet<string>,
): boolean {
  return (
    expression?.type === "MemberExpression" &&
    expression.object?.type === "Identifier" &&
    pageVariables.has(expression.object.name)
  );
}

/**
 * The key a spread reads off a page variable: `home.hero` or `home["hero"]`.
 * Not validated as a slot id — each caller already has its own rule for that.
 */
export function readPageBindingKey(
  expression: AnyNode,
  pageVariables: ReadonlySet<string>,
): string | null {
  if (!isPageMember(expression, pageVariables)) return null;
  const property = expression.property;
  if (expression.computed) {
    return property?.type === "StringLiteral" ? property.value : null;
  }
  return property?.type === "Identifier" ? property.name : null;
}

/** Whether the expression reads from a page variable at all, valid key or not. */
export function isPageBindingExpression(
  expression: AnyNode,
  pageVariables: ReadonlySet<string>,
): boolean {
  return isPageMember(expression, pageVariables);
}

/**
 * The loader spelling of a content binding (content binding contract §5.1).
 *
 *   const getHome = createServerFn().handler(() => morph.pages.get("/"));
 *   export const Route = createFileRoute("/")({ loader: () => getHome(), component: Home });
 *   function Home() {
 *     const { hero } = Route.useLoaderData();
 *     return <Hero {...hero} />;
 *   }
 *
 * The page is read on the server and handed to the component through the
 * route's loader, so the slot is not named at the call site the way the other
 * two spellings name it. It is still provable, link by link, when every link
 * passes the value on as it is: the handler returns the read, the loader
 * returns the handler's result, the component destructures it, and the call
 * site spreads one slot and nothing else. Any link that does more — a
 * computed path, a transformation, a wrapper, a default, a second name for the
 * same thing — breaks the proof, and the element is simply not bound.
 *
 * Returns the bound call sites by the start offset of their JSX element.
 * Callers look an element up there before trying the other two spellings.
 */
export type LoaderSlotBindings = ReadonlyMap<number, string>;

export const NO_LOADER_SLOT_BINDINGS: LoaderSlotBindings = new Map();

/**
 * Where the page a bound call site's slot came from can be read at that call
 * site, for the one thing the preview needs from it besides the slot: whether
 * the author hid it. A hidden slot is left out of the page and listed in its
 * `_hidden` (`morph.pages.get`), so `<Hero {...hero} />` renders the
 * component's defaults, and the editor must not offer them as the section's
 * content (content binding contract §6).
 *
 * - `pattern`: the slot was destructured from `Route.useLoaderData()`; `start`
 *   is the offset of that object pattern's `{`.
 * - `local`: the whole page is held in a local, read as `home.hero`.
 */
export type LoaderSlotPage =
  | Readonly<{ kind: "pattern"; start: number }>
  | Readonly<{ kind: "local"; name: string }>;

export type LoaderSlotBindingDetails = ReadonlyMap<
  number,
  Readonly<{ slot: string; page: LoaderSlotPage }>
>;

const NO_LOADER_SLOT_BINDING_DETAILS: LoaderSlotBindingDetails = new Map();

const START_MODULE = "@tanstack/react-start";
const ROUTER_MODULE = "@tanstack/react-router";

type LoaderBindingFile = Readonly<{ path: string; content?: string | null }>;

const CONTENT_MODULE_PATH = "src/morph/content.ts";

/**
 * What a relative Theme import is tried as, in order. Route section derivation
 * resolves its imports through `resolveThemeSourceImport` too, so the section
 * list, the preview's wrapper and this analysis never read one import as two
 * different files.
 */
const THEME_IMPORT_SUFFIXES = [
  "",
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  "/index.tsx",
  "/index.ts",
  "/index.jsx",
  "/index.js",
] as const;

/** `a/./b/../c` → `a/c`; `""` when it climbs above the root. */
export function normalizeThemeSourcePath(path: string): string {
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

/** The path a relative import names before any suffix, inside `src/`; else null. */
export function themeImportBase(
  fromPath: string,
  specifier: string,
): string | null {
  if (!specifier.startsWith(".")) return null;
  const from = normalizeThemeSourcePath(fromPath);
  const directory = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  const base = normalizeThemeSourcePath(`${directory}/${specifier}`);
  return base.startsWith("src/") ? base : null;
}

/** The Theme file a relative import resolves to, or null. */
export function resolveThemeSourceImport(
  fromPath: string,
  specifier: string,
  filePaths: ReadonlySet<string>,
): string | null {
  const base = themeImportBase(fromPath, specifier);
  if (!base) return null;
  for (const suffix of THEME_IMPORT_SUFFIXES) {
    if (filePaths.has(`${base}${suffix}`)) return `${base}${suffix}`;
  }
  return null;
}

/**
 * The one local name a value import of `importedName` from `moduleName` is
 * bound to, or null: not imported, imported only as a type, imported under
 * two names, or the name declared again anywhere in the module (a parameter,
 * an inner `const`), so a use of it could mean something else.
 */
function valueImportLocal(
  ast: AnyNode,
  matches: (source: string) => boolean,
  importedName: string,
): string | null {
  const locals: string[] = [];
  for (const statement of ast?.program?.body ?? []) {
    if (
      statement?.type !== "ImportDeclaration" ||
      statement.importKind === "type" ||
      typeof statement.source?.value !== "string" ||
      !matches(statement.source.value)
    ) {
      continue;
    }
    for (const specifier of statement.specifiers ?? []) {
      if (
        specifier?.type !== "ImportSpecifier" ||
        specifier.importKind === "type" ||
        specifier.local?.type !== "Identifier"
      ) {
        continue;
      }
      const imported = specifier.imported?.name ?? specifier.imported?.value;
      if (imported === importedName) locals.push(specifier.local.name);
    }
  }
  if (locals.length !== 1) return null;
  return declarationCounts(ast).get(locals[0]!) === 1 ? locals[0]! : null;
}

/** `morph`, imported from the file that is the Theme's content module. */
function contentModuleMorph(
  ast: AnyNode,
  modulePath: string,
  filePaths: ReadonlySet<string>,
): ReadonlySet<string> {
  const local = valueImportLocal(
    ast,
    (source) =>
      resolveThemeSourceImport(modulePath, source, filePaths) ===
      CONTENT_MODULE_PATH,
    "morph",
  );
  return local ? new Set([local]) : new Set();
}

/** The single value a function hands back, ignoring one `await`. */
function returnedExpression(fn: AnyNode): AnyNode | null {
  if (
    fn?.type !== "ArrowFunctionExpression" &&
    fn?.type !== "FunctionExpression"
  ) {
    return null;
  }
  if ((fn.params ?? []).length > 0) return null;
  const unwrap = (expression: AnyNode) =>
    expression?.type === "AwaitExpression" ? expression.argument : expression;
  if (fn.body?.type !== "BlockStatement") return unwrap(fn.body);
  const body: AnyNode[] = fn.body.body ?? [];
  if (body.length === 1 && body[0]?.type === "ReturnStatement") {
    return unwrap(body[0].argument);
  }
  return null;
}

/**
 * The page path a server function's handler returns, read as it is:
 * `morph.pages.get("…")`, directly or through one `const` it then returns.
 * No middleware or validators: the builder must be `createServerFn(…)` with
 * `.handler(…)` called on it directly.
 */
function serverFunctionPagePath(
  init: AnyNode,
  createServerFnName: string | null,
  morphNames: ReadonlySet<string>,
): string | null {
  const handlerCall = init;
  const builder = handlerCall?.callee?.object;
  if (
    !createServerFnName ||
    handlerCall?.type !== "CallExpression" ||
    handlerCall.callee?.type !== "MemberExpression" ||
    handlerCall.callee.computed ||
    handlerCall.callee.property?.name !== "handler" ||
    handlerCall.arguments?.length !== 1 ||
    builder?.type !== "CallExpression" ||
    builder.callee?.type !== "Identifier" ||
    builder.callee.name !== createServerFnName
  ) {
    return null;
  }
  const handler = handlerCall.arguments[0];
  const pageRead = (expression: AnyNode) =>
    isPagesGetCall(expression, morphNames) ? expression.arguments[0].value : null;

  const direct = returnedExpression(handler);
  if (direct) return pageRead(direct);

  // `const page = await morph.pages.get("…"); return page;`
  if (
    (handler?.type !== "ArrowFunctionExpression" &&
      handler?.type !== "FunctionExpression") ||
    (handler.params ?? []).length > 0 ||
    handler.body?.type !== "BlockStatement"
  ) {
    return null;
  }
  const [declaration, returned] = handler.body.body ?? [];
  if (
    handler.body.body?.length !== 2 ||
    declaration?.type !== "VariableDeclaration" ||
    declaration.kind !== "const" ||
    declaration.declarations?.length !== 1 ||
    declaration.declarations[0].id?.type !== "Identifier" ||
    declaration.declarations[0].init?.type !== "AwaitExpression" ||
    returned?.type !== "ReturnStatement" ||
    returned.argument?.type !== "Identifier" ||
    returned.argument.name !== declaration.declarations[0].id.name
  ) {
    return null;
  }
  return pageRead(declaration.declarations[0].init.argument);
}

/** `const <name> = …` at the top level of a module, and whether it is exported. */
function topLevelConst(
  ast: AnyNode,
  name: string,
): { init: AnyNode; exported: boolean } | null {
  for (const statement of ast?.program?.body ?? []) {
    const exported = statement?.type === "ExportNamedDeclaration";
    const declaration = exported ? statement.declaration : statement;
    if (
      declaration?.type !== "VariableDeclaration" ||
      declaration.kind !== "const"
    ) {
      continue;
    }
    for (const declarator of declaration.declarations ?? []) {
      if (declarator.id?.type === "Identifier" && declarator.id.name === name) {
        return { init: declarator.init, exported };
      }
    }
  }
  return null;
}

function parseModule(content: string, path: string): AnyNode | null {
  const result = parseThemeSourceAst({ path, content });
  return result.ok ? result.ast : null;
}

/**
 * The page path the server function named `name` reads: defined in the route
 * file, or exported as `export const` from a Theme source file the route
 * imports by a relative path. One hop only — no re-exports, aliases or
 * packages.
 */
function serverFunctionPagePathFor(
  ast: AnyNode,
  name: string,
  routePath: string,
  files: readonly LoaderBindingFile[],
  parsedAstFor?: (path: string, content: string) => AnyNode | null,
): string | null {
  const filePaths = new Set(files.map((file) => file.path));
  const createServerFnIn = (module: AnyNode) =>
    valueImportLocal(module, (source) => source === START_MODULE, "createServerFn");

  // Defined here, once.
  const local = topLevelConst(ast, name);
  if (local) {
    if (declarationCounts(ast).get(name) !== 1) return null;
    return serverFunctionPagePath(
      local.init,
      createServerFnIn(ast),
      contentModuleMorph(ast, routePath, filePaths),
    );
  }

  // Or imported by name from a Theme file one relative import away, which
  // declares it there as `export const`.
  let found: { sourcePath: string; imported: string } | null = null;
  for (const statement of ast?.program?.body ?? []) {
    if (
      statement?.type !== "ImportDeclaration" ||
      statement.importKind === "type" ||
      typeof statement.source?.value !== "string"
    ) {
      continue;
    }
    for (const specifier of statement.specifiers ?? []) {
      if (specifier?.local?.name !== name) continue;
      const imported = specifier.imported?.name ?? specifier.imported?.value;
      const sourcePath = resolveThemeSourceImport(
        routePath,
        statement.source.value,
        filePaths,
      );
      if (
        specifier.type !== "ImportSpecifier" ||
        specifier.importKind === "type" ||
        typeof imported !== "string" ||
        !sourcePath ||
        found
      ) {
        return null;
      }
      found = { sourcePath, imported };
    }
  }
  if (!found || declarationCounts(ast).get(name) !== 1) return null;
  const { sourcePath, imported } = found;
  const content = files.find((file) => file.path === sourcePath)?.content;
  if (typeof content !== "string") return null;
  const module = parsedAstFor
    ? parsedAstFor(sourcePath, content)
    : parseModule(content, sourcePath);
  const exported = module ? topLevelConst(module, imported) : null;
  if (
    !module ||
    !exported?.exported ||
    declarationCounts(module).get(imported) !== 1
  ) {
    return null;
  }
  return serverFunctionPagePath(
    exported.init,
    createServerFnIn(module),
    contentModuleMorph(module, sourcePath, filePaths),
  );
}

/**
 * A route path normalised the way content is looked up (`/` stays `/`, a
 * trailing slash goes), or null for a path that is not one fixed page: a
 * parameter, a pathless or grouped segment.
 */
function staticPagePath(path: string): string | null {
  if (!path.startsWith("/")) return null;
  const normalized = path.replace(/\/+$/, "") || "/";
  const segments = normalized.split("/").slice(1);
  if (
    segments.some(
      (segment) =>
        segment.startsWith("$") ||
        segment.startsWith("_") ||
        segment.startsWith("(") ||
        segment.includes("{"),
    )
  ) {
    return null;
  }
  return normalized;
}

/**
 * Proves that this route's own `useLoaderData()` is the page object returned
 * by its statically matched `createServerFn` loader. This is the route-root
 * proof is delegated to `collectLoaderSlotBindingDetails`: clone the parsed
 * route AST, replace only the selected component body with its recognized
 * loader-spread shape, and ask the same product analysis. This avoids parsing
 * a synthetic source string and keeps the product proof as the single source
 * of truth.
 */
export function hasProvenRouteLoaderPageOrigin(
  ast: AnyNode,
  input: LoaderBindingInput,
  expected: Readonly<{
    routeName: string;
    componentName: string;
  }>,
): boolean {
  try {
    const copy = structuredClone(ast);
    const component = (copy.program.body ?? [])
      .map((statement: AnyNode) =>
        statement?.type === "ExportNamedDeclaration"
          ? statement.declaration
          : statement,
      )
      .flatMap((declaration: AnyNode) => {
        if (declaration?.type === "FunctionDeclaration") {
          return [declaration.id?.name === expected.componentName ? declaration : null];
        }
        if (declaration?.type !== "VariableDeclaration") return [];
        return (declaration.declarations ?? []).map((item: AnyNode) =>
          item.id?.type === "Identifier" &&
          item.id.name === expected.componentName &&
          (item.init?.type === "ArrowFunctionExpression" ||
            item.init?.type === "FunctionExpression")
            ? item.init
            : null,
        );
      })
      .find((candidate: AnyNode) => candidate?.body?.type === "BlockStatement");
    if (!component) return false;

    const id = (name: string, start: number, end: number) => ({
      type: "Identifier",
      name,
      start,
      end,
    });
    const slot = "__morphB1LoaderProbe";
    const jsxStart = 100;
    const jsxEnd = 200;
    component.body.start = 0;
    component.body.end = 1000;
    component.body.body = [
      {
        type: "VariableDeclaration",
        kind: "const",
        start: 1,
        end: 80,
        declarations: [
          {
            type: "VariableDeclarator",
            start: 5,
            end: 75,
            id: {
              type: "ObjectPattern",
              start: 5,
              end: 40,
              properties: [
                {
                  type: "ObjectProperty",
                  start: 10,
                  end: 35,
                  key: id(slot, 10, 30),
                  value: id(slot, 31, 35),
                  shorthand: true,
                  computed: false,
                },
              ],
            },
            init: {
              type: "CallExpression",
              start: 45,
              end: 75,
              callee: {
                type: "MemberExpression",
                start: 45,
                end: 70,
                object: id(expected.routeName, 45, 55),
                property: id("useLoaderData", 56, 69),
                computed: false,
                optional: false,
              },
              arguments: [],
              optional: false,
            },
          },
        ],
      },
      {
        type: "ReturnStatement",
        start: jsxStart,
        end: jsxEnd,
        argument: {
          type: "JSXElement",
          start: jsxStart,
          end: jsxEnd,
          openingElement: {
            type: "JSXOpeningElement",
            start: jsxStart,
            end: jsxEnd,
            name: { type: "JSXIdentifier", name: "__MorphB1Probe" },
            attributes: [
              {
                type: "JSXSpreadAttribute",
                start: jsxStart + 1,
                end: jsxEnd - 1,
                argument: id(slot, jsxStart + 5, jsxEnd - 5),
              },
            ],
            selfClosing: true,
          },
          closingElement: null,
          children: [],
        },
      },
    ];

    const details = collectLoaderSlotBindingDetails(copy, input);
    return details.get(jsxStart)?.slot === slot;
  } catch {
    return false;
  }
}

/** Every name a binding in this module declares, with how many times. */
export function declarationCounts(ast: AnyNode): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (name: unknown) => {
    if (typeof name === "string") counts.set(name, (counts.get(name) ?? 0) + 1);
  };
  const addPattern = (pattern: AnyNode): void => {
    if (!pattern) return;
    switch (pattern.type) {
      case "Identifier":
        add(pattern.name);
        return;
      case "ObjectPattern":
        for (const property of pattern.properties ?? []) {
          addPattern(
            property.type === "RestElement" ? property.argument : property.value,
          );
        }
        return;
      case "ArrayPattern":
        for (const element of pattern.elements ?? []) addPattern(element);
        return;
      case "AssignmentPattern":
        addPattern(pattern.left);
        return;
      case "RestElement":
        addPattern(pattern.argument);
        return;
      case "TSParameterProperty":
        addPattern(pattern.parameter);
        return;
    }
  };
  walk(ast?.program, (node) => {
    switch (node?.type) {
      case "VariableDeclarator":
        addPattern(node.id);
        return;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
      case "ClassMethod":
      case "ObjectMethod":
        if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression") {
          add(node.id?.name);
        }
        for (const param of node.params ?? []) addPattern(param);
        return;
      case "ClassDeclaration":
        add(node.id?.name);
        return;
      case "CatchClause":
        addPattern(node.param);
        return;
      case "ImportSpecifier":
      case "ImportDefaultSpecifier":
      case "ImportNamespaceSpecifier":
        add(node.local?.name);
        return;
    }
  });
  return counts;
}

/** The component function a route option names, defined in this module. */
function componentFunction(ast: AnyNode, name: string): AnyNode | null {
  for (const statement of ast?.program?.body ?? []) {
    const declaration =
      statement?.type === "ExportNamedDeclaration" ||
      statement?.type === "ExportDefaultDeclaration"
        ? statement.declaration
        : statement;
    if (
      declaration?.type === "FunctionDeclaration" &&
      declaration.id?.name === name
    ) {
      return declaration;
    }
  }
  const declared = topLevelConst(ast, name);
  return declared?.init?.type === "ArrowFunctionExpression" ||
    declared?.init?.type === "FunctionExpression"
    ? declared.init
    : null;
}

/** `<Route>.useLoaderData()`, called with nothing. */
function isUseLoaderDataCall(expression: AnyNode, routeName: string): boolean {
  const callee = expression?.callee;
  return (
    expression?.type === "CallExpression" &&
    (expression.arguments ?? []).length === 0 &&
    callee?.type === "MemberExpression" &&
    !callee.computed &&
    callee.object?.type === "Identifier" &&
    callee.object.name === routeName &&
    callee.property?.name === "useLoaderData"
  );
}

/**
 * The JSX element an expression is the only content spread of: the element's
 * attributes are that spread and, at most, a `key`. Anything else on the
 * element could override what the slot hands over.
 */
function soleSpreadElement(
  expression: AnyNode,
  parents: ReadonlyMap<AnyNode, AnyNode>,
): AnyNode | null {
  const spread = parents.get(expression);
  if (spread?.type !== "JSXSpreadAttribute" || spread.argument !== expression) {
    return null;
  }
  const opening = parents.get(spread);
  if (opening?.type !== "JSXOpeningElement") return null;
  const others = (opening.attributes ?? []).filter(
    (attribute: AnyNode) => attribute !== spread,
  );
  if (
    others.some(
      (attribute: AnyNode) =>
        attribute?.type !== "JSXAttribute" ||
        attribute.name?.type !== "JSXIdentifier" ||
        attribute.name.name !== "key",
    )
  ) {
    return null;
  }
  const element = parents.get(opening);
  return element?.type === "JSXElement" ? element : null;
}

export function parentMap(ast: AnyNode): Map<AnyNode, AnyNode> {
  const parents = new Map<AnyNode, AnyNode>();
  const visit = (node: AnyNode, parent: AnyNode) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, parent);
      return;
    }
    if (parent) parents.set(node, parent);
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      visit(value, node);
    }
  };
  visit(ast?.program, null);
  return parents;
}

/** Whether an identifier node is a reference to a variable, not a key or label. */
export function isReference(node: AnyNode, parent: AnyNode): boolean {
  if (node?.type !== "Identifier") return false;
  if (
    (parent?.type === "MemberExpression" ||
      parent?.type === "OptionalMemberExpression") &&
    parent.property === node &&
    !parent.computed
  ) {
    return false;
  }
  if (
    (parent?.type === "ObjectProperty" || parent?.type === "ObjectMethod") &&
    parent.key === node &&
    !parent.computed
  ) {
    return parent.value === node && parent.shorthand === true;
  }
  return true;
}

export function collectLoaderSlotBindings(
  ast: AnyNode,
  file: LoaderBindingInput,
): LoaderSlotBindings {
  const details = collectLoaderSlotBindingDetails(ast, file);
  if (details.size === 0) return NO_LOADER_SLOT_BINDINGS;
  return new Map([...details].map(([start, { slot }]) => [start, slot]));
}

/**
 * `collectLoaderSlotBindings`, with where each bound call site's page can be
 * read (`LoaderSlotPage`). One analysis: the slots are the same either way.
 */
export function collectLoaderSlotBindingDetails(
  ast: AnyNode,
  file: LoaderBindingInput,
): LoaderSlotBindingDetails {
  // Paths as the section derivation and the preview both name them, so the
  // two callers resolve every import the same way.
  const modulePath = normalizeThemeSourcePath(file.path);
  const files = file.files.map((candidate) => ({
    ...candidate,
    path: normalizeThemeSourcePath(candidate.path),
  }));

  const createFileRouteName = valueImportLocal(
    ast,
    (source) => source === ROUTER_MODULE,
    "createFileRoute",
  );
  if (!createFileRouteName) return NO_LOADER_SLOT_BINDING_DETAILS;

  // export const Route = createFileRoute("/…")({ loader, component }), once.
  const routes: Array<{ name: string; options: AnyNode; path: string }> = [];
  for (const statement of ast?.program?.body ?? []) {
    const declaration =
      statement?.type === "ExportNamedDeclaration" ? statement.declaration : null;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const declarator of declaration.declarations ?? []) {
      const init = declarator.init;
      const factory = init?.callee;
      if (
        declarator.id?.type === "Identifier" &&
        init?.type === "CallExpression" &&
        init.arguments?.length === 1 &&
        init.arguments[0]?.type === "ObjectExpression" &&
        factory?.type === "CallExpression" &&
        factory.callee?.type === "Identifier" &&
        factory.callee.name === createFileRouteName &&
        factory.arguments?.length === 1 &&
        factory.arguments[0]?.type === "StringLiteral"
      ) {
        routes.push({
          name: declarator.id.name,
          options: init.arguments[0],
          path: factory.arguments[0].value,
        });
      }
    }
  }
  if (routes.length !== 1) return NO_LOADER_SLOT_BINDING_DETAILS;
  const [{ name: routeName, options: routeOptions, path: routePath }] = routes as [
    { name: string; options: AnyNode; path: string },
  ];
  if (declarationCounts(ast).get(routeName) !== 1) {
    return NO_LOADER_SLOT_BINDING_DETAILS;
  }
  const pagePathOfRoute = staticPagePath(routePath);
  if (!pagePathOfRoute) return NO_LOADER_SLOT_BINDING_DETAILS;

  // The value an option has at runtime, when the object literal states it
  // once and plainly. A spread or a computed key could set any option; a
  // repeated key means the last one wins, not the first one read; a method
  // (`loader() {…}`) is not the shape proven below. Each of those leaves the
  // option unproven rather than read as a guess.
  const properties: AnyNode[] = routeOptions.properties ?? [];
  const optionsArePlain = properties.every(
    (property) =>
      (property?.type === "ObjectProperty" || property?.type === "ObjectMethod") &&
      !property.computed &&
      (property.key?.type === "Identifier" ||
        property.key?.type === "StringLiteral"),
  );
  const option = (key: string) => {
    if (!optionsArePlain) return null;
    const named = properties.filter(
      (property) => (property.key?.name ?? property.key?.value) === key,
    );
    return named.length === 1 && named[0]?.type === "ObjectProperty"
      ? named[0].value
      : null;
  };

  // loader: () => getHome()
  const loaderCall = returnedExpression(option("loader"));
  if (
    loaderCall?.type !== "CallExpression" ||
    loaderCall.callee?.type !== "Identifier" ||
    (loaderCall.arguments ?? []).length !== 0
  ) {
    return NO_LOADER_SLOT_BINDING_DETAILS;
  }
  const pagePath = serverFunctionPagePathFor(
    ast,
    loaderCall.callee.name,
    modulePath,
    files,
    file.parsedAstFor,
  );
  if (pagePath === null || staticPagePath(pagePath) !== pagePathOfRoute) {
    return NO_LOADER_SLOT_BINDING_DETAILS;
  }

  // component: Home, declared in this module.
  const componentName = option("component");
  const component =
    componentName?.type === "Identifier" &&
    declarationCounts(ast).get(componentName.name) === 1
      ? componentFunction(ast, componentName.name)
      : null;
  if (component?.body?.type !== "BlockStatement") {
    return NO_LOADER_SLOT_BINDING_DETAILS;
  }

  // const { hero } = Route.useLoaderData();   → slot locals
  // const home = Route.useLoaderData();       → page locals, read as home.hero
  const slotLocals = new Map<string, { slot: string; patternStart: number }>();
  const pageLocals = new Set<string>();
  for (const statement of component.body.body ?? []) {
    if (
      statement?.type !== "VariableDeclaration" ||
      statement.kind !== "const"
    ) {
      continue;
    }
    for (const declarator of statement.declarations ?? []) {
      if (!isUseLoaderDataCall(declarator.init, routeName)) continue;
      if (declarator.id?.type === "Identifier") {
        pageLocals.add(declarator.id.name);
        continue;
      }
      if (declarator.id?.type !== "ObjectPattern") continue;
      const pattern: AnyNode[] = declarator.id.properties ?? [];
      // A rest element or anything but a plain `key` / `key: local` makes the
      // whole pattern unprovable: defaults, nested patterns, computed keys.
      const plain = pattern.every(
        (property) =>
          property?.type === "ObjectProperty" &&
          !property.computed &&
          (property.key?.type === "Identifier" ||
            property.key?.type === "StringLiteral") &&
          property.value?.type === "Identifier",
      );
      if (!plain) continue;
      for (const property of pattern) {
        slotLocals.set(property.value.name, {
          slot: property.key.name ?? property.key.value,
          patternStart: declarator.id.start,
        });
      }
    }
  }
  if (slotLocals.size === 0 && pageLocals.size === 0) {
    return NO_LOADER_SLOT_BINDING_DETAILS;
  }

  // A local is the loader's only while it is the only thing in the module
  // with that name: no inner scope redeclares it, no parameter or import
  // shares it. The analysis does not track scopes, so a second declaration
  // anywhere refuses the name rather than guessing which one a use means.
  const declarations = declarationCounts(ast);
  const parents = parentMap(ast);
  const insideComponent = (node: AnyNode) =>
    node.start >= component.body.start && node.end <= component.body.end;

  const elements = new Map<
    number,
    Readonly<{ slot: string; page: LoaderSlotPage }>
  >();
  const slotUses = new Map<string, number>();
  const bind = (element: AnyNode, slot: string, page: LoaderSlotPage) => {
    elements.set(element.start, { slot, page });
    slotUses.set(slot, (slotUses.get(slot) ?? 0) + 1);
  };

  const referencesOf = (name: string) => {
    const found: AnyNode[] = [];
    walk(ast?.program, (node) => {
      if (node?.type === "Identifier" && node.name === name) {
        const parent = parents.get(node);
        // The declaration's own binding is not a use.
        if (
          parent?.type === "VariableDeclarator" &&
          parent.id === node
        ) {
          return;
        }
        if (
          parent?.type === "ObjectProperty" &&
          parent.value === node &&
          parents.get(parent)?.type === "ObjectPattern"
        ) {
          return;
        }
        if (isReference(node, parent)) found.push(node);
      }
    });
    return found;
  };

  for (const [local, { slot, patternStart }] of slotLocals) {
    if (declarations.get(local) !== 1) continue;
    const uses = referencesOf(local);
    // Exactly one use, and it is the element's only content spread. Any other
    // read or write — `hero.title`, `hero = …`, a second element — and the
    // value the component gets is no longer provably the slot's.
    if (uses.length !== 1) continue;
    const element = soleSpreadElement(uses[0], parents);
    if (!element || !insideComponent(element)) continue;
    bind(element, slot, { kind: "pattern", start: patternStart });
  }

  for (const local of pageLocals) {
    if (declarations.get(local) !== 1) continue;
    const uses = referencesOf(local);
    const bound: Array<[AnyNode, string]> = [];
    const allProvable = uses.every((use) => {
      const member = parents.get(use);
      if (
        member?.type !== "MemberExpression" ||
        member.object !== use ||
        (member.computed
          ? member.property?.type !== "StringLiteral"
          : member.property?.type !== "Identifier")
      ) {
        return false;
      }
      const element = soleSpreadElement(member, parents);
      if (!element || !insideComponent(element)) return false;
      bound.push([
        element,
        member.computed ? member.property.value : member.property.name,
      ]);
      return true;
    });
    if (!allProvable) continue;
    for (const [element, slot] of bound) {
      bind(element, slot, { kind: "local", name: local });
    }
  }

  // One slot, one element: two places showing the same slot cannot say which
  // one a click is on.
  for (const [start, { slot }] of elements) {
    if ((slotUses.get(slot) ?? 0) > 1) elements.delete(start);
  }
  return elements;
}
