import { parse } from "@babel/parser";
import {
  Fragment,
  cloneElement,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { SAFE_THEME_INLINE_ROUTE_COMPONENT } from "@/lib/storefront/compiler/theme-route-registry";
import {
  TANSTACK_ROUTER_MODULE,
  renderThemeRouterLink,
} from "./safe-theme-router-link";
import { MORPH_SOURCE_LOCATION_ATTRIBUTE } from "@/lib/storefront/compiler/theme-source-location-plugin";
import {
  THEME_CONTENT_CONTEXT_KEY,
  THEME_CONTENT_MODULE_PATH,
  THEME_CONTENT_SLOT_HELPER,
  THEME_SECTION_HIDDEN_HELPER,
  THEME_ROUTE_CONTEXT_HOOK,
  isValidThemeContentSlotId,
  resolveThemeContentSlot,
  type ThemeContentSlotValues,
} from "@/lib/storefront/theme-content-slots";

type ThemeSourceFile = {
  path: string;
  content: string;
};

export type SafeThemeSectionIdentity = {
  sectionId: string;
  sectionType: string;
  componentRef?: string | null;
};

export type SafeThemeComponentRenderResult =
  | { success: true; node: ReactNode; diagnostics: [] }
  | { success: false; node: null; diagnostics: string[] };

type RuntimeContext = {
  loaderData?: Record<string, unknown>;
  files: Map<string, ThemeSourceFile>;
  /** Stored values for each content slot the route declares. */
  contentSlots?: ThemeContentSlotValues;
  /**
   * Sections the author hid. Empty in the Design preview, which shows a hidden
   * section so it can be seen and unhidden.
   */
  hiddenContentSlots?: readonly string[];
  /** Declared type of each stored section, keyed by its slot id. */
  sectionTypeBySlot?: Readonly<Record<string, string>>;
  /** Route-derived component identity for each content slot. */
  componentRefBySlot?: Readonly<Record<string, string>>;
  builtinComponents: SafeThemeBuiltinComponentMap;
  injectedProps: Record<string, unknown>;
  resolveComponent?: SafeThemeComponentResolver;
  nodeCount: number;
  componentStack: string[];
  diagnostics: string[];
};

export type SafeThemeBuiltinComponent = (
  props: Record<string, unknown>,
) => ReactNode;

export type SafeThemeBuiltinComponentMap = Record<
  string,
  Record<string, SafeThemeBuiltinComponent>
>;

export type SafeThemeComponentOverride = {
  render: boolean;
  props: Record<string, unknown>;
  section?: SafeThemeSectionIdentity;
};

export type SafeThemeComponentResolver = (args: {
  sourcePath: string;
  exportName: string;
  props: Record<string, unknown>;
}) => SafeThemeComponentOverride | null;

type ModuleRecord = {
  ast: any;
  imports: Map<string, { source: string; imported: string }>;
  functions: Map<string, any>;
  variables: any[];
  defaultExport: any;
};

const MAX_RENDERED_NODES = 2_000;
const MAX_COMPONENT_DEPTH = 40;
const MAX_MAP_ITEMS = 200;
const BLOCKED_TAGS = new Set([
  "base",
  "embed",
  "iframe",
  "link",
  "meta",
  "object",
  "script",
]);
const BLOCKED_PROPERTIES = new Set(["__proto__", "constructor", "prototype"]);
const moduleCache = new Map<string, { source: string; module: ModuleRecord }>();
const MAX_MODULE_CACHE_ENTRIES = 100;

class SafeThemeRuntimeError extends Error {}

function normalizePath(path: string): string {
  const stack: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join("/");
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

function resolveLocalImport(
  files: Map<string, ThemeSourceFile>,
  importer: string,
  specifier: string,
): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = normalizePath(`${dirname(importer)}/${specifier}`);
  const candidates = [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.jsx`,
    `${base}.js`,
    `${base}/index.tsx`,
    `${base}/index.ts`,
  ];
  return candidates.find((candidate) => files.has(candidate)) ?? null;
}

function parseModule(path: string, source: string): ModuleRecord {
  const cached = moduleCache.get(path);
  if (cached?.source === source) return cached.module;

  const ast = parse(source, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });
  const imports = new Map<string, { source: string; imported: string }>();
  const functions = new Map<string, any>();
  const variables: any[] = [];
  let defaultExport: any = null;

  const registerDeclaration = (declaration: any) => {
    if (declaration?.type === "FunctionDeclaration" && declaration.id?.name) {
      functions.set(declaration.id.name, declaration);
    }
    if (declaration?.type === "VariableDeclaration") {
      variables.push(...declaration.declarations);
      for (const item of declaration.declarations) {
        if (
          item.id?.type === "Identifier" &&
          (item.init?.type === "ArrowFunctionExpression" ||
            item.init?.type === "FunctionExpression")
        ) {
          functions.set(item.id.name, item.init);
        }
        if (item.id?.type === "Identifier" && item.id.name === "Route") {
          const initializer = item.init;
          const options =
            initializer?.type === "CallExpression" &&
            initializer.callee?.type === "CallExpression"
              ? initializer.arguments?.[0]
              : initializer?.type === "CallExpression"
                ? initializer.arguments?.[0]
                : null;
          const component =
            options?.type === "ObjectExpression"
              ? options.properties?.find(
                  (property: any) =>
                    property?.type === "ObjectProperty" &&
                    !property.computed &&
                    (property.key?.name === "component" ||
                      property.key?.value === "component"),
                )?.value
              : null;
          if (
            component?.type === "ArrowFunctionExpression" ||
            component?.type === "FunctionExpression"
          ) {
            functions.set(SAFE_THEME_INLINE_ROUTE_COMPONENT, component);
          }
        }
      }
    }
  };

  for (const statement of ast.program.body) {
    if (statement.type === "ImportDeclaration") {
      for (const specifier of statement.specifiers) {
        const localName = specifier.local?.name;
        if (!localName) continue;
        imports.set(localName, {
          source: statement.source.value,
          imported:
            specifier.type === "ImportDefaultSpecifier"
              ? "default"
              : specifier.type === "ImportSpecifier"
                ? specifier.imported.type === "StringLiteral"
                  ? specifier.imported.value
                  : specifier.imported.name
                : localName,
        });
      }
      continue;
    }
    if (statement.type === "ExportDefaultDeclaration") {
      defaultExport = statement.declaration;
      registerDeclaration(statement.declaration);
      continue;
    }
    if (statement.type === "ExportNamedDeclaration") {
      registerDeclaration(statement.declaration);
      continue;
    }
    registerDeclaration(statement);
  }

  const module = { ast, imports, functions, variables, defaultExport };
  moduleCache.set(path, { source, module });
  if (moduleCache.size > MAX_MODULE_CACHE_ENTRIES) {
    const oldest = moduleCache.keys().next().value;
    if (oldest) moduleCache.delete(oldest);
  }
  return module;
}

function safeClassNames(values: unknown[]): string {
  const output: string[] = [];
  const visit = (value: unknown) => {
    if (!value) return;
    if (typeof value === "string" || typeof value === "number") {
      output.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === "object") {
      for (const [key, enabled] of Object.entries(value)) {
        if (enabled) output.push(key);
      }
    }
  };
  values.forEach(visit);
  return output.join(" ");
}

function propertyName(node: any, env: Record<string, unknown>): string | null {
  if (!node) return null;
  if (!node.computed && node.property?.type === "Identifier") {
    return node.property.name;
  }
  const value = evaluateExpression(node.property, env, null);
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}

function expressionPath(node: any): string | null {
  if (node?.type === "Identifier") return node.name;
  if (
    node?.type === "MemberExpression" ||
    node?.type === "OptionalMemberExpression"
  ) {
    const parent = expressionPath(node.object);
    const key =
      !node.computed && node.property?.type === "Identifier"
        ? node.property.name
        : node.property?.type === "StringLiteral"
          ? node.property.value
          : null;
    return parent && key ? `${parent}.${key}` : null;
  }
  return null;
}

function safeMember(object: unknown, key: string | null): unknown {
  if (object == null || key == null || BLOCKED_PROPERTIES.has(key)) {
    return undefined;
  }
  if (Array.isArray(object) && key === "length") return object.length;
  if (typeof object === "string" && key === "length") return object.length;
  if (typeof object !== "object" && typeof object !== "string")
    return undefined;
  return (object as Record<string, unknown>)[key];
}

function bindPattern(
  pattern: any,
  value: unknown,
  env: Record<string, unknown>,
  context: RuntimeContext | null,
) {
  if (!pattern) return;
  if (pattern.type === "Identifier") {
    env[pattern.name] = value;
    return;
  }
  if (pattern.type === "AssignmentPattern") {
    bindPattern(
      pattern.left,
      value === undefined
        ? evaluateExpression(pattern.right, env, context)
        : value,
      env,
      context,
    );
    return;
  }
  if (pattern.type === "ObjectPattern") {
    const record =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
    const taken = new Set<string>();
    for (const property of pattern.properties ?? []) {
      if (property.type === "RestElement") continue;
      const key = property.key?.name ?? property.key?.value;
      taken.add(String(key));
      bindPattern(property.value, record[key], env, context);
    }
    // `{ id, ...rest }` is how a component forwards the props it was not
    // written to know about. Skipping it left every forwarded attribute out of
    // the preview while the build rendered them — a difference with nothing to
    // announce it.
    const rest = (pattern.properties ?? []).find(
      (property: any) => property?.type === "RestElement",
    );
    if (rest?.argument?.type === "Identifier") {
      const remaining: Record<string, unknown> = {};
      for (const key of Object.keys(record)) {
        if (taken.has(key) || BLOCKED_PROPERTIES.has(key)) continue;
        remaining[key] = record[key];
      }
      env[rest.argument.name] = remaining;
    }
  }
}

function evaluateFunctionBody(
  fn: any,
  args: unknown[],
  parentEnv: Record<string, unknown>,
  context: RuntimeContext,
): unknown {
  const env = Object.create(parentEnv) as Record<string, unknown>;
  for (let index = 0; index < (fn.params?.length ?? 0); index += 1) {
    bindPattern(fn.params[index], args[index], env, context);
  }
  if (fn.body?.type !== "BlockStatement") {
    return evaluateExpression(fn.body, env, context);
  }
  for (const statement of fn.body.body ?? []) {
    if (statement.type === "VariableDeclaration") {
      for (const declaration of statement.declarations) {
        bindPattern(
          declaration.id,
          evaluateExpression(declaration.init, env, context),
          env,
          context,
        );
      }
    }
    if (statement.type === "ReturnStatement") {
      return evaluateExpression(statement.argument, env, context);
    }
  }
  return null;
}

function evaluateCall(
  node: any,
  env: Record<string, unknown>,
  context: RuntimeContext,
): unknown {
  if (
    node.callee?.type === "MemberExpression" &&
    node.callee.computed !== true &&
    node.callee.object?.name === "Route" &&
    node.callee.property?.name === "useLoaderData"
  ) {
    if (!context.loaderData)
      throw new SafeThemeRuntimeError(
        "Route loader data is unavailable in Design preview.",
      );
    return context.loaderData;
  }
  // A root route reads published content through the router context its
  if (
    node.callee?.type === "Identifier" &&
    node.callee.name === "encodeURIComponent" &&
    node.arguments?.length === 1
  ) {
    const value = evaluateExpression(node.arguments[0], env, context);
    if (typeof value !== "string")
      throw new SafeThemeRuntimeError("encodeURIComponent requires a string.");
    return encodeURIComponent(value);
  }

  // A root route reads published content through the router context its
  // `beforeLoad` populated. The preview has no router and never runs a loader,
  // so it answers with the same shape resolved from the Document, which is what
  // lets one authored root route serve both planes.
  if (
    (node.callee?.type === "Identifier" &&
      node.callee.name === THEME_ROUTE_CONTEXT_HOOK) ||
    (node.callee?.type === "MemberExpression" &&
      node.callee.computed !== true &&
      node.callee.property?.type === "Identifier" &&
      node.callee.property.name === THEME_ROUTE_CONTEXT_HOOK)
  ) {
    return { [THEME_CONTENT_CONTEXT_KEY]: context.contentSlots ?? {} };
  }

  if (
    node.callee?.type === "Identifier" &&
    node.callee.name === THEME_CONTENT_SLOT_HELPER
  ) {
    // The slot id must be a literal: the editor has to know which slots a route
    // declares before the Theme ever runs, so a computed id could not be listed,
    // ordered or edited.
    const slotArgument = node.arguments?.[0];
    if (slotArgument?.type !== "StringLiteral") {
      throw new SafeThemeRuntimeError(
        `${THEME_CONTENT_SLOT_HELPER}() requires a literal slot id.`,
      );
    }
    if (!isValidThemeContentSlotId(slotArgument.value)) {
      throw new SafeThemeRuntimeError(
        `Invalid content slot id "${String(slotArgument.value).slice(0, 64)}".`,
      );
    }
    return resolveThemeContentSlot(context.contentSlots, slotArgument.value);
  }

  if (
    node.callee?.type === "Identifier" &&
    node.callee.name === THEME_SECTION_HIDDEN_HELPER
  ) {
    const slotArgument = node.arguments?.[0];
    if (slotArgument?.type !== "StringLiteral") {
      throw new SafeThemeRuntimeError(
        `${THEME_SECTION_HIDDEN_HELPER}() requires a literal slot id.`,
      );
    }
    // The Design preview renders the section it is editing, hidden or not —
    // an author has to be able to see and unhide it. The published runtime is
    // what honours the flag; both engines answer the same call so a route
    // written against it stays renderable here.
    return (context.hiddenContentSlots ?? []).includes(slotArgument.value)
      ? true
      : false;
  }

  if (
    node.callee?.type === "Identifier" &&
    ["cn", "clsx", "twMerge"].includes(node.callee.name)
  ) {
    return safeClassNames(
      node.arguments.map((argument: any) =>
        evaluateExpression(argument, env, context),
      ),
    );
  }

  if (
    node.callee?.type === "MemberExpression" ||
    node.callee?.type === "OptionalMemberExpression"
  ) {
    const receiver = evaluateExpression(node.callee.object, env, context);
    const method = propertyName(node.callee, env);
    if (method === "map" && Array.isArray(receiver)) {
      if (receiver.length > MAX_MAP_ITEMS) {
        throw new SafeThemeRuntimeError(
          `Theme list exceeds the ${MAX_MAP_ITEMS} item preview limit.`,
        );
      }
      const callback = node.arguments[0];
      if (
        callback?.type !== "ArrowFunctionExpression" &&
        callback?.type !== "FunctionExpression"
      ) {
        throw new SafeThemeRuntimeError(
          "Theme list rendering requires an inline map callback.",
        );
      }
      const arrayPath = expressionPath(node.callee.object);
      return receiver.map((item, index) => {
        const mapEnv = Object.create(env) as Record<string, unknown>;
        mapEnv.__morphArrayPath = arrayPath;
        mapEnv.__morphArrayIndex = index;
        mapEnv.__morphArrayItem = item;
        // Name the callback gave the item, so `{item.title}` can be read back
        // as the field `title` without the author marking the element.
        mapEnv.__morphArrayItemName =
          callback.params?.[0]?.type === "Identifier"
            ? callback.params[0].name
            : null;
        mapEnv.__morphMapRootRendered = false;
        return evaluateFunctionBody(
          callback,
          [item, index, receiver],
          mapEnv,
          context,
        );
      });
    }

    const pure = evaluatePureMethod(receiver, method, node, env, context);
    if (pure !== NOT_A_PURE_METHOD) return pure;
  }

  throw new SafeThemeRuntimeError(
    `${describeCallee(node.callee)} is not supported by the safe Design preview.`,
  );
}

/**
 * Names the unsupported call so a Theme author can find it.
 *
 * Only the callee's own identifiers are used: a source path here would end up
 * in an editor diagnostic for a file the reader may not own.
 */
function describeCallee(callee: any): string {
  if (callee?.type === "Identifier") return `${callee.name}()`;
  if (
    callee?.type === "MemberExpression" &&
    callee.computed !== true &&
    callee.property?.type === "Identifier"
  ) {
    const object =
      callee.object?.type === "Identifier" ? `${callee.object.name}.` : "";
    return `${object}${callee.property.name}()`;
  }
  return "This function call";
}

function evaluateExpression(
  node: any,
  env: Record<string, unknown>,
  context: RuntimeContext | null,
): any {
  if (!node) return null;
  if (
    node.type === "TSAsExpression" ||
    node.type === "TSTypeAssertion" ||
    node.type === "TSNonNullExpression" ||
    node.type === "ParenthesizedExpression"
  ) {
    return evaluateExpression(node.expression, env, context);
  }
  switch (node.type) {
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
      return node.value;
    case "NullLiteral":
      return null;
    case "Identifier":
      if (node.name === "undefined") return undefined;
      return env[node.name];
    case "ArrayExpression":
      return node.elements.map((item: any) =>
        evaluateExpression(item, env, context),
      );
    case "ObjectExpression": {
      const value: Record<string, unknown> = {};
      for (const property of node.properties ?? []) {
        if (property.type === "SpreadElement") {
          const spread = evaluateExpression(property.argument, env, context);
          if (spread && typeof spread === "object")
            Object.assign(value, spread);
          continue;
        }
        const key = property.key?.name ?? property.key?.value;
        if (typeof key === "string" && !BLOCKED_PROPERTIES.has(key)) {
          value[key] = evaluateExpression(property.value, env, context);
        }
      }
      return value;
    }
    case "MemberExpression":
    case "OptionalMemberExpression":
      return safeMember(
        evaluateExpression(node.object, env, context),
        propertyName(node, env),
      );
    case "TemplateLiteral":
      return node.quasis
        .map(
          (part: any, index: number) =>
            part.value.cooked +
            (index < node.expressions.length
              ? String(
                  evaluateExpression(node.expressions[index], env, context) ??
                    "",
                )
              : ""),
        )
        .join("");
    case "LogicalExpression": {
      const left = evaluateExpression(node.left, env, context);
      if (node.operator === "&&")
        return left && evaluateExpression(node.right, env, context);
      if (node.operator === "||")
        return left || evaluateExpression(node.right, env, context);
      if (node.operator === "??")
        return left ?? evaluateExpression(node.right, env, context);
      return undefined;
    }
    case "ConditionalExpression":
      return evaluateExpression(node.test, env, context)
        ? evaluateExpression(node.consequent, env, context)
        : evaluateExpression(node.alternate, env, context);
    case "UnaryExpression": {
      const value = evaluateExpression(node.argument, env, context);
      if (node.operator === "!") return !value;
      if (node.operator === "-") return -Number(value);
      if (node.operator === "+") return Number(value);
      return undefined;
    }
    case "BinaryExpression": {
      const left = evaluateExpression(node.left, env, context);
      const right = evaluateExpression(node.right, env, context);
      switch (node.operator) {
        case "+":
          return (left as any) + (right as any);
        case "-":
          return Number(left) - Number(right);
        case "*":
          return Number(left) * Number(right);
        case "/":
          return Number(left) / Number(right);
        case "===":
        case "==":
          return left === right;
        case "!==":
        case "!=":
          return left !== right;
        case ">":
          return Number(left) > Number(right);
        case ">=":
          return Number(left) >= Number(right);
        case "<":
          return Number(left) < Number(right);
        case "<=":
          return Number(left) <= Number(right);
        case "%":
          return Number(left) % Number(right);
        case "**":
          return Number(left) ** Number(right);
        default:
          // Silence here is the dangerous answer: an unsupported operator that
          // evaluates to `undefined` turns a condition false and quietly drops
          // whatever it guarded, so the preview shows a page the build does not.
          throw new SafeThemeRuntimeError(
            `The ${node.operator} operator is not supported by the safe Design preview.`,
          );
      }
    }
    case "CallExpression":
    case "OptionalCallExpression":
      if (!context) return undefined;
      return evaluateCall(node, env, context);
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return node;
    case "JSXElement":
      if (!context) return null;
      return renderJsxElement(node, env, context);
    case "JSXFragment":
      if (!context) return null;
      return createElement(
        Fragment,
        null,
        ...renderJsxChildren(node.children, env, context),
      );
    default:
      return undefined;
  }
}

function sanitizeUrl(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const compact = value.trim().replace(/[\\u0000-\\u0020]+/g, "");
  if (/^(?:javascript|vbscript|data:text\/html):/i.test(compact)) return "";
  return value;
}

function sanitizeProps(props: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(props)) {
    if (
      /^on[A-Z]/.test(key) ||
      key === "dangerouslySetInnerHTML" ||
      key === "srcDoc" ||
      key === "ref"
    ) {
      continue;
    }
    if (["href", "src", "action", "formAction", "xlinkHref"].includes(key)) {
      safe[key] = sanitizeUrl(rawValue);
      continue;
    }
    if (key === "style") {
      if (
        !rawValue ||
        typeof rawValue !== "object" ||
        Array.isArray(rawValue)
      ) {
        continue;
      }
      const style: Record<string, string | number> = {};
      for (const [styleKey, styleValue] of Object.entries(rawValue)) {
        if (
          (typeof styleValue === "string" || typeof styleValue === "number") &&
          !/javascript\s*:/i.test(String(styleValue))
        ) {
          style[styleKey] = styleValue;
        }
      }
      safe.style = style;
      continue;
    }
    safe[key] = rawValue;
  }
  if (safe.target === "_blank" && typeof safe.rel !== "string") {
    safe.rel = "noopener noreferrer";
  }
  return safe;
}

function jsxName(node: any): string | null {
  return node?.type === "JSXIdentifier" ? node.name : null;
}

function renderJsxChildren(
  children: any[],
  env: Record<string, unknown>,
  context: RuntimeContext,
): ReactNode[] {
  return children.flatMap((child) => {
    if (child.type === "JSXText") {
      const text = normalizeJsxText(child.value);
      return text ? [text] : [];
    }
    if (child.type === "JSXExpressionContainer") {
      const value = evaluateExpression(child.expression, env, context);
      return Array.isArray(value) ? value : [value];
    }
    if (child.type === "JSXElement") {
      return [renderJsxElement(child, env, context)];
    }
    if (child.type === "JSXFragment") {
      return renderJsxChildren(child.children, env, context);
    }
    return [];
  });
}

/**
 * Repeated-item context a child component has to inherit.
 *
 * It lives in the interpreter's environment, and a component imported from
 * another file is evaluated against its own module environment — so without
 * carrying this across the boundary, a row extracted into its own component
 * renders with no row identity at all: every row claims the same field, and
 * writing one would write all of them.
 */
export type ThemeArrayItemContext = Readonly<{
  arrayPath: string;
  arrayIndex: number;
  item: unknown;
  itemName: string | null;
}>;

/**
 * Section identity a `content("slot")` call gives the component it feeds.
 *
 * The route decides which sections a page has and in what order; the Document
 * only stores their values. Without reading the slot back here, two instances
 * of one component fall back to their shared source path and become
 * indistinguishable — editing one would edit both.
 */
function readContentSlotSection(
  node: any,
  context: RuntimeContext,
): SafeThemeSectionIdentity | null {
  for (const attribute of node.openingElement?.attributes ?? []) {
    if (attribute?.type !== "JSXSpreadAttribute") continue;
    const call = attribute.argument;
    if (
      call?.type !== "CallExpression" ||
      call.callee?.type !== "Identifier" ||
      call.callee.name !== THEME_CONTENT_SLOT_HELPER
    ) {
      continue;
    }
    const slot = call.arguments?.[0];
    if (
      slot?.type !== "StringLiteral" ||
      !isValidThemeContentSlotId(slot.value)
    ) {
      continue;
    }
    return {
      sectionId: slot.value,
      // Falls back to the slot id so a section the Document has never stored
      // still has a type, rather than the component losing its identity for
      // want of a value that only exists once someone has edited it.
      sectionType: context.sectionTypeBySlot?.[slot.value] ?? slot.value,
      componentRef: context.componentRefBySlot?.[slot.value] ?? null,
    };
  }
  return null;
}

/**
 * Which repeated-item field each of a child component's props came from.
 *
 * `<Card {...item} />` and `<Card title={item.title} />` both mean the child's
 * `title` edits `items.0.title`. Recorded at the call site because only the
 * parent can see where the value came from; inside the child it is just a prop.
 */
function readItemFieldPathsByProp(
  node: any,
  inherited: ThemeArrayItemContext | null,
): Record<string, string> | null {
  if (!inherited) return null;
  const itemName = inherited.itemName;
  const item = inherited.item;
  const prefix = `${inherited.arrayPath}.${inherited.arrayIndex}`;
  const paths: Record<string, string> = {};

  for (const attribute of node.openingElement?.attributes ?? []) {
    if (attribute?.type === "JSXSpreadAttribute") {
      // `{...item}` hands the child every field of the row.
      if (
        attribute.argument?.type !== "Identifier" ||
        attribute.argument.name !== itemName ||
        !item ||
        typeof item !== "object"
      ) {
        continue;
      }
      for (const key of Object.keys(item as Record<string, unknown>)) {
        if (BLOCKED_PROPERTIES.has(key)) continue;
        paths[key] = `${prefix}.${key}`;
      }
      continue;
    }
    if (
      attribute?.type !== "JSXAttribute" ||
      attribute.name?.type !== "JSXIdentifier" ||
      attribute.value?.type !== "JSXExpressionContainer"
    ) {
      continue;
    }
    const field = inferBoundPropName(attribute.value.expression, itemName);
    if (field && !BLOCKED_PROPERTIES.has(field)) {
      paths[attribute.name.name] = `${prefix}.${field}`;
    }
  }
  return Object.keys(paths).length > 0 ? paths : null;
}

/**
 * Prop names a component's parameter list declares.
 *
 * What a component accepts is stated in its signature; what it was passed this
 * render is not the same thing. A section whose values have never been stored
 * receives `{}`, so validating against the runtime props alone makes a
 * never-edited component permanently uneditable — the field binding it needs
 * in order to be edited only appears once it already has been.
 */
function readDeclaredPropNames(fn: any): ReadonlySet<string> {
  const declared = new Set<string>();
  const parameter = fn?.params?.[0];
  if (parameter?.type !== "ObjectPattern") return declared;
  for (const property of parameter.properties ?? []) {
    if (
      property?.type === "ObjectProperty" &&
      property.computed !== true &&
      property.key?.type === "Identifier"
    ) {
      declared.add(property.key.name);
    }
  }
  return declared;
}

/** Reads the repeated-item context out of an interpreter environment. */
function readArrayItemContext(
  env: Record<string, unknown>,
): ThemeArrayItemContext | null {
  const arrayPath = env.__morphArrayPath;
  const arrayIndex = env.__morphArrayIndex;
  if (typeof arrayPath !== "string" || typeof arrayIndex !== "number") {
    return null;
  }
  return {
    arrayPath,
    arrayIndex,
    item: env.__morphArrayItem,
    itemName:
      typeof env.__morphArrayItemName === "string"
        ? env.__morphArrayItemName
        : null,
  };
}

/** Seeds an environment with an inherited repeated-item context. */
function applyArrayItemContext(
  env: Record<string, unknown>,
  inherited: ThemeArrayItemContext | null,
): void {
  if (!inherited) return;
  env.__morphArrayPath = inherited.arrayPath;
  env.__morphArrayIndex = inherited.arrayIndex;
  env.__morphArrayItem = inherited.item;
  env.__morphArrayItemName = inherited.itemName;
}

/**
 * Prop name a JSX expression reads, when it reads exactly one.
 *
 * `{heading}` and `{item.title ?? ""}` both name a single editable value; an
 * expression that combines several, or computes one, names none. Returning
 * `null` there is deliberate: the Inspector must not offer to edit a field it
 * cannot write back unambiguously.
 */
function inferBoundPropName(
  expression: any,
  itemVariableName: string | null,
): string | null {
  if (!expression) return null;
  switch (expression.type) {
    case "Identifier":
      return expression.name === itemVariableName ? null : expression.name;
    case "MemberExpression":
      if (
        expression.computed !== true &&
        expression.object?.type === "Identifier" &&
        expression.object.name === itemVariableName &&
        expression.property?.type === "Identifier"
      ) {
        return expression.property.name;
      }
      return null;
    // `{item.title ?? ""}` and `{value || "fallback"}`: the left side is the
    // stored value and the right side is only what shows when it is missing.
    case "LogicalExpression":
      return inferBoundPropName(expression.left, itemVariableName);
    case "ConditionalExpression":
      return inferBoundPropName(expression.consequent, itemVariableName);
    case "TSAsExpression":
    case "TSNonNullExpression":
      return inferBoundPropName(expression.expression, itemVariableName);
    default:
      return null;
  }
}

/**
 * Attributes whose bound prop identifies the element's editable content.
 *
 * `to` is here because the router's `<Link>` names its destination that way.
 * Without it an internal link — the form these Themes use for most navigation —
 * would be the one destination the editor could not find the prop for, while
 * the same link written as a plain `<a href>` would work.
 */
const CONTENT_BEARING_ATTRIBUTES = ["src", "href", "to"];

/**
 * Field key for an element the author never marked.
 *
 * `data-morph-element` used to declare this by hand. The interpreter can read
 * it from the JSX instead — the element that renders `{heading}` is the element
 * that edits `heading` — so a component stays fully editable with no markers.
 *
 * The name is accepted only when it is a real prop of the component (or of the
 * repeated item), which keeps an arbitrary local variable from being offered as
 * an editable field.
 */
function inferElementFieldKey(
  node: any,
  env: Record<string, unknown>,
): string | null {
  const itemVariableName =
    typeof env.__morphArrayItemName === "string"
      ? env.__morphArrayItemName
      : null;
  const inMap = typeof env.__morphArrayPath === "string";
  const mappedPaths = env.__morphFieldPathByProp as
    Record<string, string> | null | undefined;
  // Three places a name can legitimately come from: the row being repeated,
  // the component's own props, and a prop the parent renamed on the way in.
  // A row extracted into its own component reads its own prop names, so
  // checking only the row would reject every field it declares.
  const scopes = [
    inMap ? env.__morphArrayItem : null,
    env.__morphComponentProps,
  ].filter(
    (scope): scope is Record<string, unknown> =>
      Boolean(scope) && typeof scope === "object",
  );
  const declaredProps =
    env.__morphDeclaredProps instanceof Set
      ? (env.__morphDeclaredProps as ReadonlySet<string>)
      : null;
  if (scopes.length === 0 && !mappedPaths && !declaredProps) return null;
  const accept = (name: string | null) => {
    if (!name || BLOCKED_PROPERTIES.has(name)) return null;
    if (mappedPaths && name in mappedPaths) return name;
    // Declared before stored: a component that has never been edited has no
    // values yet, and would otherwise never become editable.
    if (declaredProps?.has(name)) return name;
    return scopes.some((scope) => name in scope) ? name : null;
  };

  const meaningfulChildren = (node.children ?? []).filter(
    (child: any) =>
      !(child?.type === "JSXText" && String(child.value ?? "").trim() === ""),
  );
  if (
    meaningfulChildren.length === 1 &&
    meaningfulChildren[0]?.type === "JSXExpressionContainer"
  ) {
    const fromChild = accept(
      inferBoundPropName(
        meaningfulChildren[0].expression,
        inMap ? itemVariableName : null,
      ),
    );
    if (fromChild) return fromChild;
  }

  for (const attribute of node.openingElement?.attributes ?? []) {
    if (
      attribute?.type !== "JSXAttribute" ||
      attribute.name?.type !== "JSXIdentifier" ||
      !CONTENT_BEARING_ATTRIBUTES.includes(attribute.name.name) ||
      attribute.value?.type !== "JSXExpressionContainer"
    ) {
      continue;
    }
    const fromAttribute = accept(
      inferBoundPropName(
        attribute.value.expression,
        inMap ? itemVariableName : null,
      ),
    );
    if (fromAttribute) return fromAttribute;
  }
  return null;
}

/**
 * Collapses JSX text the way JSX itself does.
 *
 * Whitespace that contains a line break is layout in the source rather than
 * content, so it is dropped at both ends; whitespace on a single line is text
 * the author typed. Trimming everything instead turned `{index + 1}. {item}`
 * into "1.a" in the preview and "1. a" in the build.
 */
function normalizeJsxText(value: string): string {
  const lines = value.split("\n");
  if (lines.length === 1) return value.replace(/\s+/g, " ");

  const kept = lines
    .map((line, index) => {
      if (index === 0) return line.replace(/\s+$/, "");
      if (index === lines.length - 1) return line.replace(/^\s+/, "");
      return line.trim();
    })
    .filter((line) => line.length > 0);
  return kept.join(" ");
}

/** Sentinel: distinguishes "not a supported method" from a method returning undefined. */
const NOT_A_PURE_METHOD = Symbol("not-a-pure-method");

/** String methods that only read their receiver and return a new value. */
const PURE_STRING_METHODS = new Set([
  "toUpperCase",
  "toLowerCase",
  "trim",
  "trimStart",
  "trimEnd",
  "slice",
  "split",
  "includes",
  "startsWith",
  "endsWith",
  "replace",
  "replaceAll",
  "padStart",
  "padEnd",
  "repeat",
  "at",
  "charAt",
  "concat",
  "indexOf",
]);

/** Array methods that take no callback and cannot mutate their receiver. */
const PURE_ARRAY_METHODS = new Set([
  "join",
  "slice",
  "includes",
  "indexOf",
  "concat",
  "at",
  "flat",
]);

/** Array methods that take an inline callback and return a new array or value. */
const CALLBACK_ARRAY_METHODS = new Set([
  "filter",
  "find",
  "findIndex",
  "some",
  "every",
  "flatMap",
]);

/**
 * Evaluates a method a Theme author would reasonably use in markup.
 *
 * Everything here reads its receiver and returns a new value: no mutation, no
 * access to anything the expression did not already hold. A Theme that uses one
 * of these renders correctly in the build, so refusing it in the preview makes
 * the editor unable to show a page the storefront serves perfectly well.
 *
 * `map` is handled separately because it also carries the array identity the
 * editor needs to make repeated rows editable.
 */
function evaluatePureMethod(
  receiver: unknown,
  method: string | null,
  node: any,
  env: Record<string, unknown>,
  context: RuntimeContext,
): unknown {
  if (!method) return NOT_A_PURE_METHOD;
  const args = () =>
    (node.arguments ?? []).map((argument: any) =>
      evaluateExpression(argument, env, context),
    );

  if (typeof receiver === "string" && PURE_STRING_METHODS.has(method)) {
    const value = (receiver as unknown as Record<string, unknown>)[method];
    if (typeof value !== "function") return NOT_A_PURE_METHOD;
    return (value as (...rest: unknown[]) => unknown).apply(receiver, args());
  }

  if (Array.isArray(receiver)) {
    if (receiver.length > MAX_MAP_ITEMS) {
      throw new SafeThemeRuntimeError(
        `Theme list exceeds the ${MAX_MAP_ITEMS} item preview limit.`,
      );
    }
    if (PURE_ARRAY_METHODS.has(method)) {
      const value = (receiver as unknown as Record<string, unknown>)[method];
      if (typeof value !== "function") return NOT_A_PURE_METHOD;
      return (value as (...rest: unknown[]) => unknown).apply(receiver, args());
    }
    if (CALLBACK_ARRAY_METHODS.has(method)) {
      const callback = node.arguments?.[0];
      if (
        callback?.type !== "ArrowFunctionExpression" &&
        callback?.type !== "FunctionExpression"
      ) {
        throw new SafeThemeRuntimeError(
          `${method}() requires an inline callback in the Design preview.`,
        );
      }
      const run = (item: unknown, index: number) =>
        evaluateFunctionBody(callback, [item, index, receiver], env, context);
      switch (method) {
        case "filter":
          return receiver.filter((item, index) => Boolean(run(item, index)));
        case "find":
          return receiver.find((item, index) => Boolean(run(item, index)));
        case "findIndex":
          return receiver.findIndex((item, index) => Boolean(run(item, index)));
        case "some":
          return receiver.some((item, index) => Boolean(run(item, index)));
        case "every":
          return receiver.every((item, index) => Boolean(run(item, index)));
        case "flatMap":
          return receiver.flatMap((item, index) => run(item, index) as never);
        default:
          return NOT_A_PURE_METHOD;
      }
    }
  }

  if (typeof receiver === "number" && method === "toFixed") {
    return receiver.toFixed(Number(args()[0] ?? 0));
  }

  return NOT_A_PURE_METHOD;
}

function readJsxProps(
  node: any,
  attributes: any[],
  env: Record<string, unknown>,
  context: RuntimeContext,
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const attribute of attributes) {
    if (attribute.type === "JSXSpreadAttribute") {
      const spread = evaluateExpression(attribute.argument, env, context);
      if (spread && typeof spread === "object") Object.assign(props, spread);
      continue;
    }
    const name = attribute.name?.name;
    if (typeof name !== "string") continue;
    if (!attribute.value) {
      props[name] = true;
    } else if (attribute.value.type === "StringLiteral") {
      props[name] = attribute.value.value;
    } else if (attribute.value.type === "JSXExpressionContainer") {
      props[name] = evaluateExpression(
        attribute.value.expression,
        env,
        context,
      );
    }
  }
  const morphElement =
    typeof props["data-morph-element"] === "string"
      ? String(props["data-morph-element"])
      : null;
  if (morphElement) props["data-storefront-component"] ??= morphElement;

  const arrayPath =
    typeof env.__morphArrayPath === "string" ? env.__morphArrayPath : null;
  const arrayIndex =
    typeof env.__morphArrayIndex === "number" ? env.__morphArrayIndex : null;
  // The first element rendered inside a map callback stands for the whole item,
  // whether or not the author marked it. Gating this on a marker would leave an
  // unmarked repeated component with no per-item identity to select or reorder.
  const isMapRoot =
    arrayPath !== null &&
    arrayIndex !== null &&
    env.__morphMapRootRendered !== true;

  if (isMapRoot) {
    env.__morphMapRootRendered = true;
    props["data-storefront-field"] ??= arrayPath;
    props["data-storefront-field-path"] ??= `${arrayPath}.${arrayIndex}`;
    const item = env.__morphArrayItem;
    if (
      item &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).id === "string"
    ) {
      props["data-storefront-item-id"] ??= (item as Record<string, unknown>).id;
    }
    return sanitizeProps(props);
  }

  // An authored marker still wins: it names the field explicitly, including the
  // two aliases that never matched their prop name.
  const fieldKey = morphElement
    ? morphElement === "action"
      ? "actionLabel"
      : morphElement === "image"
        ? "imageSrc"
        : morphElement
    : inferElementFieldKey(node, env);
  if (fieldKey) {
    // A prop the parent renamed still edits the row field it came from, so the
    // recorded path wins over the one the prop name would imply.
    const mappedPath = (
      env.__morphFieldPathByProp as Record<string, string> | null | undefined
    )?.[fieldKey];
    if (mappedPath) {
      props["data-storefront-field"] ??= mappedPath.slice(
        mappedPath.lastIndexOf(".") + 1,
      );
      props["data-storefront-field-path"] ??= mappedPath;
    } else {
      props["data-storefront-field"] ??= fieldKey;
      if (arrayPath !== null && arrayIndex !== null) {
        props["data-storefront-field-path"] ??=
          `${arrayPath}.${arrayIndex}.${fieldKey}`;
      }
    }
  }
  return sanitizeProps(props);
}

/**
 * Source position of a JSX node being interpreted.
 *
 * Mirrors the build-time annotation exactly, including the 1-based column, so
 * a selection made in one preview mode resolves in the other.
 */
function themeSourceLocationOf(
  node: any,
  context: RuntimeContext,
): string | null {
  const line = node?.openingElement?.loc?.start?.line;
  const column = node?.openingElement?.loc?.start?.column;
  if (typeof line !== "number" || typeof column !== "number") return null;
  const currentFrame =
    context.componentStack[context.componentStack.length - 1];
  const filePath = currentFrame?.split("#")[0];
  if (!filePath || !filePath.startsWith("src/")) return null;
  return `${filePath}:${line}:${column + 1}`;
}

function renderJsxElement(
  node: any,
  env: Record<string, unknown>,
  context: RuntimeContext,
): ReactNode {
  context.nodeCount += 1;
  if (context.nodeCount > MAX_RENDERED_NODES) {
    throw new SafeThemeRuntimeError(
      `Theme preview exceeds the ${MAX_RENDERED_NODES} node limit.`,
    );
  }
  const name = jsxName(node.openingElement?.name);
  if (!name) {
    throw new SafeThemeRuntimeError(
      "Namespaced and member-expression JSX tags are not supported.",
    );
  }
  const props = readJsxProps(
    node,
    node.openingElement.attributes,
    env,
    context,
  );
  let children = renderJsxChildren(node.children ?? [], env, context);

  const fieldPath =
    typeof props["data-storefront-field-path"] === "string"
      ? props["data-storefront-field-path"]
      : typeof props["data-storefront-field"] === "string"
        ? props["data-storefront-field"]
        : null;
  const componentProps = env.__morphComponentProps;
  if (
    fieldPath &&
    componentProps &&
    typeof componentProps === "object" &&
    children.length === 1 &&
    (typeof children[0] === "string" || typeof children[0] === "number")
  ) {
    let boundValue: unknown = componentProps;
    for (const segment of fieldPath.split(".")) {
      if (!segment || BLOCKED_PROPERTIES.has(segment)) {
        boundValue = undefined;
        break;
      }
      boundValue = safeMember(boundValue, segment);
    }
    if (typeof boundValue === "string" || typeof boundValue === "number") {
      children = [boundValue];
    }
  }

  if (name[0] === name[0]?.toLowerCase()) {
    if (BLOCKED_TAGS.has(name)) {
      throw new SafeThemeRuntimeError(
        `The <${name}> tag is not allowed in the safe Design preview.`,
      );
    }
    // The Live preview interprets source instead of running the built bundle,
    // so the build's Babel annotation never reaches it. Emitting the same
    // attribute here keeps element identity identical in both preview modes;
    // without it a component with no authored markers is selectable in Build
    // Preview but not in Live.
    const sourceLocation = themeSourceLocationOf(node, context);
    if (
      sourceLocation &&
      props[MORPH_SOURCE_LOCATION_ATTRIBUTE] === undefined
    ) {
      props[MORPH_SOURCE_LOCATION_ATTRIBUTE] = sourceLocation;
    }
    return createElement(name, props, ...children);
  }

  // Where each of the child's props came from, recorded here because only the
  // call site can see it. `{...item}` needs no mapping — the names already
  // match — but `<Card heading={item.title} />` does.
  const itemFieldPaths = readItemFieldPathsByProp(
    node,
    readArrayItemContext(env),
  );
  // The slot a component is fed from is that instance's identity. Two renders
  // of one component differ only here, so without it both fall back to the
  // source path they share.
  const slotSection = readContentSlotSection(node, context);

  const localFunction = env[`__component:${name}`];
  if (localFunction) {
    return renderFunctionComponent(
      localFunction,
      { ...props, children },
      env,
      context,
      String(env.__sourcePath ?? ""),
      name,
      slotSection ?? undefined,
      itemFieldPaths,
    );
  }

  const imported = env[`__import:${name}`] as
    { path: string; imported: string } | undefined;
  const builtin = env[`__builtin:${name}`] as
    SafeThemeBuiltinComponent | undefined;
  if (builtin) {
    return createElement(builtin, { ...props, children });
  }
  if (!imported) {
    throw new SafeThemeRuntimeError(
      `Component <${name}> is not a local Theme Workspace component.`,
    );
  }
  return renderModuleComponent(
    imported.path,
    imported.imported,
    { ...props, children },
    context,
    slotSection ?? undefined,
    readArrayItemContext(env),
    itemFieldPaths,
  );
}

function annotateComponentRoot(
  node: ReactNode,
  sourcePath: string,
  componentName: string,
  section?: SafeThemeSectionIdentity,
): ReactNode {
  if (!isValidElement(node) || node.type === Fragment) {
    if (section) {
      throw new SafeThemeRuntimeError(
        "A Design-editable section must return one HTML root element.",
      );
    }
    return node;
  }
  const additions: Record<string, unknown> = {
    "data-morph-source-file": sourcePath,
    "data-morph-component": componentName,
  };
  if (section) {
    additions.key = section.sectionId;
    additions["data-storefront-section-id"] = section.sectionId;
    additions["data-storefront-section-type"] = section.sectionType;
    additions["data-morph-component-ref"] =
      section.componentRef ?? `${section.sectionType}.default`;
    if (!(node.props as Record<string, unknown>)["data-morph-section"]) {
      additions["data-morph-section"] = section.sectionType;
    }
  }
  return cloneElement(node as ReactElement<Record<string, unknown>>, additions);
}

function renderFunctionComponent(
  fn: any,
  props: Record<string, unknown>,
  moduleEnv: Record<string, unknown>,
  context: RuntimeContext,
  sourcePath: string,
  componentName: string,
  section?: SafeThemeSectionIdentity,
  itemFieldPaths?: Record<string, string> | null,
): ReactNode {
  const componentEnv = Object.create(moduleEnv) as Record<string, unknown>;
  componentEnv.__morphComponentProps = props;
  componentEnv.__morphDeclaredProps = readDeclaredPropNames(fn);
  // Set unconditionally so a component rendered outside any row clears an
  // inherited mapping rather than reusing the enclosing row's paths.
  componentEnv.__morphFieldPathByProp = itemFieldPaths ?? null;
  const node = evaluateFunctionBody(
    fn,
    [props],
    componentEnv,
    context,
  ) as ReactNode;
  return annotateComponentRoot(node, sourcePath, componentName, section);
}

function renderModuleComponent(
  sourcePath: string,
  exportName: string,
  props: Record<string, unknown>,
  context: RuntimeContext,
  section?: SafeThemeSectionIdentity,
  arrayItem?: ThemeArrayItemContext | null,
  itemFieldPaths?: Record<string, string> | null,
): ReactNode {
  const override = context.resolveComponent?.({
    sourcePath,
    exportName,
    props,
  });
  if (override && !override.render) return null;
  const resolvedProps = override
    ? { ...context.injectedProps, ...props, ...override.props }
    : { ...context.injectedProps, ...props };
  const resolvedSection = override?.section ?? section;

  if (context.componentStack.length >= MAX_COMPONENT_DEPTH) {
    throw new SafeThemeRuntimeError(
      `Theme component depth exceeds ${MAX_COMPONENT_DEPTH}.`,
    );
  }
  const file = context.files.get(sourcePath);
  if (!file) {
    throw new SafeThemeRuntimeError(
      `Theme component source "${sourcePath}" is unavailable.`,
    );
  }
  const cycleKey = `${sourcePath}#${exportName}`;
  if (context.componentStack.includes(cycleKey)) {
    throw new SafeThemeRuntimeError(
      `Recursive Theme component cycle detected at "${cycleKey}".`,
    );
  }
  context.componentStack.push(cycleKey);
  try {
    const module = parseModule(sourcePath, file.content);
    const env: Record<string, unknown> = { __sourcePath: sourcePath };
    // A row extracted into its own file is still a row. Without this the child
    // renders with no repeated-item identity and every row claims the same
    // field, so editing one would edit all of them.
    applyArrayItemContext(env, arrayItem ?? null);
    for (const [name, imported] of module.imports) {
      const importedPath = resolveLocalImport(
        context.files,
        sourcePath,
        imported.source,
      );
      // The platform content module is modelled natively: `content()` is
      // resolved from the Document above, and its provider only exists so the
      // deployed Theme can pass server-loaded values down. Interpreting the
      // module itself would mean supporting `createContext`, which the preview
      // deliberately does not, for a value the preview never reads.
      if (importedPath === THEME_CONTENT_MODULE_PATH) {
        env[`__builtin:${name}`] = (builtinProps: Record<string, unknown>) => {
          const children = builtinProps.children;
          // Spread rather than passed as one array child: the interpreter
          // builds children positionally and has no keys to give them.
          return createElement(
            Fragment,
            null,
            ...(Array.isArray(children) ? children : [children ?? null]),
          );
        };
        continue;
      }
      if (importedPath) {
        env[`__import:${name}`] = {
          path: importedPath,
          imported: imported.imported,
        };
        continue;
      }
      const builtin =
        context.builtinComponents[imported.source]?.[imported.imported];
      if (builtin) {
        env[`__builtin:${name}`] = builtin;
      }
    }
    for (const [name, fn] of module.functions) {
      env[`__component:${name}`] = fn;
    }
    for (const declaration of module.variables) {
      if (
        declaration.id?.type === "Identifier" &&
        !module.functions.has(declaration.id.name) &&
        declaration.id.name !== "Route"
      ) {
        env[declaration.id.name] = evaluateExpression(
          declaration.init,
          env,
          context,
        );
      }
    }

    let fn: any = null;
    let componentName = exportName;
    if (exportName === "default") {
      const declaration = module.defaultExport;
      if (declaration?.type === "Identifier") {
        componentName = declaration.name;
        fn = module.functions.get(declaration.name);
      } else {
        fn = declaration;
        componentName = declaration?.id?.name ?? "DefaultComponent";
      }
    } else {
      fn = module.functions.get(exportName);
    }
    if (
      fn?.type !== "FunctionDeclaration" &&
      fn?.type !== "FunctionExpression" &&
      fn?.type !== "ArrowFunctionExpression"
    ) {
      throw new SafeThemeRuntimeError(
        `Theme component export "${exportName}" was not found in "${sourcePath}".`,
      );
    }
    return renderFunctionComponent(
      fn,
      resolvedProps,
      env,
      context,
      sourcePath,
      componentName,
      resolvedSection,
      itemFieldPaths ?? null,
    );
  } finally {
    context.componentStack.pop();
  }
}

export function renderSafeThemeComponent({
  loaderData,
  files,
  sourcePath,
  props,
  section,
  componentName = "default",
  builtinComponents = {},
  injectedProps = {},
  resolveComponent,
  contentSlots,
  sectionTypeBySlot,
  componentRefBySlot,
}: {
  loaderData?: Record<string, unknown>;
  files: ThemeSourceFile[];
  sourcePath: string;
  props: Record<string, unknown>;
  section?: SafeThemeSectionIdentity;
  componentName?: string;
  builtinComponents?: SafeThemeBuiltinComponentMap;
  injectedProps?: Record<string, unknown>;
  resolveComponent?: SafeThemeComponentResolver;
  contentSlots?: ThemeContentSlotValues;
  /**
   * Sections the author hid. Empty in the Design preview, which shows a hidden
   * section so it can be seen and unhidden.
   */
  hiddenContentSlots?: readonly string[];
  sectionTypeBySlot?: Readonly<Record<string, string>>;
  componentRefBySlot?: Readonly<Record<string, string>>;
}): SafeThemeComponentRenderResult {
  const fileMap = new Map(
    files.map((file) => [normalizePath(file.path), file]),
  );
  const normalizedSourcePath = normalizePath(sourcePath);
  const context: RuntimeContext = {
    loaderData,
    files: fileMap,
    // `<Link>` is not route-specific: authors use it in ordinary components
    // such as headers, footers and hero sections, which render through this
    // entry point on their own. Provide it by default so those components are
    // interpreted instead of refused, while callers (the route renderer) can
    // still override the module's builtins to add `Outlet`.
    builtinComponents: {
      ...builtinComponents,
      [TANSTACK_ROUTER_MODULE]: {
        Link: renderThemeRouterLink,
        ...builtinComponents[TANSTACK_ROUTER_MODULE],
      },
    },
    injectedProps,
    resolveComponent,
    contentSlots,
    sectionTypeBySlot,
    componentRefBySlot,
    nodeCount: 0,
    componentStack: [],
    diagnostics: [],
  };
  try {
    return {
      success: true,
      node: renderModuleComponent(
        normalizedSourcePath,
        componentName,
        props,
        context,
        section,
      ),
      diagnostics: [],
    };
  } catch (error) {
    return {
      success: false,
      node: null,
      diagnostics: [
        error instanceof Error
          ? error.message
          : "The Theme component could not be rendered safely.",
      ],
    };
  }
}
