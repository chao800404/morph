import { parse } from "@babel/parser";
import {
  deriveThemeLayoutSections,
  deriveThemeRouteSections,
  type ThemeRouteSection,
} from "../compiler/theme-route-sections";
import { isThemeSectionSourcePath } from "../theme-section-convention";
import { parseColocatedContentFields } from "../ast/theme-content-fields-source";
import { isValidThemeContentSlotId } from "../theme-content-slots";

/**
 * Whether fixed text written in a component can become a Design-editable
 * field — and, when it cannot, why.
 *
 * The feature this serves turns `<p>hello world</p>` into a prop whose
 * default is `"hello world"`, so the page renders exactly as before, and
 * stores the author's edit as this page's override in the Document. That is
 * only safe when the text is one fixed string at one place in the source that
 * one prop can stand in for, and when the page that renders the component will
 * actually hand the Document's value to that prop. Anything this cannot prove
 * is reported as Code-only with the reason, never guessed at.
 *
 * Pure analysis of the saved source: the same answer serves the Inspector,
 * which only describes it, and the server, which must decide for itself
 * rather than trust what the editor saw.
 */

export type TextPromotionRefusal =
  /** The source did not parse. */
  | "parse-error"
  /** No element at the selected position. */
  | "not-found"
  /** The element holds markup, expressions, or nothing but whitespace. */
  | "not-plain-text"
  /** Rendered by a `map()`: one source element, many rendered ones. */
  | "inside-loop"
  /** Rendered from an expression — a condition, a ternary, a callback. */
  | "inside-expression"
  /** Not inside the file's default-exported component function. */
  | "not-in-default-component"
  /** Written in a component the section uses, not in the section itself. */
  | "in-nested-component"
  /** Props are not destructured, so there is nowhere to add a default. */
  | "props-not-destructured"
  /** Props are typed by a type this file does not define. */
  | "props-type-elsewhere"
  /** The component declares no fields here and none can be inferred. */
  | "no-field-capability"
  /** No page or layout renders this section through `content(...)`. */
  | "call-site-not-found"
  /** The page spreads something after `content(...)` that could win. */
  | "call-site-opaque";

export type TextPromotionAnalysis =
  | Readonly<{
      status: "convertible";
      /** The text as it renders: JSX whitespace applied, entities decoded. */
      text: string;
      tag: string;
      /** A free prop name for it; the author confirms or changes it. */
      suggestedName: string;
      /** Names the new prop must not take. */
      reservedNames: readonly string[];
      /** How the component's fields are known, and so where one is added. */
      fieldDeclaration: "colocated" | "inferred";
      callSite: Readonly<{ path: string; scope: "route" | "layout" }>;
    }>
  | Readonly<{
      status: "code-only";
      reason: TextPromotionRefusal;
      /** The fixed text, when there was one to read. */
      text?: string;
    }>;

export type TextPromotionInput = Readonly<{
  files: readonly Readonly<{ path: string; content: string }>[];
  /** The file the element is written in. */
  componentSourcePath: string;
  /**
   * The section's own component, when it is not that file. Only the section
   * receives the Document's values; a component it renders gets whatever the
   * section chooses to pass on.
   */
  sectionSourcePath?: string;
  /** `data-morph-node` of the element, or its `line:column`. */
  targetKey: string;
  /** The Document section — the `content("slot")` it is rendered through. */
  slotId: string;
  /** The route being edited; the layout is found from the files. */
  routeSourcePath: string | null;
}>;

const LOOP_METHODS = new Set(["map", "flatMap"]);

type AnyNode = Record<string, any>;

function parseSource(content: string): AnyNode | null {
  try {
    return parse(content, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    }) as unknown as AnyNode;
  } catch {
    return null;
  }
}

function isNode(value: unknown): value is AnyNode {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as AnyNode).type === "string"
  );
}

/** Every node, with the chain of ancestors above it. */
function walk(
  node: unknown,
  ancestors: AnyNode[],
  visit: (node: AnyNode, ancestors: readonly AnyNode[]) => boolean | void,
): boolean {
  if (!isNode(node)) return false;
  if (visit(node, ancestors) === true) return true;
  ancestors.push(node);
  try {
    for (const [key, value] of Object.entries(node)) {
      if (
        key === "loc" ||
        key === "start" ||
        key === "end" ||
        key === "extra"
      ) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const child of value) {
          if (walk(child, ancestors, visit)) return true;
        }
      } else if (walk(value, ancestors, visit)) {
        return true;
      }
    }
  } finally {
    ancestors.pop();
  }
  return false;
}

function staticAttribute(element: AnyNode, name: string): string | null {
  for (const attribute of element.openingElement?.attributes ?? []) {
    if (
      attribute?.type !== "JSXAttribute" ||
      attribute.name?.type !== "JSXIdentifier" ||
      attribute.name.name !== name
    ) {
      continue;
    }
    const value = attribute.value;
    if (value?.type === "StringLiteral") return value.value;
    if (
      value?.type === "JSXExpressionContainer" &&
      value.expression?.type === "StringLiteral"
    ) {
      return value.expression.value;
    }
  }
  return null;
}

function locationKey(element: AnyNode): string | null {
  const start = element.openingElement?.loc?.start;
  return typeof start?.line === "number"
    ? `${start.line}:${(start.column ?? 0) + 1}`
    : null;
}

/**
 * JSX text as React renders it.
 *
 * Babel's own rule (`cleanJSXElementLiteralChild`): lines are trimmed where
 * they meet a line break, lines left empty are dropped, and the rest are
 * joined with single spaces. Without it the default written into the prop
 * would carry the source's indentation, and the page would change the moment
 * the text became a prop.
 */
export function renderedJsxText(value: string): string {
  const lines = value.split(/\r\n|\n|\r/);
  let lastNonEmptyLine = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (/[^ \t]/.test(lines[index]!)) lastNonEmptyLine = index;
  }
  let result = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const isFirstLine = index === 0;
    const isLastLine = index === lines.length - 1;
    const isLastNonEmptyLine = index === lastNonEmptyLine;
    let trimmed = line.replace(/\t/g, " ");
    if (!isFirstLine) trimmed = trimmed.replace(/^[ ]+/, "");
    if (!isLastLine) trimmed = trimmed.replace(/[ ]+$/, "");
    if (trimmed) {
      if (!isLastNonEmptyLine) trimmed += " ";
      result += trimmed;
    }
  }
  return result;
}

/** The single text child of an element, as rendered, or null. */
function plainText(element: AnyNode): string | null {
  let text: string | null = null;
  for (const child of element.children ?? []) {
    if (child?.type === "JSXText") {
      const rendered = renderedJsxText(child.value ?? "");
      if (rendered === "") continue;
      if (text !== null) return null;
      text = rendered;
      continue;
    }
    // Markup, an expression, or anything else: not one fixed string.
    return null;
  }
  return text;
}

function isLoopCallback(ancestor: AnyNode, parent: AnyNode | undefined) {
  return (
    parent?.type === "CallExpression" &&
    parent.arguments?.includes(ancestor) &&
    (parent.callee?.type === "MemberExpression" ||
      parent.callee?.type === "OptionalMemberExpression") &&
    parent.callee.property?.type === "Identifier" &&
    LOOP_METHODS.has(parent.callee.property.name)
  );
}

function isFunction(node: AnyNode | undefined): boolean {
  return (
    node?.type === "FunctionDeclaration" ||
    node?.type === "FunctionExpression" ||
    node?.type === "ArrowFunctionExpression"
  );
}

/** The default export's component function, if the file has one. */
function defaultComponent(program: AnyNode): AnyNode | null {
  const localFunctions = new Map<string, AnyNode>();
  for (const statement of program.body ?? []) {
    if (statement?.type === "FunctionDeclaration" && statement.id?.name) {
      localFunctions.set(statement.id.name, statement);
    }
    if (statement?.type === "VariableDeclaration") {
      for (const declarator of statement.declarations ?? []) {
        if (
          declarator?.id?.type === "Identifier" &&
          isFunction(declarator.init)
        ) {
          localFunctions.set(declarator.id.name, declarator.init);
        }
      }
    }
  }
  for (const statement of program.body ?? []) {
    if (statement?.type !== "ExportDefaultDeclaration") continue;
    const declaration = statement.declaration;
    if (isFunction(declaration)) return declaration;
    if (declaration?.type === "Identifier") {
      return localFunctions.get(declaration.name) ?? null;
    }
  }
  return null;
}

/** Member names of the props type, when this file defines it. */
function propsTypeMembers(
  program: AnyNode,
  parameter: AnyNode,
): { ok: true; names: string[] } | { ok: false } {
  const annotation = parameter.typeAnnotation?.typeAnnotation;
  if (!annotation) return { ok: true, names: [] };
  const membersOf = (literal: AnyNode) =>
    (literal.members ?? literal.body?.body ?? [])
      .map((member: AnyNode) =>
        member?.key?.type === "Identifier"
          ? member.key.name
          : member?.key?.type === "StringLiteral"
            ? member.key.value
            : null,
      )
      .filter((name: string | null): name is string => name !== null);
  if (annotation.type === "TSTypeLiteral") {
    return { ok: true, names: membersOf(annotation) };
  }
  if (
    annotation.type === "TSTypeReference" &&
    annotation.typeName?.type === "Identifier" &&
    !annotation.typeParameters
  ) {
    const name = annotation.typeName.name;
    for (const statement of program.body ?? []) {
      const declaration =
        statement?.type === "ExportNamedDeclaration"
          ? statement.declaration
          : statement;
      if (
        declaration?.type === "TSTypeAliasDeclaration" &&
        declaration.id?.name === name &&
        declaration.typeAnnotation?.type === "TSTypeLiteral"
      ) {
        return { ok: true, names: membersOf(declaration.typeAnnotation) };
      }
      if (
        declaration?.type === "TSInterfaceDeclaration" &&
        declaration.id?.name === name &&
        !(declaration.extends?.length > 0)
      ) {
        return { ok: true, names: membersOf(declaration) };
      }
    }
  }
  // Imported, generic, intersected, or otherwise out of this file's hands.
  return { ok: false };
}

function destructuredNames(pattern: AnyNode): string[] {
  const names: string[] = [];
  for (const property of pattern.properties ?? []) {
    if (property?.type === "RestElement") {
      if (property.argument?.type === "Identifier") {
        names.push(property.argument.name);
      }
      continue;
    }
    const key = property?.key;
    if (key?.type === "Identifier") names.push(key.name);
    else if (key?.type === "StringLiteral") names.push(key.value);
  }
  return names;
}

function hasRestProps(pattern: AnyNode): boolean {
  return (pattern.properties ?? []).some(
    (property: AnyNode) => property?.type === "RestElement",
  );
}

function readSlotId(element: AnyNode): string | null {
  for (const attribute of element.openingElement?.attributes ?? []) {
    const call =
      attribute?.type === "JSXSpreadAttribute" ? attribute.argument : null;
    if (
      call?.type === "CallExpression" &&
      call.callee?.type === "Identifier" &&
      call.callee.name === "content" &&
      call.arguments?.[0]?.type === "StringLiteral" &&
      isValidThemeContentSlotId(call.arguments[0].value)
    ) {
      return call.arguments[0].value;
    }
  }
  return null;
}

/**
 * What the page passes to the section after the Document's values.
 *
 * `{...content("slot")}` spreads the Document's props onto the component. An
 * explicit prop written after it wins over the Document, and so would make a
 * converted field uneditable on that page; a spread after it could hold
 * anything.
 */
function callSiteAfterContent(
  source: string,
  slotId: string,
): { found: false } | { found: true; explicit: string[]; opaque: boolean } {
  const ast = parseSource(source);
  if (!ast) return { found: false };
  let result: { explicit: string[]; opaque: boolean } | null = null;
  walk(ast.program, [], (node) => {
    if (node.type !== "JSXElement" || readSlotId(node) !== slotId) return;
    const explicit: string[] = [];
    let opaque = false;
    let afterContent = false;
    for (const attribute of node.openingElement?.attributes ?? []) {
      if (attribute?.type === "JSXSpreadAttribute") {
        const call = attribute.argument;
        const isContent =
          call?.type === "CallExpression" &&
          call.callee?.type === "Identifier" &&
          call.callee.name === "content";
        if (isContent) {
          afterContent = true;
          continue;
        }
        if (afterContent) opaque = true;
        continue;
      }
      if (
        afterContent &&
        attribute?.type === "JSXAttribute" &&
        attribute.name?.type === "JSXIdentifier"
      ) {
        explicit.push(attribute.name.name);
      }
    }
    result = { explicit, opaque };
    return true;
  });
  return result
    ? { found: true, ...(result as { explicit: string[]; opaque: boolean }) }
    : { found: false };
}

/** Where this section is rendered through `content(slot)`. */
function findCallSite(
  input: TextPromotionInput,
): { path: string; scope: "route" | "layout" } | null {
  const matches = (section: ThemeRouteSection) =>
    section.slotId === input.slotId &&
    section.componentSourcePath === input.componentSourcePath;
  if (input.routeSourcePath) {
    const route = deriveThemeRouteSections(input.files, input.routeSourcePath);
    const section = route.sections.find(matches);
    if (section) return { path: section.routeSourcePath, scope: "route" };
  }
  const layout = deriveThemeLayoutSections(input.files);
  const section = layout.sections.find(matches);
  return section ? { path: section.routeSourcePath, scope: "layout" } : null;
}

const NAME_FOR_TAG: Record<string, string> = {
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  p: "text",
  span: "label",
  small: "label",
  strong: "label",
  em: "label",
  label: "label",
  a: "label",
  button: "label",
  li: "item",
  blockquote: "quote",
  figcaption: "caption",
};

function freeName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function analyzeTextPromotion(
  input: TextPromotionInput,
): TextPromotionAnalysis {
  const file = input.files.find(
    (candidate) => candidate.path === input.componentSourcePath,
  );
  const ast = file ? parseSource(file.content) : null;
  if (!file || !ast) return { status: "code-only", reason: "parse-error" };

  let target: AnyNode | null = null;
  let targetAncestors: AnyNode[] = [];
  walk(ast.program, [], (node, ancestors) => {
    if (node.type !== "JSXElement") return;
    if (
      staticAttribute(node, "data-morph-node") === input.targetKey ||
      locationKey(node) === input.targetKey
    ) {
      target = node;
      targetAncestors = [...ancestors];
      return true;
    }
  });
  if (!target) return { status: "code-only", reason: "not-found" };
  const element = target as AnyNode;

  const text = plainText(element);
  if (text === null) return { status: "code-only", reason: "not-plain-text" };
  if (
    input.sectionSourcePath !== undefined &&
    input.sectionSourcePath !== input.componentSourcePath
  ) {
    return { status: "code-only", reason: "in-nested-component", text };
  }

  // Up to the component function: the element must sit in plain JSX, not
  // under an expression that decides how many times, or whether, it renders.
  const component = defaultComponent(ast.program);
  const componentIndex = component ? targetAncestors.indexOf(component) : -1;
  if (componentIndex === -1) {
    return { status: "code-only", reason: "not-in-default-component", text };
  }
  const between = targetAncestors.slice(componentIndex + 1);
  for (let index = 0; index < between.length; index += 1) {
    const ancestor = between[index]!;
    if (isFunction(ancestor) && isLoopCallback(ancestor, between[index - 1])) {
      return { status: "code-only", reason: "inside-loop", text };
    }
  }
  for (const ancestor of between) {
    if (ancestor.type === "JSXExpressionContainer" || isFunction(ancestor)) {
      return { status: "code-only", reason: "inside-expression", text };
    }
  }

  const parameter = component!.params?.[0];
  if (parameter?.type !== "ObjectPattern" || hasRestProps(parameter)) {
    return { status: "code-only", reason: "props-not-destructured", text };
  }
  const typeMembers = propsTypeMembers(ast.program, parameter);
  if (!typeMembers.ok) {
    return { status: "code-only", reason: "props-type-elsewhere", text };
  }

  const declared = parseColocatedContentFields(file.content);
  let fieldDeclaration: "colocated" | "inferred";
  if (declared.declaration === "valid") fieldDeclaration = "colocated";
  else if (
    declared.declaration === "absent" &&
    isThemeSectionSourcePath(input.componentSourcePath)
  ) {
    fieldDeclaration = "inferred";
  } else {
    return { status: "code-only", reason: "no-field-capability", text };
  }

  const callSite = findCallSite(input);
  const callSiteFile = callSite
    ? input.files.find((candidate) => candidate.path === callSite.path)
    : null;
  const afterContent = callSiteFile
    ? callSiteAfterContent(callSiteFile.content, input.slotId)
    : ({ found: false } as const);
  if (!callSite || !afterContent.found) {
    return { status: "code-only", reason: "call-site-not-found", text };
  }
  if (afterContent.opaque) {
    return { status: "code-only", reason: "call-site-opaque", text };
  }

  const reserved = new Set<string>([
    ...destructuredNames(parameter),
    ...typeMembers.names,
    ...Object.keys(declared.fields ?? {}),
    ...afterContent.explicit,
  ]);
  const tag =
    element.openingElement?.name?.type === "JSXIdentifier"
      ? element.openingElement.name.name
      : "element";
  return {
    status: "convertible",
    text,
    tag,
    suggestedName: freeName(NAME_FOR_TAG[tag] ?? "text", reserved),
    reservedNames: [...reserved].sort(),
    fieldDeclaration,
    callSite,
  };
}

/** One line an author can act on, for each reason. */
export function describeTextPromotionRefusal(
  reason: TextPromotionRefusal,
): string {
  switch (reason) {
    case "parse-error":
      return "The component's source could not be read.";
    case "not-found":
      return "This element could not be found in the component's source.";
    case "not-plain-text":
      return "It holds more than plain text — other markup or code — so one field cannot stand in for it.";
    case "inside-loop":
      return "It is rendered once per item of a list, so this one element is not a single place in the source.";
    case "inside-expression":
      return "It is rendered by a condition or other code, so it is not a fixed part of the component.";
    case "not-in-default-component":
      return "It is not in the file's default-exported component.";
    case "in-nested-component":
      return "It is written in a component this section uses, which receives only what the section passes it.";
    case "props-not-destructured":
      return "The component does not destructure its props, so there is nowhere to add a default for it.";
    case "props-type-elsewhere":
      return "The component's props are typed in another file, so a field cannot be added here safely.";
    case "no-field-capability":
      return "The component does not declare content fields in its own file, and none can be inferred for it.";
    case "call-site-not-found":
      return "No page renders this section through content(), so a page value would not reach it.";
    case "call-site-opaque":
      return "The page passes other props after the section's content, and they could override a page value.";
  }
}
