/**
 * Scope-correct Theme section and field provenance. This derives editing
 * identity only; it grants no write authority. The server must independently
 * re-derive provenance before accepting a write.
 *
 * Per-prop provenance at a component call site, scope-correct:
 *
 *   <Hero title={title} desc={desc} />   from   const { title, desc } = hero;
 *
 * Every prop of every component call site in a route module is classified as
 * one of
 *
 * - `field`: the prop's value is provably the stored value of section `slot`,
 *   field `field` (a symbolic root `content("slot")` or the route's own
 *   loader data, read through immutable locals, destructuring and member
 *   reads only);
 * - `spread-field`: the same, but only when the spread object has that key at
 *   runtime; otherwise the earlier value (`otherwise`) shows. `title="X"
 *   {...hero}` is this: the literal shows when the stored section has no
 *   `title`;
 * - `literal`: written in the code;
 * - `unset`: never set at the call site (the component's default shows);
 * - `unknown`: not traced. Always with a reason.
 *
 * What this is NOT:
 *
 * - Not write permission. A `field` result is provenance only. Whether a
 *   write is allowed still comes from the declared `contentFields`, the
 *   request's authorization, the section's confirmed component, the source
 *   generation and the draft OCC (`b1-write-check.ts` composes with all of
 *   them; it replaces none).
 * - Not a proof of what the Theme's own `src/morph/content.ts` does. The root
 *   is the platform contract "content(slot) returns the stored props of
 *   `slot`"; an author who edits that module can break it. The loader root is
 *   proven link by link by the product's own route-loader proof (re-used, not
 *   re-implemented).
 * - Not an inter-procedural analysis: any value that passes through a call to
 *   an author function is `unknown`, and any use that could mutate a traced
 *   object (an assignment through any alias, `Object.assign`, passing it to a
 *   function, a method call on it) makes every claim at or under that path
 *   `unknown` — in every module of the Theme that can reach the same object.
 */
import {
  hasProvenRouteLoaderPageOrigin,
  normalizeThemeSourcePath,
  resolveThemeSourceImport,
} from "./theme-content-binding";
import {
  contentFieldsSidecarPath,
  readComponentContentFields,
} from "./theme-content-fields-declaration";
import {
  readComponentSourcePaths,
  resolveThemeContentCapabilitiesFromFiles,
} from "../theme-content-capability-resolver";
import {
  buildHandScopeOracle,
  type AnyNode,
  type B1Binding,
  type B1ScopeOracle,
} from "./b1-scope";
import {
  parseThemeSourceAst,
  type ThemeSourceAstResult,
  type ParsedThemeAst,
} from "./theme-source-ast";
import { isValidThemeContentSlotId } from "../theme-content-slots";

export type B1SourceFile = Readonly<{ path: string; content: string }>;

export type B1ScopeBackend = (ast: ParsedThemeAst) => B1ScopeOracle;

export type B1Root = "content" | "loader" | "page";

export type B1PropValue =
  | Readonly<{
      kind: "field";
      root: B1Root;
      slot: string;
      field: string;
      /** Page-object root path, when the value came from morph.pages.get(). */
      sourceRoute?: string;
      /** A section spread set it; the claim applies only if it owns the key. */
      viaSpread?: Readonly<{
        spread: Readonly<{ start: number; end: number }>;
        otherwiseLabel: string;
      }>;
    }>
  | Readonly<{
      kind: "spread-field";
      root: B1Root;
      slot: string;
      field: string;
      /** Page-object root path, when the value came from morph.pages.get(). */
      sourceRoute?: string;
      /** The spread attribute whose own keys decide, by its source range. */
      spread: Readonly<{ start: number; end: number }>;
      otherwise: B1PropValue;
    }>
  | Readonly<{
      /** The value is derived from one section, but is not a writable field. */
      kind: "derived";
      root: B1Root;
      slot: string;
      sourceRoute?: string;
      reason: string;
    }>
  | Readonly<{ kind: "literal" }>
  | Readonly<{ kind: "unset" }>
  | Readonly<{ kind: "unknown"; reason: string }>;

/** What one prop of one instance may be labelled with in Design. */
export type B1Claim =
  | Readonly<{
      kind: "claim";
      slot: string;
      field: string;
      /** Page Documents must match the route being edited. */
      sourceRoute?: string;
      /** Set when the claim holds only while the spread object has the key. */
      conditional: Readonly<{
        spread: Readonly<{ start: number; end: number }>;
        otherwiseLabel: string;
        /** False for a plain CMS spread: the editor may create a missing key. */
        requiresOwnKey: boolean;
      }> | null;
    }>
  | Readonly<{
      kind: "none";
      state: "literal" | "unset" | "derived" | "unknown";
      reason: string;
    }>;

export type B1WriteProvenanceFailure = Readonly<{
  field: string;
  reason: "unproven-source" | "source-key-absent";
}>;

/**
 * Validate the source proof for every requested writable Document field.
 * The caller supplies the server-resolved capability allowlist; provenance
 * never grants a field permission. A missing/ambiguous proof is a refusal.
 */
export function findB1WriteProvenanceFailure(args: {
  sectionId: string;
  allowedFields: ReadonlySet<string>;
  requestedFields: readonly string[];
  claimsByStoredField: ReadonlyMap<
    string,
    Extract<B1Claim, { kind: "claim" }> | null
  >;
  storedProps: Readonly<Record<string, unknown>> | null;
}): B1WriteProvenanceFailure | null {
  for (const field of args.requestedFields) {
    if (!args.allowedFields.has(field)) continue;
    const claim = args.claimsByStoredField.get(field);
    if (
      !claim ||
      claim.slot !== args.sectionId ||
      claim.field !== field
    ) {
      return { field, reason: "unproven-source" };
    }
    if (
      claim.conditional?.requiresOwnKey &&
      (!args.storedProps ||
        !Object.prototype.hasOwnProperty.call(args.storedProps, claim.field) ||
        args.storedProps[claim.field] === undefined)
    ) {
      return { field, reason: "source-key-absent" };
    }
  }
  return null;
}

export type B1Instance = Readonly<{
  routeFile: string;
  /** Source range of the JSX element in the route module. */
  start: number;
  end: number;
  /** Order among call sites of the same component name in the module. */
  nameIndex: number;
  componentName: string;
  componentPath: string | null;
  /** `default` or the named export the call site imports. */
  componentExport: string | null;
  /** Declared `contentFields` of the component (the props of interest). */
  declaredFields: readonly string[];
  /** Whether this call site explicitly writes a declared prop. */
  hasDeclaredCallsiteProps: boolean;
  /** Distinct section roots spread at this call site, in source order. */
  sourceSlots: readonly string[];
  /** Root kinds supplying those section spreads, in source order. */
  sourceRoots: readonly B1Root[];
  /** A spread whose object could not be traced to one section root. */
  hasUntracedSpread: boolean;
  props: Readonly<Record<string, B1PropValue>>;
  /** The section this instance is wrapped as, or null. */
  section: string | null;
  claims: Readonly<Record<string, B1Claim>>;
}>;

export type B1RouteAnalysis = Readonly<{
  routeFile: string;
  instances: readonly B1Instance[];
  /** Taint prefixes found anywhere in the Theme, for diagnostics. */
  taints: readonly string[];
  /** Whether the route's loader is proven to return `morph.pages.get(route)`. */
  loaderOrigin: boolean;
  diagnostics: readonly string[];
}>;

export type B1ParsedModules = ReadonlyMap<string, ParsedThemeAst>;

const CONTENT_MODULE_PATH = "src/morph/content.ts";
const ROUTER_MODULE = "@tanstack/react-router";
/** Router APIs that can hand any module the loader data of any route. */
const LOADER_DATA_APIS = new Set([
  "useLoaderData",
  "getRouteApi",
  "useMatch",
  "useMatches",
  "useParentMatches",
  "useChildMatches",
  "useRouterState",
  "useRouter",
  "useLoaderDeps",
]);
/** `Route.<hook>()` calls that cannot reach the loader data. */
const ROUTE_HOOKS_WITHOUT_DATA = new Set([
  "useParams",
  "useSearch",
  "useNavigate",
]);
const SCRIPT_FILE = /\.(tsx|jsx|ts|js|mjs|cjs)$/;

function parseModule(
  content: string,
  path = "<theme-module>",
): ParsedThemeAst | null {
  const result = parseThemeSourceAst({ path, content });
  return result.ok ? result.ast : null;
}

function createAnalysisSourceParser(
  files: readonly Readonly<{ path: string; content: string }>[],
  parsedModules?: B1ParsedModules,
): (path: string, content: string) => ThemeSourceAstResult {
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  const cache = new Map<string, { content: string; result: ThemeSourceAstResult }>();
  for (const [path, ast] of parsedModules ?? []) {
    const content = byPath.get(normalizeThemeSourcePath(path));
    if (content !== undefined) {
      cache.set(normalizeThemeSourcePath(path), {
        content,
        result: { ok: true, ast },
      });
    }
  }
  return (sourcePath, content) => {
    const path = normalizeThemeSourcePath(sourcePath);
    const cached = cache.get(path);
    if (cached?.content === content) return cached.result;
    const result = parseThemeSourceAst({ path, content });
    cache.set(path, { content, result });
    return result;
  };
}

const unknown = (reason: string): B1PropValue => ({ kind: "unknown", reason });

function moduleExportName(node: AnyNode | null | undefined): string | null {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "StringLiteral") return node.value;
  return null;
}

type TransparentExpressionNode = Extract<
  AnyNode,
  {
    type:
      | "TSAsExpression"
      | "TSSatisfiesExpression"
      | "TSNonNullExpression"
      | "TSTypeAssertion"
      | "ParenthesizedExpression";
  }
>;

function isTransparentExpression(
  node: AnyNode,
): node is TransparentExpressionNode {
  return (
    node.type === "TSAsExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "TSNonNullExpression" ||
    node.type === "TSTypeAssertion" ||
    node.type === "ParenthesizedExpression"
  );
}

function unwrapTs(node: AnyNode): AnyNode {
  let cursor = node;
  while (isTransparentExpression(cursor)) {
    cursor = cursor.expression;
  }
  return cursor;
}

type MemberNode = Extract<
  AnyNode,
  { type: "MemberExpression" | "OptionalMemberExpression" }
>;

function staticKey(member: MemberNode): string | null {
  if (member.computed) {
    return member.property?.type === "StringLiteral"
      ? member.property.value
      : null;
  }
  return member.property?.type === "Identifier" ? member.property.name : null;
}

function isMember(node: AnyNode | null | undefined): node is MemberNode {
  return (
    node?.type === "MemberExpression" ||
    node?.type === "OptionalMemberExpression"
  );
}

type CallNode = Extract<
  AnyNode,
  { type: "CallExpression" | "OptionalCallExpression" }
>;

function isCall(node: AnyNode | null | undefined): node is CallNode {
  return (
    node?.type === "CallExpression" || node?.type === "OptionalCallExpression"
  );
}

/** The keys from a declarator's pattern down to one identifier, or why not. */
function patternPathTo(
  pattern: AnyNode | null | undefined,
  target: AnyNode,
): { keys: string[] } | { reason: string } | null {
  if (pattern === target) return { keys: [] };
  if (pattern?.type === "AssignmentPattern") {
    const inner = patternPathTo(pattern.left, target);
    return inner
      ? { reason: "a destructuring default can replace the value" }
      : null;
  }
  if (pattern?.type === "ObjectPattern") {
    for (const property of pattern.properties ?? []) {
      if (property.type === "RestElement") {
        if (patternPathTo(property.argument, target)) {
          return { reason: "a rest element is a copy, not one field" };
        }
        continue;
      }
      const inner = patternPathTo(property.value, target);
      if (!inner) continue;
      if ("reason" in inner) return inner;
      const key = property.computed
        ? property.key?.type === "StringLiteral"
          ? property.key.value
          : null
        : property.key?.type === "Identifier"
          ? property.key.name
          : property.key?.type === "StringLiteral"
            ? property.key.value
            : null;
      if (key === null) return { reason: "a computed destructuring key" };
      return { keys: [key, ...inner.keys] };
    }
    return null;
  }
  if (pattern?.type === "ArrayPattern") {
    for (const element of pattern.elements ?? []) {
      if (element && patternPathTo(element, target)) {
        return { reason: "array destructuring is not traced" };
      }
    }
  }
  return null;
}

/**
 * One module's view: the imported `content`, the route's `Route`, and the
 * scope oracle. Shared by the taint pass and the resolver.
 */
type ModuleContext = {
  path: string;
  ast: ParsedThemeAst;
  oracle: B1ScopeOracle;
  contentBinding: B1Binding | null;
  morphBinding: B1Binding | null;
  sectionHiddenBinding: B1Binding | null;
  routeBinding: B1Binding | null;
  /** Whether `Route.useLoaderData()` is proven to be `morph.pages.get(route)`. */
  loaderOrigin: boolean;
  /** Static route path in `createFileRoute("/…")`, or null if unknown. */
  routePath: string | null;
};

function contentImportBinding(
  ctx: Pick<ModuleContext, "ast" | "oracle" | "path">,
  filePaths: ReadonlySet<string>,
): { binding: B1Binding | null; aliases: number } {
  let found: B1Binding | null = null;
  let aliases = 0;
  for (const statement of ctx.ast.program.body ?? []) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.importKind === "type" ||
      resolveThemeSourceImport(ctx.path, statement.source.value, filePaths) !==
        CONTENT_MODULE_PATH
    ) {
      continue;
    }
    for (const specifier of statement.specifiers ?? []) {
      if (
        specifier.type === "ImportSpecifier" &&
        specifier.importKind === "type"
      ) {
        continue;
      }
      if (specifier.type === "ImportNamespaceSpecifier") aliases += 1;
      if (specifier.type !== "ImportSpecifier") continue;
      const imported = moduleExportName(specifier.imported);
      if (imported !== "content") continue;
      aliases += 1;
      found = ctx.oracle.bindingOf(specifier.local);
    }
  }
  return { binding: aliases === 1 ? found : null, aliases };
}

function morphImportBinding(
  ctx: Pick<ModuleContext, "ast" | "oracle" | "path">,
  filePaths: ReadonlySet<string>,
): B1Binding | null {
  const bindings: B1Binding[] = [];
  for (const statement of ctx.ast.program.body ?? []) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.importKind === "type" ||
      resolveThemeSourceImport(ctx.path, statement.source.value, filePaths) !==
        CONTENT_MODULE_PATH
    ) {
      continue;
    }
    for (const specifier of statement.specifiers ?? []) {
      if (
        specifier.type === "ImportSpecifier" &&
        specifier.importKind !== "type" &&
        moduleExportName(specifier.imported) === "morph"
      ) {
        const binding = ctx.oracle.bindingOf(specifier.local);
        if (binding) bindings.push(binding);
      }
    }
  }
  return bindings.length === 1 ? bindings[0]! : null;
}

function sectionHiddenImportBinding(
  ctx: Pick<ModuleContext, "ast" | "oracle" | "path">,
  filePaths: ReadonlySet<string>,
): B1Binding | null {
  const bindings: B1Binding[] = [];
  for (const statement of ctx.ast.program.body ?? []) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.importKind === "type" ||
      resolveThemeSourceImport(ctx.path, statement.source.value, filePaths) !==
        CONTENT_MODULE_PATH
    ) {
      continue;
    }
    for (const specifier of statement.specifiers ?? []) {
      if (
        specifier.type === "ImportSpecifier" &&
        specifier.importKind !== "type" &&
        moduleExportName(specifier.imported) === "isSectionHidden"
      ) {
        const binding = ctx.oracle.bindingOf(specifier.local);
        if (binding) bindings.push(binding);
      }
    }
  }
  return bindings.length === 1 ? bindings[0]! : null;
}

/** `export const Route = createFileRoute("…")({ … })`, the binding. */
function routeBindingOf(ctx: Pick<ModuleContext, "ast" | "oracle">): {
  binding: B1Binding | null;
  componentName: string | null;
  routePath: string | null;
} {
  let createFileRoute: B1Binding | null = null;
  for (const statement of ctx.ast.program.body ?? []) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.source.value !== ROUTER_MODULE
    ) {
      continue;
    }
    for (const specifier of statement.specifiers ?? []) {
      if (
        specifier.type === "ImportSpecifier" &&
        moduleExportName(specifier.imported) === "createFileRoute"
      ) {
        createFileRoute = ctx.oracle.bindingOf(specifier.local);
      }
    }
  }
  if (!createFileRoute)
    return { binding: null, componentName: null, routePath: null };
  for (const statement of ctx.ast.program.body ?? []) {
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? statement.declaration
        : null;
    if (
      declaration?.type !== "VariableDeclaration" ||
      declaration.kind !== "const"
    ) {
      continue;
    }
    for (const declarator of declaration.declarations ?? []) {
      const init = declarator.init;
      if (
        declarator.id?.type === "Identifier" &&
        init?.type === "CallExpression" &&
        init.callee?.type === "CallExpression" &&
        init.callee.callee?.type === "Identifier" &&
        ctx.oracle.bindingOf(init.callee.callee) === createFileRoute
      ) {
        const binding = ctx.oracle.bindingOf(declarator.id);
        const options = init.arguments?.[0];
        const factory = init.callee;
        const routePathArg = factory.arguments?.[0];
        const component =
          options?.type === "ObjectExpression"
            ? options.properties.find(
                (property): property is Extract<
                  AnyNode,
                  { type: "ObjectProperty" }
                > =>
                  property.type === "ObjectProperty" &&
                  !property.computed &&
                  moduleExportName(property.key) === "component",
              )
            : undefined;
        return {
          binding,
          routePath:
            routePathArg?.type === "StringLiteral"
              ? normalizePagePath(routePathArg.value)
              : null,
          componentName:
            component?.value?.type === "Identifier"
              ? component.value.name
              : null,
        };
      }
    }
  }
  return { binding: null, componentName: null, routePath: null };
}

function normalizePagePath(path: string): string | null {
  if (!path.startsWith("/")) return null;
  const normalized = path.replace(/\/+$/, "") || "/";
  if (
    normalized.split("/").some((segment) =>
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
 * Whether the route's loader is the product's proven loader spelling. This
 * reuses the route-loader proof directly instead of synthesizing and parsing
 * a modified route.
 */
function provenLoaderOrigin(
  ctx: Pick<ModuleContext, "ast" | "oracle" | "path">,
  files: readonly B1SourceFile[],
  routeName: string,
  componentName: string | null,
  parsedAstFor: (path: string, content: string) => ThemeSourceAstResult,
): boolean {
  if (!componentName) return false;
  return hasProvenRouteLoaderPageOrigin(ctx.ast, {
    path: ctx.path,
    files: files.map((file) => ({ path: file.path, content: file.content })),
    parsedAstFor: (path, content) => {
      const result = parsedAstFor(path, content);
      return result.ok ? result.ast : null;
    },
  }, {
    routeName,
    componentName,
  });
}

// ---------------------------------------------------------------------------
// Taint: every use of a traced object that could change it.

/**
 * A taint is a path under a root and what may change there:
 *
 * - `set`: the value AT the path may be replaced (`x.title = …`, `delete`);
 *   every claim at, above or below it is affected.
 * - `in`: what is INSIDE the value at the path may change (it was handed to
 *   code this analysis does not follow: a call, a component prop, a store).
 *   A claim strictly inside it, or one that contains it, is affected; a claim
 *   on exactly that path is not, because B1 claims only `slot.field` leaves
 *   shown as text, and a component cannot change the string it was given.
 */
type TaintSet = Set<string>;

const taintKey = (
  root: B1Root,
  path: readonly string[] | null,
  kind: "set" | "in" = "in",
) => (path === null ? `${root}:*` : `${kind}|${root}:${path.join(".")}`);

/**
 * Taints indexed by root and first path key, built once the taint pass is
 * done (the set is not changed after), so a route with thousands of fields
 * does not compare every claim with every taint.
 */
const taintIndexes = new WeakMap<TaintSet, Map<string, string[][]>>();

function taintIndex(taints: TaintSet): Map<string, string[][]> {
  let index = taintIndexes.get(taints);
  if (index && (index.get("#size")?.[0]?.[0] ?? "") === String(taints.size))
    return index;
  index = new Map([["#size", [[String(taints.size)]]]]);
  for (const key of taints) {
    const bar = key.indexOf("|");
    if (bar < 0) continue;
    const kind = key.slice(0, bar);
    const rest = key.slice(bar + 1);
    const colon = rest.indexOf(":");
    const root = rest.slice(0, colon);
    const tainted = rest.slice(colon + 1);
    const prefix = tainted === "" ? [] : tainted.split(".");
    const bucket = `${root}:${prefix[0] ?? ""}`;
    const list = index.get(bucket) ?? [];
    list.push([kind, ...prefix]);
    index.set(bucket, list);
  }
  taintIndexes.set(taints, index);
  return index;
}

function isTainted(
  taints: TaintSet,
  root: B1Root,
  path: readonly string[],
): boolean {
  if (taints.has(`${root}:*`)) return true;
  const index = taintIndex(taints);
  // A root-level taint, or one under the same first key, can overlap.
  const candidates = [
    ...(index.get(`${root}:`) ?? []),
    ...(path.length > 0
      ? (index.get(`${root}:${path[0]}`) ?? [])
      : [...index.entries()]
          .filter(([bucket]) => bucket.startsWith(`${root}:`))
          .flatMap(([, list]) => list)),
  ];
  for (const [kind, ...prefix] of candidates) {
    const shorter = Math.min(prefix.length, path.length);
    let overlaps = true;
    for (let i = 0; i < shorter; i += 1) {
      if (prefix[i] !== path[i]) {
        overlaps = false;
        break;
      }
    }
    if (!overlaps) continue;
    if (kind === "set") return true;
    if (prefix.length !== path.length) return true;
  }
  return false;
}

function collectTaints(ctx: ModuleContext, taints: TaintSet): void {
  const { oracle } = ctx;
  const parentSkippingTs = (
    node: AnyNode,
  ): { node: AnyNode; parent: AnyNode | null } => {
    let cursor = node;
    let parent = oracle.parentOf(cursor);
    while (
      parent &&
      (parent.type === "TSAsExpression" ||
        parent.type === "TSSatisfiesExpression" ||
        parent.type === "TSNonNullExpression" ||
        parent.type === "TSTypeAssertion" ||
        parent.type === "ParenthesizedExpression") &&
      parent.expression === cursor
    ) {
      cursor = parent;
      parent = oracle.parentOf(cursor);
    }
    return { node: cursor, parent };
  };

  const visited = new Set<AnyNode>();
  /** Checks every use of the value `node` evaluates to (a traced object). */
  const checkUse = (
    start: AnyNode,
    root: B1Root,
    path: readonly string[] | null,
  ): void => {
    if (visited.has(start)) return;
    visited.add(start);
    const { node, parent } = parentSkippingTs(start);
    const taint = (at: readonly string[] | null): void => {
      taints.add(taintKey(root, at, "in"));
    };
    const replaced = (at: readonly string[] | null): void => {
      taints.add(taintKey(root, at, "set"));
    };
    if (!parent) return taint(path);
    switch (parent.type) {
      case "MemberExpression":
      case "OptionalMemberExpression": {
        if (parent.object !== node) return; // used as a computed key: a read
        const key = staticKey(parent);
        const child = path && key !== null ? [...path, key] : null;
        const grand = oracle.parentOf(parent);
        if (
          (grand?.type === "AssignmentExpression" && grand.left === parent) ||
          grand?.type === "UpdateExpression" ||
          (grand?.type === "UnaryExpression" && grand.operator === "delete") ||
          ((grand?.type === "ForInStatement" ||
            grand?.type === "ForOfStatement") &&
            grand.left === parent)
        ) {
          // `x.key = …`: this object's property changes.
          return replaced(child ?? path);
        }
        if (isCall(grand) && grand.callee === parent) {
          // `x.method()`: anything the method does to `x`.
          return taint(path);
        }
        return checkUse(parent, root, child);
      }
      case "VariableDeclarator": {
        if (parent.init !== node) return taint(path);
        const idPattern = parent.id;
        if (!idPattern) return taint(path);
        const ids: AnyNode[] = [];
        const collect = (pattern: AnyNode | null | undefined) => {
          if (!pattern) return;
          if (pattern.type === "Identifier") ids.push(pattern);
          else if (pattern.type === "ObjectPattern")
            for (const p of pattern.properties ?? [])
              collect(p.type === "RestElement" ? p.argument : p.value);
          else if (pattern.type === "ArrayPattern")
            for (const e of pattern.elements ?? []) collect(e);
          else if (pattern.type === "AssignmentPattern") collect(pattern.left);
          else if (pattern.type === "RestElement") collect(pattern.argument);
        };
        collect(idPattern);
        for (const id of ids) {
          const located = patternPathTo(idPattern, id);
          const idPath =
            path && located && "keys" in located
              ? [...path, ...located.keys]
              : path;
          const binding = oracle.bindingOf(id);
          if (!binding) {
            taint(path);
            continue;
          }
          for (const reference of binding.references) {
            if (binding.violations.includes(reference)) continue;
            checkUse(reference, root, idPath);
          }
        }
        return;
      }
      case "JSXSpreadAttribute":
      case "SpreadElement": {
        if (parent.type === "SpreadElement") {
          const container = oracle.parentOf(parent);
          if (container?.type !== "ObjectExpression") return taint(path);
        }
        // A shallow copy. The copy's own properties are new; values nested
        // inside them are shared and can still be changed by whoever gets the
        // copy, so claims are limited to `slot.field` leaves (see claims).
        return;
      }
      case "JSXExpressionContainer": {
        const holder = oracle.parentOf(parent);
        if (holder?.type === "JSXAttribute") {
          const element = oracle.parentOf(holder);
          const name =
            element?.type === "JSXOpeningElement" ? element.name : null;
          const host =
            name?.type === "JSXIdentifier" && /^[a-z]/.test(name.name ?? "");
          // A host attribute is read by React; a component prop is handed
          // to code that may change it.
          return host ? undefined : taint(path);
        }
        // A child expression: rendered, not changed.
        return holder?.type === "JSXElement" || holder?.type === "JSXFragment"
          ? undefined
          : taint(path);
      }
      case "TemplateLiteral":
      case "BinaryExpression":
      case "IfStatement":
      case "WhileStatement":
      case "DoWhileStatement":
      case "SwitchStatement":
      case "SwitchCase":
      case "ExpressionStatement":
        return;
      case "UnaryExpression":
        return parent.operator === "delete" ? replaced(path) : undefined;
      case "LogicalExpression":
      case "AwaitExpression":
        return checkUse(parent, root, path);
      case "ConditionalExpression":
        return parent.test === node ? undefined : checkUse(parent, root, path);
      case "SequenceExpression": {
        const last = parent.expressions?.[parent.expressions.length - 1];
        return last === node ? checkUse(parent, root, path) : undefined;
      }
      default:
        // Call or `new` argument, assignment value, return, array element,
        // object property value, export, throw …: the object reaches code
        // this analysis does not follow.
        return taint(path);
    }
  };

  // `content`: every reference must be `content("literal")`.
  if (ctx.contentBinding) {
    for (const reference of ctx.contentBinding.references) {
      const parent = oracle.parentOf(reference);
      if (isCall(parent) && parent.callee === reference) {
        const args = parent.arguments ?? [];
        if (args.length === 1 && args[0]?.type === "StringLiteral") {
          checkUse(parent, "content", [args[0].value]);
        } else {
          taints.add(taintKey("content", null));
        }
      } else {
        taints.add(taintKey("content", null));
      }
    }
  }
  // `morph.pages.get("/")` is another supported root. Its returned object is
  // followed through locals and destructuring just like `content("slot")`;
  // writes through any alias must taint the affected section field before a
  // later JSX prop can be advertised as an editable CMS field.
  if (ctx.morphBinding) {
    for (const reference of ctx.morphBinding.references) {
      const pages = oracle.parentOf(reference);
      const get = pages ? oracle.parentOf(pages) : null;
      const call = get ? oracle.parentOf(get) : null;
      const args = isCall(call) ? call.arguments ?? [] : [];
      if (
        isMember(pages) &&
        pages.object === reference &&
        staticKey(pages) === "pages" &&
        isMember(get) &&
        get.object === pages &&
        staticKey(get) === "get" &&
        isCall(call) &&
        call.callee === get &&
        args.length === 1 &&
        args[0]?.type === "StringLiteral" &&
        normalizePagePath(args[0].value)
      ) {
        checkUse(call, "page", []);
      } else {
        taints.add(taintKey("page", null));
      }
    }
  }
  // `Route`: `Route.useLoaderData()` is the root; other hooks that cannot
  // reach the data are fine; anything else may hand the data out.
  if (ctx.routeBinding) {
    for (const reference of ctx.routeBinding.references) {
      const parent = oracle.parentOf(reference);
      const grand = parent ? oracle.parentOf(parent) : null;
      const hook =
        isMember(parent) && parent.object === reference
          ? staticKey(parent)
          : null;
      if (
        hook === "useLoaderData" &&
        isCall(grand) &&
        grand.callee === parent
      ) {
        if ((grand.arguments ?? []).length === 0) checkUse(grand, "loader", []);
        else taints.add(taintKey("loader", null));
      } else if (
        hook &&
        ROUTE_HOOKS_WITHOUT_DATA.has(hook) &&
        isCall(grand) &&
        grand.callee === parent
      ) {
        continue;
      } else {
        taints.add(taintKey("loader", null));
      }
    }
  }
}

/** Other modules that can reach this route's loader data at all. */
function otherModuleReachesLoaderData(
  file: B1SourceFile,
  routeFile: string,
  filePaths: ReadonlySet<string>,
  ast: ParsedThemeAst | null,
): boolean {
  if (!ast) return true;
  for (const statement of ast.program.body ?? []) {
    if (statement.type !== "ImportDeclaration") continue;
    if (statement.source.value === ROUTER_MODULE) {
      for (const specifier of statement.specifiers ?? []) {
        if (specifier.type === "ImportNamespaceSpecifier") return true;
        if (specifier.type !== "ImportSpecifier") continue;
        const imported = moduleExportName(specifier.imported);
        if (imported && LOADER_DATA_APIS.has(imported)) return true;
      }
    } else if (
      resolveThemeSourceImport(file.path, statement.source.value, filePaths) ===
      routeFile
    ) {
      return true;
    }
  }
  return false;
}

type ReachableThemeModules = Readonly<{
  paths: ReadonlySet<string>;
  /** An unresolved dynamic import could execute any local Theme module. */
  unboundedDynamicImport: boolean;
  /** A reachable script could not be parsed, so its effects are unknown. */
  unparseable: boolean;
}>;

/**
 * The root values in two route modules are not the same object just because
 * they use the same slot name. Only modules the current route can execute can
 * receive its values (an opaque call in the route itself is already tainted
 * by `collectTaints`). The root route is included because TanStack mounts it
 * around every route even though the generated route tree is not authored
 * source and therefore is not in this import graph.
 */
function reachableThemeModules(
  routeFile: string,
  files: readonly B1SourceFile[],
  filePaths: ReadonlySet<string>,
  parsedAstFor: (path: string, content: string) => ThemeSourceAstResult,
): ReachableThemeModules {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const paths = new Set<string>();
  const pending = [routeFile];
  if (byPath.has("src/routes/__root.tsx")) {
    pending.push("src/routes/__root.tsx");
  }
  let unboundedDynamicImport = false;
  let unparseable = false;

  while (pending.length > 0) {
    const path = pending.pop()!;
    if (paths.has(path) || !SCRIPT_FILE.test(path)) continue;
    paths.add(path);
    const file = byPath.get(path);
    if (!file) continue;

    const parsed = parsedAstFor(file.path, file.content);
    if (!parsed.ok) {
      unparseable = true;
      continue;
    }

    const specifiers: string[] = [];
    const visit = (node: AnyNode) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(visit);

      if (
        node.type === "ImportDeclaration" &&
        node.importKind !== "type" &&
        typeof node.source?.value === "string"
      ) {
        specifiers.push(node.source.value);
      } else if (
        (node.type === "ExportNamedDeclaration" ||
          node.type === "ExportAllDeclaration") &&
        typeof node.source?.value === "string"
      ) {
        specifiers.push(node.source.value);
      } else if (node.type === "ImportExpression") {
        const source = node.source;
        if (source?.type === "StringLiteral") specifiers.push(source.value);
        else unboundedDynamicImport = true;
      } else if (
        node.type === "CallExpression" &&
        node.callee?.type === "Import"
      ) {
        const source = node.arguments?.[0];
        if (source?.type === "StringLiteral") specifiers.push(source.value);
        else unboundedDynamicImport = true;
      } else if (
        node.type === "CallExpression" &&
        node.callee?.type === "Identifier" &&
        node.callee.name === "require"
      ) {
        const source = node.arguments?.[0];
        if (source?.type === "StringLiteral") specifiers.push(source.value);
        else unboundedDynamicImport = true;
      }

      for (const [key, value] of Object.entries(node)) {
        if (
          key === "loc" ||
          key === "leadingComments" ||
          key === "trailingComments" ||
          key === "innerComments"
        ) {
          continue;
        }
        visit(value);
      }
    };
    visit(parsed.ast.program);

    for (const specifier of specifiers) {
      const target = resolveThemeSourceImport(path, specifier, filePaths);
      if (target && !paths.has(target)) pending.push(target);
    }
  }

  return { paths, unboundedDynamicImport, unparseable };
}

// ---------------------------------------------------------------------------
// The resolver: an expression's symbolic origin.

type Origin =
  | Readonly<{
      kind: "root";
      root: B1Root;
      path: readonly string[];
      sourceRoute?: string;
    }>
  | Readonly<{
      kind: "derived";
      root: B1Root;
      slot: string;
      sourceRoute?: string;
      reason: string;
    }>
  | Readonly<{ kind: "literal" }>
  | Readonly<{ kind: "unknown"; reason: string }>;

function deriveOrigin(
  ctx: ModuleContext,
  expressions: readonly AnyNode[],
  seen: Set<B1Binding>,
  reason: string,
): Origin {
  const origins = expressions.map((expression) =>
    resolveOrigin(ctx, expression, new Set(seen)),
  );
  if (origins.some((origin) => origin.kind === "unknown")) {
    return { kind: "unknown", reason: `${reason} includes an untraced value` };
  }
  const sources = origins.flatMap((origin) =>
    origin.kind === "root"
      ? origin.path.length > 0
        ? [{ root: origin.root, sourceRoute: origin.sourceRoute, slot: origin.path[0]! }]
        : []
      : origin.kind === "derived"
        ? [{ root: origin.root, sourceRoute: origin.sourceRoute, slot: origin.slot }]
        : [],
  );
  const unique = new Map(
    sources.map(
      (source) =>
        [`${source.root}:${source.sourceRoute ?? ""}:${source.slot}`, source] as const,
    ),
  );
  if (unique.size === 0) return { kind: "literal" };
  if (unique.size !== 1) {
    return { kind: "unknown", reason: `${reason} combines multiple sections` };
  }
  const [{ root, sourceRoute, slot }] = [...unique.values()];
  return { kind: "derived", root, sourceRoute, slot, reason };
}

function resolveOrigin(
  ctx: ModuleContext,
  expression: AnyNode,
  seen: Set<B1Binding> = new Set(),
): Origin {
  const node = unwrapTs(expression);
  if (!node) return { kind: "unknown", reason: "no expression" };
  switch (node.type) {
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
    case "NullLiteral":
      return { kind: "literal" };
    case "TemplateLiteral":
      return (node.expressions ?? []).length === 0
        ? { kind: "literal" }
        : deriveOrigin(
            ctx,
            node.expressions,
            seen,
            "a template literal composes its value",
          );
    case "BinaryExpression":
      return deriveOrigin(
        ctx,
        [node.left, node.right],
        seen,
        "an expression composes its value",
      );
    case "ConditionalExpression":
      return deriveOrigin(
        ctx,
        [node.consequent, node.alternate],
        seen,
        "a conditional chooses its value",
      );
    case "LogicalExpression":
      return deriveOrigin(
        ctx,
        [node.left, node.right],
        seen,
        "a logical expression chooses its value",
      );
    case "CallExpression": {
      const callee = node.callee;
      if (
        callee?.type === "Identifier" &&
        ctx.contentBinding &&
        ctx.oracle.bindingOf(callee) === ctx.contentBinding
      ) {
        const args = node.arguments ?? [];
        return args.length === 1 && args[0]?.type === "StringLiteral"
          ? { kind: "root", root: "content", path: [args[0].value] }
          : { kind: "unknown", reason: "content() with a computed slot" };
      }
      if (
        isMember(callee) &&
        staticKey(callee) === "useLoaderData" &&
        callee.object?.type === "Identifier" &&
        ctx.routeBinding &&
        ctx.oracle.bindingOf(callee.object) === ctx.routeBinding &&
        (node.arguments ?? []).length === 0
      ) {
        return ctx.loaderOrigin
          ? { kind: "root", root: "loader", path: [] }
          : {
              kind: "unknown",
              reason: "the route's loader is not proven to return the page",
            };
      }
      if (
        isMember(callee) &&
        staticKey(callee) === "get" &&
        isMember(callee.object) &&
        staticKey(callee.object) === "pages" &&
        callee.object.object?.type === "Identifier" &&
        ctx.morphBinding &&
        ctx.oracle.bindingOf(callee.object.object) === ctx.morphBinding
      ) {
        const args = node.arguments ?? [];
        if (args.length !== 1 || args[0]?.type !== "StringLiteral") {
          return {
            kind: "unknown",
            reason: "morph.pages.get() with a computed path",
          };
        }
        const sourceRoute = normalizePagePath(args[0].value);
        return sourceRoute
          ? { kind: "root", root: "page", path: [], sourceRoute }
          : {
              kind: "unknown",
              reason: "morph.pages.get() with a non-static page path",
            };
      }
      return {
        kind: "unknown",
        reason: "a call to code this analysis does not follow",
      };
    }
    case "MemberExpression":
    case "OptionalMemberExpression": {
      const key = staticKey(node);
      if (key === null)
        return { kind: "unknown", reason: "a computed member key" };
      const object = resolveOrigin(ctx, node.object, seen);
      if (object.kind !== "root") {
        return object.kind === "literal"
          ? { kind: "unknown", reason: "a member of a literal" }
          : object;
      }
      return { ...object, path: [...object.path, key] };
    }
    case "Identifier": {
      if (ctx.oracle.hasDirectEval)
        return { kind: "unknown", reason: "direct eval" };
      const binding = ctx.oracle.bindingOf(node);
      if (!binding)
        return {
          kind: "unknown",
          reason: `"${node.name}" is not declared here`,
        };
      if (seen.has(binding)) return { kind: "unknown", reason: "a cycle" };
      if (binding.violations.length > 0) {
        return { kind: "unknown", reason: `"${node.name}" is reassigned` };
      }
      if (
        (binding.kind !== "const" &&
          binding.kind !== "let" &&
          binding.kind !== "var") ||
        binding.declaration?.type !== "VariableDeclarator" ||
        !binding.declaration.init
      ) {
        return {
          kind: "unknown",
          reason: `"${node.name}" is a ${binding.kind}, not a traced local`,
        };
      }
      const located = patternPathTo(binding.declaration.id, binding.identifier);
      if (!located)
        return { kind: "unknown", reason: "binding not found in its pattern" };
      if ("reason" in located)
        return { kind: "unknown", reason: located.reason };
      const init = resolveOrigin(
        ctx,
        binding.declaration.init,
        new Set(seen).add(binding),
      );
      if (init.kind !== "root") {
        return located.keys.length === 0
          ? init
          : { kind: "unknown", reason: "a member of an untraced value" };
      }
      return { ...init, path: [...init.path, ...located.keys] };
    }
    case "AwaitExpression":
      return resolveOrigin(ctx, node.argument, seen);
    default:
      return { kind: "unknown", reason: `${node.type} is not traced` };
  }
}

function fieldValue(origin: Origin, taints: TaintSet): B1PropValue {
  if (origin.kind === "literal") return { kind: "literal" };
  if (origin.kind === "derived") {
    if (isTainted(taints, origin.root, [origin.slot])) {
      return unknown(
        `"${origin.slot}" may be changed by code before it renders`,
      );
    }
    return { ...origin, kind: "derived" };
  }
  if (origin.kind === "unknown") return unknown(origin.reason);
  if (isTainted(taints, origin.root, origin.path)) {
    return unknown(
      `"${origin.path.join(".")}" may be changed by code before it renders`,
    );
  }
  if (origin.path.length !== 2) {
    return unknown(
      origin.path.length < 2
        ? "the value is a whole section or page, not one field"
        : "a nested value inside a field is not a B1 claim",
    );
  }
  return {
    kind: "field",
    root: origin.root,
    slot: origin.path[0]!,
    field: origin.path[1]!,
    ...(origin.sourceRoute ? { sourceRoute: origin.sourceRoute } : {}),
  };
}

// ---------------------------------------------------------------------------

function componentTarget(
  ctx: ModuleContext,
  opening: Extract<AnyNode, { type: "JSXOpeningElement" }>,
  filePaths: ReadonlySet<string>,
): { path: string | null; exportName: string | null } {
  const none = { path: null, exportName: null };
  const name = opening.name;
  if (name?.type !== "JSXIdentifier") return none;
  const binding = ctx.oracle.bindingOf(name);
  if (!binding || binding.violations.length > 0) return none;
  if (binding.kind === "import" && binding.declaration) {
    const specifierNode = binding.declaration;
    if (
      specifierNode.type !== "ImportDefaultSpecifier" &&
      specifierNode.type !== "ImportSpecifier" &&
      specifierNode.type !== "ImportNamespaceSpecifier"
    ) {
      return none;
    }
    const declaration = ctx.oracle.parentOf(specifierNode);
    if (declaration?.type !== "ImportDeclaration") return none;
    const specifier = declaration.source.value;
    const exportName =
      specifierNode.type === "ImportDefaultSpecifier"
        ? "default"
        : specifierNode.type === "ImportSpecifier"
          ? moduleExportName(specifierNode.imported)
          : null;
    return {
      path: exportName
        ? resolveThemeSourceImport(ctx.path, specifier, filePaths)
        : null,
      exportName,
    };
  }
  return none;
}

function declaredFieldsOf(
  componentPath: string | null,
  contentByPath: ReadonlyMap<string, string>,
  parsedAstFor: (path: string, content: string) => ParsedThemeAst | null,
): string[] {
  if (!componentPath) return [];
  const source = contentByPath.get(componentPath);
  if (source === undefined) return [];
  const sidecarPath = contentFieldsSidecarPath(componentPath);
  const sidecar = sidecarPath ? contentByPath.get(sidecarPath) : undefined;
  const parsed = readComponentContentFields({
    path: componentPath,
    source,
    sidecar,
    parsedSourceAst: parsedAstFor(componentPath, source),
    parsedSidecarAst:
      typeof sidecar === "string" && sidecarPath
        ? parsedAstFor(sidecarPath, sidecar)
        : undefined,
  });
  return parsed.declaration === "valid" ? Object.keys(parsed.fields ?? {}) : [];
}

/** Whether a call site renders exactly once where it stands. */
function isDirectPosition(
  ctx: ModuleContext,
  element: AnyNode,
  sourceSlots: readonly string[],
): boolean {
  const parent = ctx.oracle.parentOf(element);
  if (parent?.type === "JSXElement" || parent?.type === "JSXFragment")
    return true;
  if (parent?.type === "ReturnStatement") return true;

  // Morph's supported visibility guard is the only conditional that still
  // identifies one section instance: the same static slot must be used by
  // both the imported guard and the content() spread. Arbitrary conditions
  // remain non-direct because the call site may not render as one instance.
  if (
    parent?.type !== "LogicalExpression" ||
    parent.operator !== "&&" ||
    parent.right !== element ||
    sourceSlots.length !== 1 ||
    !ctx.sectionHiddenBinding
  ) {
    return false;
  }
  let guard = unwrapTs(parent.left);
  if (guard.type !== "UnaryExpression" || guard.operator !== "!") return false;
  guard = unwrapTs(guard.argument);
  if (
    !isCall(guard) ||
    guard.callee?.type !== "Identifier" ||
    ctx.oracle.bindingOf(guard.callee) !== ctx.sectionHiddenBinding ||
    (guard.arguments ?? []).length !== 1 ||
    guard.arguments[0]?.type !== "StringLiteral"
  ) {
    return false;
  }
  return guard.arguments[0].value === sourceSlots[0];
}

const FUNCTION_SCOPE_NODE_TYPES = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);

/**
 * The preview injector captures a conditional spread once by wrapping its JSX
 * element in a synchronous arrow. An `await` or `yield` whose lexical owner is
 * outside that element would become nested under the new arrow and stop
 * parsing. Do not report such a spread as a field source; the server uses this
 * same analysis when it re-derives write provenance.
 *
 * Nested functions are separate lexical owners and remain valid inside the
 * wrapper, so their bodies do not make the surrounding JSX unsafe.
 */
function hasSuspensionOutsideNestedFunction(node: AnyNode): boolean {
  const visit = (value: unknown, isRoot = false): boolean => {
    if (Array.isArray(value)) return value.some((child) => visit(child));
    if (!value || typeof value !== "object") return false;

    const candidate = value as Record<string, unknown>;
    const type = candidate.type;
    if (typeof type !== "string") return false;
    if (!isRoot && FUNCTION_SCOPE_NODE_TYPES.has(type)) return false;
    if (type === "AwaitExpression" || type === "YieldExpression") return true;

    return Object.entries(candidate).some(
      ([key, child]) =>
        key !== "loc" &&
        key !== "leadingComments" &&
        key !== "trailingComments" &&
        visit(child),
    );
  };

  return visit(node, true);
}

function propsAtCallSite(
  ctx: ModuleContext,
  opening: Extract<AnyNode, { type: "JSXOpeningElement" }>,
  declared: readonly string[],
  taints: TaintSet,
  hasSuspension: boolean,
): Record<string, B1PropValue> {
  const state = new Map<string, B1PropValue>();
  let wildcard: B1PropValue = { kind: "unset" };
  const valueOf = (prop: string) => state.get(prop) ?? wildcard;
  const interest = new Set<string>(declared);
  for (const attribute of opening.attributes ?? []) {
    if (
      attribute.type === "JSXAttribute" &&
      attribute.name?.type === "JSXIdentifier"
    ) {
      interest.add(attribute.name.name);
    }
  }

  for (const attribute of opening.attributes ?? []) {
    if (attribute.type === "JSXAttribute") {
      if (attribute.name?.type !== "JSXIdentifier") continue;
      const name = attribute.name.name;
      const value = attribute.value;
      let resolved: B1PropValue;
      if (value === null || value === undefined) resolved = { kind: "literal" };
      else if (value.type === "StringLiteral") resolved = { kind: "literal" };
      else if (value.type === "JSXExpressionContainer") {
        resolved = fieldValue(resolveOrigin(ctx, value.expression), taints);
      } else resolved = unknown("a JSX element as a prop value");
      state.set(name, resolved);
      continue;
    }
    if (attribute.type !== "JSXSpreadAttribute") continue;
    const origin = resolveOrigin(ctx, attribute.argument);
    if (
      typeof attribute.start !== "number" ||
      typeof attribute.end !== "number"
    ) {
      const reason = "a spread attribute has no source range";
      for (const prop of interest) state.set(prop, unknown(reason));
      wildcard = unknown(reason);
      continue;
    }
    const range = { start: attribute.start, end: attribute.end };
    if (origin.kind !== "root") {
      const reason =
        origin.kind === "unknown"
          ? `an untraced spread can set any prop (${origin.reason})`
          : "a spread of a literal";
      for (const prop of interest) state.set(prop, unknown(reason));
      wildcard = unknown(reason);
      continue;
    }
    if (
      origin.path.length !== 1 ||
      isTainted(taints, origin.root, origin.path)
    ) {
      const reason =
        origin.path.length !== 1
          ? "a spread of something other than one section"
          : `"${origin.path.join(".")}" may be changed by code before it renders`;
      for (const prop of interest) state.set(prop, unknown(reason));
      wildcard = unknown(reason);
      continue;
    }
    if (hasSuspension) {
      const reason =
        "capturing this spread would change the scope of an await or yield expression in the JSX element";
      for (const prop of interest) state.set(prop, unknown(reason));
      wildcard = unknown(reason);
      continue;
    }
    const slot = origin.path[0]!;
    const spreadValue = (prop: string): B1PropValue => {
      const field: B1PropValue = {
        kind: "field",
        root: origin.root,
        slot,
        field: prop,
        ...(origin.sourceRoute ? { sourceRoute: origin.sourceRoute } : {}),
        viaSpread: { spread: range, otherwiseLabel: "" },
      };
      if (isTainted(taints, origin.root, [slot, prop])) {
        return unknown(
          `"${slot}.${prop}" may be changed by code before it renders`,
        );
      }
      const previous = valueOf(prop);
      // Nothing earlier: if the section has no such key the prop stays
      // undefined and the component default shows, which is how an unset
      // field displays everywhere else (c1).
      if (previous.kind === "unset") return field;
      // Which of two spreads wins depends on both objects' keys; one runtime
      // condition is all the prototype labels.
      if (
        previous.kind === "spread-field" ||
        (previous.kind === "field" && previous.viaSpread !== undefined)
      ) {
        return unknown("two spreads may each set this prop");
      }
      return {
        kind: "spread-field",
        root: origin.root,
        slot,
        field: prop,
        ...(origin.sourceRoute ? { sourceRoute: origin.sourceRoute } : {}),
        spread: range,
        otherwise: previous,
      };
    };
    for (const prop of interest) state.set(prop, spreadValue(prop));
    wildcard = {
      kind: "unknown",
      reason: "set by a spread; not a declared field",
    };
  }
  const out: Record<string, B1PropValue> = {};
  for (const prop of interest) out[prop] = valueOf(prop);
  return out;
}

function claimFor(value: B1PropValue): B1Claim {
  switch (value.kind) {
    case "field":
      return {
        kind: "claim",
        slot: value.slot,
        field: value.field,
        ...(value.sourceRoute ? { sourceRoute: value.sourceRoute } : {}),
        conditional: value.viaSpread
          ? {
              spread: value.viaSpread.spread,
              otherwiseLabel: value.viaSpread.otherwiseLabel,
              requiresOwnKey: false,
            }
          : null,
      };
    case "spread-field": {
      const otherwise = claimFor(value.otherwise);
      return {
        kind: "claim",
        slot: value.slot,
        field: value.field,
        ...(value.sourceRoute ? { sourceRoute: value.sourceRoute } : {}),
        conditional: {
          spread: value.spread,
          // Filled in by `resolveSections` once the instance's section is known.
          otherwiseLabel:
            otherwise.kind === "claim" && otherwise.slot === value.slot
              ? otherwise.field
              : "",
          requiresOwnKey: true,
        },
      };
    }
    case "literal":
      return { kind: "none", state: "literal", reason: "written in the code" };
    case "derived":
      return { kind: "none", state: "derived", reason: value.reason };
    case "unset":
      return {
        kind: "none",
        state: "unset",
        reason: "not set here; the component default shows",
      };
    case "unknown":
      return { kind: "none", state: "unknown", reason: value.reason };
  }
}

/**
 * Analyses one route module of a Theme.
 *
 * `backend` picks the scope oracle; the result must not depend on it (tested).
 */
export function analyzeB1Route(
  files: readonly B1SourceFile[],
  routeFile: string,
  backend: B1ScopeBackend = buildHandScopeOracle,
  parsedModules?: B1ParsedModules,
  sharedSourceParser?: (
    path: string,
    content: string,
  ) => ThemeSourceAstResult,
): B1RouteAnalysis {
  const normalizedRoute = normalizeThemeSourcePath(routeFile);
  const normalizedFiles = files.map((file) => ({
    path: normalizeThemeSourcePath(file.path),
    content: file.content,
    source: file,
  }));
  const filePaths = new Set(normalizedFiles.map((file) => file.path));
  const contentByPath = new Map(
    normalizedFiles.map((file) => [file.path, file.content]),
  );
  const parsedSourceFor =
    sharedSourceParser ??
    createAnalysisSourceParser(
      normalizedFiles.map(({ path, content }) => ({ path, content })),
      parsedModules,
    );
  const parsedAstFor = (path: string, content: string) => {
    const result = parsedSourceFor(path, content);
    return result.ok ? result.ast : null;
  };
  const contentCapabilities = resolveThemeContentCapabilitiesFromFiles(
    normalizedFiles,
    { parsedAstFor },
  );
  const manifestSourceByRef = readComponentSourcePaths(
    contentByPath.get("morph.theme.json") ?? null,
  );
  const componentRefBySource = new Map(
    [...manifestSourceByRef].map(([componentRef, sourcePath]) => [
      normalizeThemeSourcePath(sourcePath),
      componentRef,
    ]),
  );
  const diagnostics: string[] = [];
  const routeSource = contentByPath.get(normalizedRoute);
  const routeEntry = normalizedFiles.find(
    (file) => file.path === normalizedRoute,
  );
  const routeAstResult = routeEntry
    ? parsedSourceFor(routeEntry.path, routeEntry.content)
    : null;
  const ast =
    parsedModules?.get(normalizedRoute) ??
    (routeAstResult?.ok ? routeAstResult.ast : null);
  if (!ast || routeSource === undefined) {
    const parseMessage =
      routeAstResult && !routeAstResult.ok ? routeAstResult.message : null;
    return {
      routeFile: normalizedRoute,
      instances: [],
      taints: [],
      loaderOrigin: false,
      diagnostics: [parseMessage ?? `${normalizedRoute} could not be parsed`],
    };
  }
  const oracle = backend(ast);
  const partial = { ast, oracle, path: normalizedRoute };
  const { binding: contentBinding, aliases } = contentImportBinding(
    partial,
    filePaths,
  );
  if (aliases > 1) diagnostics.push("content is imported more than once");
  const morphBinding = morphImportBinding(partial, filePaths);
  const sectionHiddenBinding = sectionHiddenImportBinding(partial, filePaths);
  const route = routeBindingOf(partial);
  const routeName = route.binding?.name ?? null;
  const loaderOrigin =
    routeName !== null &&
    provenLoaderOrigin(
      partial,
      normalizedFiles,
      routeName,
      route.componentName,
      parsedSourceFor,
    );
  const ctx: ModuleContext = {
    ...partial,
    contentBinding,
    morphBinding,
    sectionHiddenBinding,
    routeBinding: route.binding,
    loaderOrigin,
    routePath: route.routePath,
  };

  // Taints from this route and the modules it can actually reach. A separate
  // route's `content("hero")` call is a different request-root object; a
  // global scan by slot name would let unrelated page code disable this
  // route's bindings.
  const taints: TaintSet = new Set();
  collectTaints(ctx, taints);
  const reachable = reachableThemeModules(
    normalizedRoute,
    normalizedFiles.map(({ path, content }) => ({ path, content })),
    filePaths,
    parsedSourceFor,
  );
  if (reachable.unboundedDynamicImport || reachable.unparseable) {
    taints.add(taintKey("content", null));
    taints.add(taintKey("loader", null));
    taints.add(taintKey("page", null));
  }
  for (const file of normalizedFiles) {
    if (
      file.path === normalizedRoute ||
      !reachable.paths.has(file.path) ||
      !SCRIPT_FILE.test(file.path)
    ) {
      continue;
    }
    if (file.path === CONTENT_MODULE_PATH) continue;
    const otherAstResult = parsedSourceFor(file.path, file.content);
    const other = otherAstResult.ok ? otherAstResult.ast : null;
    if (!other) continue;
    const otherOracle = backend(other);
    const otherPartial = { ast: other, oracle: otherOracle, path: file.path };
    const otherContent = contentImportBinding(otherPartial, filePaths);
    const otherMorph = morphImportBinding(otherPartial, filePaths);
    if (otherContent.aliases > 1) taints.add(taintKey("content", null));
    if (otherContent.binding) {
      collectTaints(
        {
          ...otherPartial,
          contentBinding: otherContent.binding,
          morphBinding: otherMorph,
          sectionHiddenBinding: null,
          routeBinding: null,
          loaderOrigin: false,
          routePath: null,
        },
        taints,
      );
    }
    if (otherModuleReachesLoaderData(file, normalizedRoute, filePaths, other)) {
      // Only this route's own loader data matters; a module that can reach
      // router state can reach it.
      if (file.path !== "src/routes/__root.tsx" || rootReadsLoaderData(other)) {
        taints.add(taintKey("loader", null));
      }
    }
  }

  // Call sites.
  const instances: Array<
    Omit<B1Instance, "section" | "claims"> & { direct: boolean }
  > = [];
  const nameCounts = new Map<string, number>();
  const visit = (node: AnyNode) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node.type === "JSXElement") {
      const opening = node.openingElement;
      const name = opening?.name;
      if (name?.type === "JSXIdentifier" && /^[A-Z]/.test(name.name)) {
        const nameIndex = nameCounts.get(name.name) ?? 0;
        nameCounts.set(name.name, nameIndex + 1);
        const target = componentTarget(ctx, opening, filePaths);
        const componentRef = target.path
          ? componentRefBySource.get(target.path)
          : undefined;
        const capability = target.path
          ? (contentCapabilities.sourceScan.capabilities[target.path] ??
            (componentRef
              ? contentCapabilities.capabilities[componentRef]
              : undefined))
          : undefined;
        const declared = capability
          ? Object.keys(capability.fields)
          : declaredFieldsOf(target.path, contentByPath, parsedAstFor);
        const sourceSlots = (opening.attributes ?? []).flatMap(
          (attribute: AnyNode) => {
            if (attribute.type !== "JSXSpreadAttribute") return [];
            const origin = resolveOrigin(ctx, attribute.argument);
            return origin.kind === "root" && origin.path.length === 1
              ? [origin.path[0]!]
              : [];
          },
        );
        const sourceRoots = (opening.attributes ?? []).flatMap(
          (attribute: AnyNode) => {
            if (attribute.type !== "JSXSpreadAttribute") return [];
            const origin = resolveOrigin(ctx, attribute.argument);
            return origin.kind === "root" && origin.path.length === 1
              ? [origin.root]
              : [];
          },
        );
        const hasUntracedSpread = (opening.attributes ?? []).some(
          (attribute: AnyNode) => {
            if (attribute.type !== "JSXSpreadAttribute") return false;
            const origin = resolveOrigin(ctx, attribute.argument);
            return (
              origin.kind !== "root" ||
              origin.path.length !== 1 ||
              isTainted(taints, origin.root, origin.path)
            );
          },
        );
        if (typeof node.start !== "number" || typeof node.end !== "number") {
          return;
        }
        instances.push({
          routeFile: normalizedRoute,
          start: node.start,
          end: node.end,
          nameIndex,
          componentName: name.name,
          componentPath: target.path,
          componentExport: target.exportName,
          declaredFields: declared,
          hasDeclaredCallsiteProps: (opening.attributes ?? []).some(
            (attribute: AnyNode) =>
              attribute.type === "JSXAttribute" &&
              attribute.name?.type === "JSXIdentifier" &&
              declared.includes(attribute.name.name),
          ),
          sourceSlots: [...new Set(sourceSlots)],
          sourceRoots: [...new Set(sourceRoots)],
          hasUntracedSpread,
          props: propsAtCallSite(
            ctx,
            opening,
            declared,
            taints,
            hasSuspensionOutsideNestedFunction(node),
          ),
          direct: isDirectPosition(ctx, node, [...new Set(sourceSlots)]),
        });
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (
        key === "loc" ||
        key === "leadingComments" ||
        key === "trailingComments"
      )
        continue;
      if (value && typeof value === "object") visit(value);
    }
  };
  visit(ast.program);

  // Sections: one slot per instance, one instance per slot.
  const slotUses = new Map<string, number>();
  const sectionOf = (instance: (typeof instances)[number]): string | null => {
    // Section identity and field provenance are separate proofs. An explicit,
    // unique section root still identifies this structural instance even if
    // a later untraced spread may override its props; propsAtCallSite marks
    // those fields unknown, so the wrapper can be selected/reordered without
    // advertising a field write that the source cannot prove. Multiple known
    // roots remain ambiguous and are refused below. Loader spreads retain the
    // existing stricter rule: if any spread at the call site is untraced, the
    // route value no longer proves that this element belongs to the section.
    if (
      instance.hasUntracedSpread &&
      instance.sourceRoots.includes("loader")
    ) {
      return null;
    }
    if (instance.sourceSlots.length > 1) return null;
    if (instance.sourceSlots.length === 1) {
      const slot = instance.sourceSlots[0]!;
      return isValidThemeContentSlotId(slot) ? slot : null;
    }
    const slots = new Set<string>();
    for (const field of instance.declaredFields) {
      const value = instance.props[field];
      if (
        value?.kind === "field" ||
        value?.kind === "spread-field" ||
        value?.kind === "derived"
      )
        slots.add(value.slot);
    }
    if (slots.size === 1) return [...slots][0]!;
    if (slots.size === 0) return null;
    return null;
  };
  const withSections = instances.map((instance) => {
    // A uniquely sourced call site still identifies which Document section
    // this rendered node came from inside a conditional or repeat. `direct`
    // remains a separate requirement for per-field edit claims below: a
    // repeated/conditional runtime instance is not one statically unique
    // field-edit target.
    const section = instance.componentPath ? sectionOf(instance) : null;
    if (section !== null) {
      slotUses.set(section, (slotUses.get(section) ?? 0) + 1);
    }
    return { instance, section };
  });

  const finished: B1Instance[] = withSections.map(({ instance, section }) => {
    const claims: Record<string, B1Claim> = {};
    for (const field of instance.declaredFields) {
      const value = instance.props[field] ?? { kind: "unset" as const };
      let claim = claimFor(value);
      if (claim.kind === "claim") {
        if (!instance.direct) {
          claim = {
            kind: "none",
            state: "unknown",
            reason: "rendered inside a conditional or a loop: not one instance",
          };
        } else if (!instance.declaredFields.includes(claim.field)) {
          claim = {
            kind: "none",
            state: "unknown",
            reason: `"${claim.field}" is not a field the component declares`,
          };
        } else if (
          claim.sourceRoute !== undefined &&
          claim.sourceRoute !== route.routePath
        ) {
          claim = {
            kind: "none",
            state: "unknown",
            reason: "the page Document path does not match this route",
          };
        } else if ((slotUses.get(claim.slot) ?? 0) > 1) {
          claim = {
            kind: "none",
            state: "unknown",
            reason: `section "${claim.slot}" feeds more than one instance`,
          };
        } else if (claim.slot !== section) {
          claim = {
            kind: "none",
            state: "unknown",
            reason: `the instance is section "${section}"; a field of "${claim.slot}" needs a per-element section identity (protocol gap)`,
          };
        }
      }
      claims[field] = claim;
    }
    const { direct: _direct, ...rest } = instance;
    return {
      ...rest,
      section:
        section !== null && (slotUses.get(section) ?? 0) === 1
          ? section
          : null,
      claims,
    };
  });

  return {
    routeFile: normalizedRoute,
    instances: finished,
    taints: [...taints].sort(),
    loaderOrigin,
    diagnostics,
  };
}

/**
 * The starter's root route imports router APIs for its shell. It reaches the
 * page's loader data only through `useLoaderData`/match APIs; the shell's own
 * use of `useRouterState` etc. is checked by name, conservatively.
 */
function rootReadsLoaderData(ast: ParsedThemeAst): boolean {
  let reads = false;
  const visit = (node: AnyNode) => {
    if (reads || !node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.type === "Identifier" && /loaderData/i.test(node.name))
      reads = true;
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc") continue;
      if (value && typeof value === "object") visit(value);
    }
  };
  visit(ast.program);
  if (reads) return true;
  // Any router-state API is enough to reach every match's loader data.
  for (const statement of ast.program.body ?? []) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.source.value !== ROUTER_MODULE
    )
      continue;
    for (const specifier of statement.specifiers ?? []) {
      if (specifier.type !== "ImportSpecifier") continue;
      const imported = moduleExportName(specifier.imported);
      if (imported && LOADER_DATA_APIS.has(imported)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Component side: which prop a host element of the component shows.

export type B1ComponentElement = Readonly<{
  /** Babel source offset of the host element in the component source. */
  start: number;
  /** `line:column` (1-based column) of the opening tag, as `data-morph-loc` writes it. */
  loc: string;
  prop: string;
}>;

/**
 * Host elements of a component whose single child expression is provably a
 * prop the component received (its first parameter's destructured property,
 * default allowed, never reassigned; or `props.x` of a never-reassigned
 * `props`). Scope-correct: a shadowing local of the same name is not the prop.
 */
export function componentPropElements(
  source: string,
  exportName: "default" | string,
  backend: B1ScopeBackend = buildHandScopeOracle,
  parsedAst?: ParsedThemeAst,
): { elements: B1ComponentElement[]; threadable: boolean; fn: AnyNode | null } {
  const ast = parsedAst ?? parseModule(source);
  if (!ast) return { elements: [], threadable: false, fn: null };
  const oracle = backend(ast);
  let fn: AnyNode | null = null;
  for (const statement of ast.program.body ?? []) {
    if (
      exportName === "default" &&
      statement.type === "ExportDefaultDeclaration" &&
      statement.declaration?.type === "FunctionDeclaration"
    ) {
      fn = statement.declaration;
    }
    if (
      exportName !== "default" &&
      statement.type === "ExportNamedDeclaration" &&
      statement.declaration?.type === "FunctionDeclaration" &&
      statement.declaration.id?.name === exportName
    ) {
      fn = statement.declaration;
    }
  }
  if (!fn) return { elements: [], threadable: false, fn: null };
  const first = fn.params?.[0];
  const pattern = first?.type === "AssignmentPattern" ? first.left : first;
  const threadable = pattern?.type === "ObjectPattern";

  const propOf = (expression: AnyNode): string | null => {
    const node = unwrapTs(expression);
    if (node?.type === "Identifier") {
      const binding = oracle.bindingOf(node);
      if (
        !binding ||
        binding.kind !== "param" ||
        binding.declaration !== fn ||
        binding.violations.length > 0 ||
        !threadable
      ) {
        return null;
      }
      const located = patternPathTo(pattern, binding.identifier);
      // A default is the component's own fallback for an unset prop: the
      // value shown is still the prop's whenever the prop is set.
      if (located && "keys" in located && located.keys.length === 1)
        return located.keys[0]!;
      if (located && "reason" in located && /default/.test(located.reason)) {
        const property = (pattern.properties ?? []).find(
          (p): p is Extract<AnyNode, { type: "ObjectProperty" }> =>
            p.type === "ObjectProperty" &&
            p.value?.type === "AssignmentPattern" &&
            p.value.left === binding.identifier,
        );
        const key = property ? moduleExportName(property.key) : null;
        return typeof key === "string" && property && !property.computed
          ? key
          : null;
      }
      return null;
    }
    if (isMember(node) && node.object?.type === "Identifier" && !threadable) {
      const binding = oracle.bindingOf(node.object);
      if (
        binding?.kind === "param" &&
        binding.declaration === fn &&
        binding.violations.length === 0
      ) {
        return staticKey(node);
      }
    }
    return null;
  };

  const elements: B1ComponentElement[] = [];
  const visit = (node: AnyNode) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (node.type === "JSXElement") {
      const name = node.openingElement?.name;
      if (name?.type === "JSXIdentifier" && /^[a-z]/.test(name.name)) {
        const meaningful = (node.children ?? []).filter(
          (child: AnyNode) =>
            !(child.type === "JSXText" && child.value.trim() === ""),
        );
        if (
          meaningful.length === 1 &&
          meaningful[0].type === "JSXExpressionContainer"
        ) {
          const prop = propOf(meaningful[0].expression);
          const position = node.openingElement.loc?.start;
          if (prop && position && typeof node.start === "number") {
            elements.push({
              start: node.start,
              loc: `${position.line}:${position.column + 1}`,
              prop,
            });
          }
        }
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc") continue;
      if (value && typeof value === "object") visit(value);
    }
  };
  visit(fn.body);
  return { elements, threadable, fn };
}
