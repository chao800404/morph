import { parse } from "@babel/parser";
import {
  arrayRowFields,
  isArrayContentField,
  type ThemeContentFieldDefinition,
  type ThemeScalarContentFieldDefinition,
} from "@/lib/storefront/theme-content-capabilities";
import {
  declarationCounts,
  isReference,
  parentMap,
  walk,
} from "./theme-content-binding";

/**
 * Where the Inspector's object position control may write, if anywhere.
 *
 * An image's position is often bound by `style={{ objectPosition: … }}`, and an
 * inline style overrides any class, so editing the class does nothing while
 * the binding is there. The control therefore writes the Document field the
 * binding reads, and only when the source proves which declared field that is:
 * the value is a direct read of a component prop or of the mapped row, the
 * prop or row is the one the component receives and nothing reassigns,
 * mutates or aliases it, and the field is declared. Anything else — including
 * an image with no inline position at all, whose class edit cannot yet be
 * proven to take effect — leaves the control unavailable. The author's code
 * is never refused for it: this only decides what the Position control does.
 */
export type ObjectPositionTarget =
  | Readonly<{
      kind: "document";
      /** The Document field path the value is written to. */
      fieldPath: string;
      /** What renders when the field holds nothing: the source's own literal. */
      fallback: string | null;
      definition: ThemeScalarContentFieldDefinition;
    }>
  | Readonly<{ kind: "unavailable"; reason: ObjectPositionUnavailableReason }>;

export type ObjectPositionUnavailableReason =
  /** No inline position on the element; a class edit is not proven to apply. */
  | "no-inline-position"
  /** The element or its style cannot be read from this source. */
  | "source-unreadable"
  /** The inline position is computed, spread or otherwise not a field read. */
  | "position-not-a-field-read"
  /** It reads a value the source does not prove is the received prop or row. */
  | "binding-unproven"
  /** It reads a prop the component does not declare as a content field. */
  | "field-not-declared"
  /** The selected row is not a row of the list the binding reads. */
  | "row-unconfirmed";

type AnyNode = any;

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

function unavailable(
  reason: ObjectPositionUnavailableReason,
): ObjectPositionTarget {
  return { kind: "unavailable", reason };
}

function parseSource(source: string): AnyNode | null {
  try {
    return parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch {
    return null;
  }
}

/** The JSX element whose opening tag starts at `line:column` (1-based). */
function elementAt(ast: AnyNode, line: number, column: number): AnyNode | null {
  let found: AnyNode = null;
  walk(ast?.program, (node) => {
    if (found || node?.type !== "JSXElement") return;
    const start = node.openingElement?.loc?.start;
    if (start?.line === line && start.column + 1 === column) found = node;
  });
  return found;
}

function propertyKeyName(property: AnyNode): string | null {
  if (property?.computed) return null;
  if (property?.key?.type === "Identifier") return property.key.name;
  if (property?.key?.type === "StringLiteral") return property.key.value;
  return null;
}

/** The value expression of `style={{ objectPosition: … }}`, or why there is none. */
function inlinePositionExpression(
  element: AnyNode,
): { expression: AnyNode } | { reason: ObjectPositionUnavailableReason } {
  const attributes = element.openingElement?.attributes ?? [];
  if (attributes.some((a: AnyNode) => a?.type === "JSXSpreadAttribute")) {
    // A spread may carry a style of its own; what wins cannot be read here.
    return { reason: "position-not-a-field-read" };
  }
  const style = attributes.find(
    (a: AnyNode) =>
      a?.type === "JSXAttribute" &&
      a.name?.type === "JSXIdentifier" &&
      a.name.name === "style",
  );
  if (!style) return { reason: "no-inline-position" };
  const object =
    style.value?.type === "JSXExpressionContainer"
      ? style.value.expression
      : null;
  if (object?.type !== "ObjectExpression")
    return { reason: "position-not-a-field-read" };
  const properties = object.properties ?? [];
  if (properties.some((p: AnyNode) => p?.type !== "ObjectProperty")) {
    return { reason: "position-not-a-field-read" };
  }
  if (properties.some((p: AnyNode) => propertyKeyName(p) === null)) {
    return { reason: "position-not-a-field-read" };
  }
  const positions = properties.filter(
    (p: AnyNode) => propertyKeyName(p) === "objectPosition",
  );
  if (positions.length === 0) return { reason: "no-inline-position" };
  if (positions.length > 1) return { reason: "position-not-a-field-read" };
  return { expression: positions[0].value };
}

/**
 * `<read>` or `<read> ?? "literal"`: the read, and the literal shown when the
 * field holds nothing. `||` is not accepted: it also replaces `""`, so the
 * rendered value would not be the stored one.
 */
function splitFallback(
  expression: AnyNode,
): { read: AnyNode; fallback: string | null } | null {
  if (expression?.type === "LogicalExpression") {
    if (expression.operator !== "??") return null;
    if (expression.right?.type !== "StringLiteral") return null;
    return { read: expression.left, fallback: expression.right.value };
  }
  return { read: expression, fallback: null };
}

function enclosingFunction(
  node: AnyNode,
  parents: ReadonlyMap<AnyNode, AnyNode>,
): AnyNode | null {
  let current = parents.get(node);
  while (current && !FUNCTION_TYPES.has(current.type)) {
    current = parents.get(current);
  }
  return current ?? null;
}

/** The function `export default` names, when it is one in this module. */
function defaultExportFunction(ast: AnyNode): AnyNode | null {
  const body = ast?.program?.body ?? [];
  const exported = body.find(
    (s: AnyNode) => s?.type === "ExportDefaultDeclaration",
  )?.declaration;
  if (!exported) return null;
  if (FUNCTION_TYPES.has(exported.type)) return exported;
  if (exported.type !== "Identifier") return null;
  for (const statement of body) {
    const declaration =
      statement?.type === "ExportNamedDeclaration"
        ? statement.declaration
        : statement;
    if (
      declaration?.type === "FunctionDeclaration" &&
      declaration.id?.name === exported.name
    ) {
      return declaration;
    }
    if (declaration?.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations ?? []) {
        if (
          declarator.id?.type === "Identifier" &&
          declarator.id.name === exported.name &&
          FUNCTION_TYPES.has(declarator.init?.type)
        ) {
          return declarator.init;
        }
      }
    }
  }
  return null;
}

/** The prop a destructured parameter local binds: `{ key }` or `{ key = … }`. */
function propBinding(
  component: AnyNode,
  key: (name: string) => boolean,
): { key: string; local: string; fallback: AnyNode | null } | null {
  const first = component.params?.[0];
  const pattern = first?.type === "AssignmentPattern" ? first.left : first;
  if (pattern?.type !== "ObjectPattern") return null;
  for (const property of pattern.properties ?? []) {
    if (property?.type !== "ObjectProperty") continue;
    const name = propertyKeyName(property);
    if (name === null) continue;
    const value = property.value;
    const local =
      value?.type === "Identifier"
        ? value.name
        : value?.type === "AssignmentPattern" &&
            value.left?.type === "Identifier"
          ? value.left.name
          : null;
    if (local !== null && key(local)) {
      return {
        key: name,
        local,
        fallback: value?.type === "AssignmentPattern" ? value.right : null,
      };
    }
  }
  return null;
}

/** Every identifier that reads or writes `name`, not the ones declaring it. */
function usesOf(
  root: AnyNode,
  name: string,
  parents: ReadonlyMap<AnyNode, AnyNode>,
): AnyNode[] {
  const found: AnyNode[] = [];
  walk(root, (node) => {
    if (node?.type !== "Identifier" || node.name !== name) return;
    const parent = parents.get(node);
    if (isBindingPosition(node, parents)) return;
    if (inTypePosition(node, parents)) return;
    if (isReference(node, parent)) found.push(node);
  });
  return found;
}

/** TypeScript nodes that wrap a value rather than describe a type. */
const TS_VALUE_WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
]);

/**
 * Whether an identifier is part of a type, as `items` is in
 * `type Props = { items?: Item[] }`: a name there is not a use of the value.
 */
function inTypePosition(
  node: AnyNode,
  parents: ReadonlyMap<AnyNode, AnyNode>,
): boolean {
  let current = parents.get(node);
  while (current) {
    if (
      typeof current.type === "string" &&
      current.type.startsWith("TS") &&
      !TS_VALUE_WRAPPERS.has(current.type)
    ) {
      return true;
    }
    current = parents.get(current);
  }
  return false;
}

/**
 * What a binding target belongs to: a declaration (`const { a } = …`, a
 * parameter, a catch clause), an assignment (`({ a } = …)`, `[a] = …`,
 * `for ([a] of …)`), or neither.
 *
 * The same patterns serve both. A name inside one is declared only when the
 * pattern is a declaration's; inside an assignment's it is written, exactly
 * as `a = …` writes it — and so is a member expression there, as in
 * `({ x: row.field } = …)`. Walks up through the pattern to its owner.
 */
function patternTarget(
  node: AnyNode,
  parents: ReadonlyMap<AnyNode, AnyNode>,
): "declaration" | "assignment" | null {
  let child = node;
  let parent = parents.get(child);
  for (;;) {
    if (parent?.type === "VariableDeclarator") {
      return parent.id === child ? "declaration" : null;
    }
    if (FUNCTION_TYPES.has(parent?.type)) {
      return parent.params?.includes(child) ? "declaration" : null;
    }
    if (parent?.type === "CatchClause") {
      return parent.param === child ? "declaration" : null;
    }
    if (parent?.type === "AssignmentExpression") {
      return parent.left === child ? "assignment" : null;
    }
    if (
      parent?.type === "ForOfStatement" ||
      parent?.type === "ForInStatement"
    ) {
      return parent.left === child ? "assignment" : null;
    }
    const insidePattern =
      parent?.type === "ArrayPattern" ||
      parent?.type === "ObjectPattern" ||
      parent?.type === "RestElement" ||
      (parent?.type === "AssignmentPattern" && parent.left === child) ||
      (parent?.type === "ObjectProperty" &&
        parent.value === child &&
        parents.get(parent)?.type === "ObjectPattern");
    if (!insidePattern) return null;
    child = parent;
    parent = parents.get(child);
  }
}

function isBindingPosition(
  node: AnyNode,
  parents: ReadonlyMap<AnyNode, AnyNode>,
): boolean {
  return patternTarget(node, parents) === "declaration";
}

/** Whether a use writes the name itself rather than reading it. */
function isWrite(
  use: AnyNode,
  parents: ReadonlyMap<AnyNode, AnyNode>,
): boolean {
  const parent = parents.get(use);
  return (
    (parent?.type === "AssignmentExpression" && parent.left === use) ||
    parent?.type === "UpdateExpression" ||
    ((parent?.type === "ForOfStatement" || parent?.type === "ForInStatement") &&
      parent.left === use) ||
    patternTarget(use, parents) === "assignment"
  );
}

function isMember(node: AnyNode): boolean {
  return (
    node?.type === "MemberExpression" ||
    node?.type === "OptionalMemberExpression"
  );
}

/**
 * Whether a use of a row is a plain read off it: `row.field`, never written,
 * deleted, called, or handed on whole.
 */
function isRowRead(
  use: AnyNode,
  parents: ReadonlyMap<AnyNode, AnyNode>,
): boolean {
  const member = parents.get(use);
  if (!isMember(member) || member.object !== use || member.computed) {
    return false;
  }
  const outer = parents.get(member);
  if (outer?.type === "AssignmentExpression" && outer.left === member) {
    return false;
  }
  // A destructuring assignment writes it too: `({ x: row.field } = …)`.
  if (patternTarget(member, parents) === "assignment") return false;
  if (outer?.type === "UpdateExpression") return false;
  if (outer?.type === "UnaryExpression" && outer.operator === "delete") {
    return false;
  }
  if (
    (outer?.type === "CallExpression" ||
      outer?.type === "OptionalCallExpression") &&
    outer.callee === member
  ) {
    return false;
  }
  return true;
}

/** `list.map(callback)` or `list?.map(callback)` around a callback. */
function mapCallOf(
  callback: AnyNode,
  parents: ReadonlyMap<AnyNode, AnyNode>,
): AnyNode | null {
  const call = parents.get(callback);
  if (
    (call?.type !== "CallExpression" &&
      call?.type !== "OptionalCallExpression") ||
    call.arguments?.[0] !== callback
  ) {
    return null;
  }
  const callee = call.callee;
  if (
    !isMember(callee) ||
    callee.computed ||
    callee.property?.type !== "Identifier" ||
    callee.property.name !== "map"
  ) {
    return null;
  }
  return call;
}

/**
 * Whether anything inside a callback body declares `name` again, so that a
 * read of it might not be the row. A callback's own parameters sit outside
 * its body, so any declaration found here is a second one.
 */
function redeclaredInside(body: AnyNode, name: string): boolean {
  return (declarationCounts({ program: body }).get(name) ?? 0) > 0;
}

/**
 * Whether a use of a prop hands the value on in a way this cannot follow:
 * written, aliased into another name, or passed to a function.
 */
function escapes(
  use: AnyNode,
  parents: ReadonlyMap<AnyNode, AnyNode>,
): boolean {
  if (isWrite(use, parents)) return true;
  const parent = parents.get(use);
  if (parent?.type === "VariableDeclarator" && parent.init === use) return true;
  if (
    (parent?.type === "CallExpression" ||
      parent?.type === "OptionalCallExpression" ||
      parent?.type === "NewExpression") &&
    parent.arguments?.includes(use)
  ) {
    return true;
  }
  return false;
}

function isScalarPositionField(
  definition: ThemeContentFieldDefinition | undefined,
): definition is ThemeScalarContentFieldDefinition {
  return definition?.type === "text" || definition?.type === "select";
}

export function resolveObjectPositionTarget(args: {
  source: string;
  /** The clicked element's opening tag, 1-based, in `source`. */
  line: number;
  column: number;
  /** The section component's declared fields; never inferred ones. */
  declaredFields: Readonly<Record<string, ThemeContentFieldDefinition>>;
  /** The selected field's path, already confirmed against the row ids. */
  selectedFieldPath: string | null;
}): ObjectPositionTarget {
  const ast = parseSource(args.source);
  if (!ast) return unavailable("source-unreadable");
  const element = elementAt(ast, args.line, args.column);
  if (!element) return unavailable("source-unreadable");

  const inline = inlinePositionExpression(element);
  if ("reason" in inline) return unavailable(inline.reason);
  const split = splitFallback(inline.expression);
  if (!split) return unavailable("position-not-a-field-read");

  const parents = parentMap(ast);
  const component = defaultExportFunction(ast);
  if (!component) return unavailable("binding-unproven");
  const declarations = declarationCounts(ast);
  const inner = enclosingFunction(element, parents);
  if (!inner) return unavailable("binding-unproven");

  // A prop of the component itself: `{ imagePosition = "center" }`.
  if (inner === component) {
    const read = split.read;
    if (read?.type !== "Identifier") {
      return unavailable("position-not-a-field-read");
    }
    const binding = propBinding(component, (local) => local === read.name);
    if (!binding) return unavailable("binding-unproven");
    if (declarations.get(binding.local) !== 1) {
      return unavailable("binding-unproven");
    }
    if (
      usesOf(ast.program, binding.local, parents).some((use) =>
        escapes(use, parents),
      )
    ) {
      return unavailable("binding-unproven");
    }
    const definition = args.declaredFields[binding.key];
    if (!isScalarPositionField(definition)) {
      return unavailable("field-not-declared");
    }
    if (!args.selectedFieldPath || args.selectedFieldPath.includes(".")) {
      return unavailable("row-unconfirmed");
    }
    const sourceDefault =
      binding.fallback?.type === "StringLiteral"
        ? binding.fallback.value
        : null;
    if (binding.fallback && sourceDefault === null) {
      return unavailable("position-not-a-field-read");
    }
    return {
      kind: "document",
      fieldPath: binding.key,
      fallback: sourceDefault ?? split.fallback,
      definition,
    };
  }

  // A field of the mapped row: `items.map((item) => … item.imagePosition …)`.
  const call = mapCallOf(inner, parents);
  if (!call) return unavailable("binding-unproven");
  if (enclosingFunction(call, parents) !== component) {
    return unavailable("binding-unproven");
  }
  const rowParam = inner.params?.[0];
  if (rowParam?.type !== "Identifier") return unavailable("binding-unproven");
  const read = split.read;
  if (
    !isMember(read) ||
    read.computed ||
    read.property?.type !== "Identifier" ||
    read.object?.type !== "Identifier" ||
    read.object.name !== rowParam.name
  ) {
    return unavailable("position-not-a-field-read");
  }
  const fieldKey = read.property.name;

  const receiver = call.callee.object;
  if (receiver?.type !== "Identifier") return unavailable("binding-unproven");
  const list = propBinding(component, (local) => local === receiver.name);
  if (!list || declarations.get(list.local) !== 1) {
    return unavailable("binding-unproven");
  }
  // Every use of the list is the receiver of a `.map`, and in each of those
  // the row is only read from: nothing reassigns, sorts, aliases or hands the
  // list or a row to code this cannot see.
  for (const use of usesOf(ast.program, list.local, parents)) {
    const member = parents.get(use);
    const mapCall = parents.get(member);
    if (
      !isMember(member) ||
      member.object !== use ||
      member.computed ||
      member.property?.name !== "map" ||
      (mapCall?.type !== "CallExpression" &&
        mapCall?.type !== "OptionalCallExpression") ||
      mapCall.callee !== member
    ) {
      return unavailable("binding-unproven");
    }
    const callback = mapCall.arguments?.[0];
    if (!FUNCTION_TYPES.has(callback?.type)) {
      return unavailable("binding-unproven");
    }
    const param = callback.params?.[0];
    if (param === undefined) continue;
    if (param?.type !== "Identifier") return unavailable("binding-unproven");
    if (redeclaredInside(callback.body, param.name)) {
      return unavailable("binding-unproven");
    }
    for (const rowUse of usesOf(callback.body, param.name, parents)) {
      if (!isRowRead(rowUse, parents)) return unavailable("binding-unproven");
    }
  }
  // The element is drawn by this map's own callback, not a helper inside it.
  if (enclosingFunction(element, parents) !== inner) {
    return unavailable("binding-unproven");
  }

  const listDefinition = args.declaredFields[list.key];
  if (!isArrayContentField(listDefinition)) {
    return unavailable("field-not-declared");
  }
  const rowFields = arrayRowFields(listDefinition);
  const definition = rowFields?.[fieldKey];
  if (!isScalarPositionField(definition)) {
    return unavailable("field-not-declared");
  }
  const row = args.selectedFieldPath
    ? new RegExp(`^${escapeRegExp(list.key)}\\.(\\d+)(?:\\.|$)`).exec(
        args.selectedFieldPath,
      )
    : null;
  if (!row) return unavailable("row-unconfirmed");
  return {
    kind: "document",
    fieldPath: `${list.key}.${row[1]}.${fieldKey}`,
    fallback: split.fallback,
    definition,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
