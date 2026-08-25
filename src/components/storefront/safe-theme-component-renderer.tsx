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
  files: Map<string, ThemeSourceFile>;
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
    for (const property of pattern.properties ?? []) {
      if (property.type === "RestElement") continue;
      const key = property.key?.name ?? property.key?.value;
      bindPattern(property.value, record[key], env, context);
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
        mapEnv.__morphMapRootRendered = false;
        return evaluateFunctionBody(
          callback,
          [item, index, receiver],
          mapEnv,
          context,
        );
      });
    }
  }

  throw new SafeThemeRuntimeError(
    "This function call is not supported by the safe Design preview.",
  );
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
        default:
          return undefined;
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
      const text = child.value.replace(/\s+/g, " ").trim();
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

function readJsxProps(
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
  if (morphElement) {
    props["data-storefront-component"] ??= morphElement;
    const arrayPath =
      typeof env.__morphArrayPath === "string" ? env.__morphArrayPath : null;
    const arrayIndex =
      typeof env.__morphArrayIndex === "number" ? env.__morphArrayIndex : null;
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
        props["data-storefront-item-id"] ??= (
          item as Record<string, unknown>
        ).id;
      }
    } else {
      const fieldKey =
        morphElement === "action"
          ? "actionLabel"
          : morphElement === "image"
            ? "imageSrc"
            : morphElement;
      props["data-storefront-field"] ??= fieldKey;
      if (arrayPath !== null && arrayIndex !== null) {
        props["data-storefront-field-path"] ??=
          `${arrayPath}.${arrayIndex}.${fieldKey}`;
      }
    }
  }
  return sanitizeProps(props);
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
  const props = readJsxProps(node.openingElement.attributes, env, context);
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
    return createElement(name, props, ...children);
  }

  const localFunction = env[`__component:${name}`];
  if (localFunction) {
    return renderFunctionComponent(
      localFunction,
      { ...props, children },
      env,
      context,
      String(env.__sourcePath ?? ""),
      name,
    );
  }

  const imported = env[`__import:${name}`] as
    { path: string; imported: string } | undefined;
  const builtin = env[`__builtin:${name}`] as
    | SafeThemeBuiltinComponent
    | undefined;
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
): ReactNode {
  const componentEnv = Object.create(moduleEnv) as Record<string, unknown>;
  componentEnv.__morphComponentProps = props;
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
    for (const [name, imported] of module.imports) {
      const importedPath = resolveLocalImport(
        context.files,
        sourcePath,
        imported.source,
      );
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
    );
  } finally {
    context.componentStack.pop();
  }
}

export function renderSafeThemeComponent({
  files,
  sourcePath,
  props,
  section,
  componentName = "default",
  builtinComponents = {},
  injectedProps = {},
  resolveComponent,
}: {
  files: ThemeSourceFile[];
  sourcePath: string;
  props: Record<string, unknown>;
  section?: SafeThemeSectionIdentity;
  componentName?: string;
  builtinComponents?: SafeThemeBuiltinComponentMap;
  injectedProps?: Record<string, unknown>;
  resolveComponent?: SafeThemeComponentResolver;
}): SafeThemeComponentRenderResult {
  const fileMap = new Map(
    files.map((file) => [normalizePath(file.path), file]),
  );
  const normalizedSourcePath = normalizePath(sourcePath);
  const context: RuntimeContext = {
    files: fileMap,
    builtinComponents,
    injectedProps,
    resolveComponent,
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
