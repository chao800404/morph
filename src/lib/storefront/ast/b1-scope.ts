import type { Node } from "@babel/types";

/**
 * Small lexical-scope oracle for the B1 Theme provenance analysis. It uses
 * the plain `@babel/parser` AST already present in the Worker bundle; it adds
 * no runtime dependency. The implementation is deliberately conservative:
 * unsupported or dynamic binding behavior makes the affected provenance
 * unknown rather than guessing.
 *
 * This is bounded to ES modules (strict mode), with TypeScript type positions
 * excluded. A direct `eval` makes bindings in the module dynamic. `with` is
 * not valid in an ES module.
 */

export type AnyNode = Node;

export type B1BindingKind =
  "const" | "let" | "var" | "param" | "import" | "function" | "class" | "other";

export type B1Binding = Readonly<{
  name: string;
  kind: B1BindingKind;
  /**
   * `VariableDeclarator` for const/let/var, the import specifier for an
   * import, the owning function for a parameter, the declaration itself for
   * function/class, otherwise null.
   */
  declaration: AnyNode | null;
  /** The binding identifier inside the declaration. */
  identifier: AnyNode;
  /** Every reading or writing occurrence other than the declaration itself. */
  references: readonly AnyNode[];
  /** Identifiers written to: assignment targets, `++`, for-in/of heads. */
  violations: readonly AnyNode[];
}>;

export interface B1ScopeOracle {
  /** The binding an identifier (reference or declaration) resolves to. */
  bindingOf(identifier: AnyNode): B1Binding | null;
  parentOf(node: AnyNode): AnyNode | null;
  /** True when the file contains a direct `eval(...)` call. */
  readonly hasDirectEval: boolean;
}

type MutableBinding = {
  name: string;
  kind: B1BindingKind;
  declaration: AnyNode | null;
  identifier: AnyNode;
  references: AnyNode[];
  violations: AnyNode[];
};

type Scope = {
  parent: Scope | null;
  /** Function and program scopes take `var`. */
  isFunction: boolean;
  names: Map<string, MutableBinding>;
};

const SKIP_KEYS = new Set([
  "loc",
  "start",
  "end",
  "extra",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
  "tokens",
  "range",
]);

/** Type-space subtrees: nothing in them is a value reference. */
function isTypeOnly(node: AnyNode): boolean {
  const type: string = node?.type ?? "";
  if (!type.startsWith("TS")) return false;
  return !(
    type === "TSAsExpression" ||
    type === "TSSatisfiesExpression" ||
    type === "TSNonNullExpression" ||
    type === "TSTypeAssertion" ||
    type === "TSParameterProperty" ||
    type === "TSEnumDeclaration" ||
    type === "TSModuleDeclaration" ||
    type === "TSExportAssignment" ||
    type === "TSInstantiationExpression"
  );
}

function childEntries(node: AnyNode): Array<[string, AnyNode]> {
  const out: Array<[string, AnyNode]> = [];
  const record = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = record[key];
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (
          item &&
          typeof item === "object" &&
          "type" in item &&
          typeof item.type === "string"
        ) {
          out.push([key, item as AnyNode]);
        }
      }
    } else if ("type" in value && typeof value.type === "string") {
      out.push([key, value as AnyNode]);
    }
  }
  return out;
}

type IdentifierNode = Extract<AnyNode, { type: "Identifier" }>;

/** Identifiers a binding pattern declares, with the pattern they sit in. */
function patternIdentifiers(
  pattern: AnyNode | null | undefined,
  out: IdentifierNode[] = [],
): IdentifierNode[] {
  if (!pattern) return out;
  switch (pattern.type) {
    case "Identifier":
      out.push(pattern);
      break;
    case "ObjectPattern":
      for (const property of pattern.properties ?? []) {
        if (property.type === "RestElement") patternIdentifiers(property, out);
        else patternIdentifiers(property.value, out);
      }
      break;
    case "ArrayPattern":
      for (const element of pattern.elements ?? []) {
        if (element) patternIdentifiers(element, out);
      }
      break;
    case "AssignmentPattern":
      patternIdentifiers(pattern.left, out);
      break;
    case "RestElement":
      patternIdentifiers(pattern.argument, out);
      break;
    case "TSParameterProperty":
      patternIdentifiers(pattern.parameter, out);
      break;
    default:
      break;
  }
  return out;
}

type FunctionNode = Extract<
  AnyNode,
  {
    type:
      | "FunctionDeclaration"
      | "FunctionExpression"
      | "ArrowFunctionExpression"
      | "ObjectMethod"
      | "ClassMethod"
      | "ClassPrivateMethod";
  }
>;

function isFunctionNode(node: AnyNode): node is FunctionNode {
  return (
    node?.type === "FunctionDeclaration" ||
    node?.type === "FunctionExpression" ||
    node?.type === "ArrowFunctionExpression" ||
    node?.type === "ObjectMethod" ||
    node?.type === "ClassMethod" ||
    node?.type === "ClassPrivateMethod"
  );
}

/**
 * Hand-rolled scope analysis on a `@babel/parser` File/Program AST.
 *
 * Two passes: the first creates every scope and declares every binding (so
 * hoisting needs no special case), the second resolves each value-position
 * identifier lexically from the scope it sits in.
 */
export function buildHandScopeOracle(ast: AnyNode): B1ScopeOracle {
  const parents = new Map<AnyNode, AnyNode>();
  /** The scope a scope-creating node opens. */
  const scopeOf = new Map<AnyNode, Scope>();
  const bindingByIdentifier = new Map<AnyNode, MutableBinding>();
  let hasDirectEval = false;

  const program = ast?.type === "File" ? ast.program : ast;
  const programScope: Scope = {
    parent: null,
    isFunction: true,
    names: new Map(),
  };
  scopeOf.set(program, programScope);

  const declare = (
    scope: Scope,
    identifier: AnyNode,
    kind: B1BindingKind,
    declaration: AnyNode | null,
  ) => {
    if (identifier?.type !== "Identifier") return;
    const existing = scope.names.get(identifier.name);
    if (existing) {
      // A redeclaration (`var x; var x;`, a function and a var) is one
      // binding written twice: never constant.
      existing.violations.push(identifier);
      bindingByIdentifier.set(identifier, existing);
      return;
    }
    const binding: MutableBinding = {
      name: identifier.name,
      kind,
      declaration,
      identifier,
      references: [],
      violations: [],
    };
    scope.names.set(identifier.name, binding);
    bindingByIdentifier.set(identifier, binding);
  };

  const functionScopeOf = (scope: Scope): Scope => {
    let cursor: Scope = scope;
    while (!cursor.isFunction && cursor.parent) cursor = cursor.parent;
    return cursor;
  };

  // Pass 1: parents, scopes, declarations.
  const declarePass = (node: AnyNode, parent: AnyNode | null, scope: Scope) => {
    if (parent) parents.set(node, parent);
    if (isTypeOnly(node)) {
      // Record parents so the walk below can stop here, nothing else.
      return;
    }
    let inner = scope;
    switch (node.type) {
      case "ImportDeclaration": {
        if (node.importKind === "type") break;
        for (const specifier of node.specifiers ?? []) {
          if ("importKind" in specifier && specifier.importKind === "type") {
            continue;
          }
          declare(programScope, specifier.local, "import", specifier);
        }
        break;
      }
      case "VariableDeclaration": {
        const target = node.kind === "var" ? functionScopeOf(scope) : scope;
        const kind: B1BindingKind =
          node.kind === "const" || node.kind === "let" || node.kind === "var"
            ? node.kind
            : "other";
        for (const declarator of node.declarations ?? []) {
          for (const id of patternIdentifiers(declarator.id)) {
            declare(target, id, kind, declarator);
          }
        }
        break;
      }
      case "FunctionDeclaration": {
        if (node.id) declare(scope, node.id, "function", node);
        break;
      }
      case "ClassDeclaration": {
        if (node.id) declare(scope, node.id, "class", node);
        break;
      }
      case "TSEnumDeclaration":
      case "TSModuleDeclaration": {
        if (node.id?.type === "Identifier")
          declare(scope, node.id, "other", node);
        break;
      }
      default:
        break;
    }
    if (isFunctionNode(node)) {
      inner = { parent: scope, isFunction: true, names: new Map() };
      scopeOf.set(node, inner);
      if (node.type === "FunctionExpression" && node.id) {
        declare(inner, node.id, "function", node);
      }
      for (const param of node.params ?? []) {
        for (const id of patternIdentifiers(param)) {
          declare(inner, id, "param", node);
        }
      }
      // The body block shares the function's scope.
      if (node.body?.type === "BlockStatement") scopeOf.set(node.body, inner);
    } else if (node.type === "ClassExpression" && node.id) {
      inner = { parent: scope, isFunction: false, names: new Map() };
      scopeOf.set(node, inner);
      declare(inner, node.id, "class", node);
    } else if (node.type === "CatchClause") {
      inner = { parent: scope, isFunction: false, names: new Map() };
      scopeOf.set(node, inner);
      for (const id of node.param ? patternIdentifiers(node.param) : []) {
        declare(inner, id, "other", node);
      }
      if (node.body?.type === "BlockStatement") scopeOf.set(node.body, inner);
    } else if (
      (node.type === "BlockStatement" && !scopeOf.has(node)) ||
      node.type === "ForStatement" ||
      node.type === "ForInStatement" ||
      node.type === "ForOfStatement" ||
      node.type === "SwitchStatement" ||
      node.type === "StaticBlock"
    ) {
      inner = { parent: scope, isFunction: false, names: new Map() };
      scopeOf.set(node, inner);
    } else if (node.type === "BlockStatement") {
      inner = scopeOf.get(node)!;
    }
    // Children see the scope this node opened, so a `let` in a for head is
    // declared in the loop's scope.
    for (const [, child] of childEntries(node)) {
      declarePass(child, node, inner);
    }
  };

  declarePass(program, null, programScope);

  const lookup = (scope: Scope | null, name: string): MutableBinding | null => {
    for (let cursor = scope; cursor; cursor = cursor.parent) {
      const found = cursor.names.get(name);
      if (found) return found;
    }
    return null;
  };

  /** Whether an Identifier in this position is a value read/write. */
  const isValueIdentifier = (
    node: AnyNode,
    parent: AnyNode | null,
  ): boolean => {
    if (!parent) return true;
    switch (parent.type) {
      case "MemberExpression":
      case "OptionalMemberExpression":
        return parent.object === node || parent.computed;
      case "ObjectProperty":
      case "ObjectMethod":
      case "ClassProperty":
      case "ClassMethod":
      case "ClassPrivateProperty":
      case "ClassAccessorProperty":
        // A shorthand `{ a }` has a separate (cloned) value node.
        return "computed" in parent && parent.computed
          ? true
          : parent.key !== node;
      case "LabeledStatement":
      case "BreakStatement":
      case "ContinueStatement":
        return false;
      case "ImportSpecifier":
      case "ImportDefaultSpecifier":
      case "ImportNamespaceSpecifier":
        return false;
      case "ExportSpecifier":
        return parent.local === node;
      case "MetaProperty":
        return false;
      default:
        return true;
    }
  };

  /** Identifiers an assignment target writes (not member targets). */
  const writtenIdentifiers = (target: AnyNode): IdentifierNode[] =>
    target?.type === "MemberExpression" ||
    target?.type === "OptionalMemberExpression"
      ? []
      : patternIdentifiers(target);

  // Pass 2: resolve value identifiers.
  const resolvePass = (node: AnyNode, parent: AnyNode | null, scope: Scope) => {
    if (isTypeOnly(node)) return;
    const own = scopeOf.get(node);
    const current = own ?? scope;

    if (node.type === "Identifier") {
      if (bindingByIdentifier.has(node)) return; // a declaration
      if (!isValueIdentifier(node, parent)) return;
      const binding = lookup(current, node.name);
      if (binding) {
        binding.references.push(node);
        bindingByIdentifier.set(node, binding);
      }
      return;
    }
    if (node.type === "JSXIdentifier") {
      // `<Hero>` reads the binding `Hero`; lowercase tags and attribute names
      // do not.
      const isTagName =
        (parent?.type === "JSXOpeningElement" ||
          parent?.type === "JSXClosingElement") &&
        parent.name === node;
      const isMemberObject =
        parent?.type === "JSXMemberExpression" && parent.object === node;
      if ((isTagName && /^[A-Z_$]/.test(node.name)) || isMemberObject) {
        const binding = lookup(current, node.name);
        if (binding) {
          if (parent?.type !== "JSXClosingElement")
            binding.references.push(node);
          bindingByIdentifier.set(node, binding);
        }
      }
      return;
    }
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "Identifier" &&
      node.callee.name === "eval" &&
      !lookup(current, "eval")
    ) {
      hasDirectEval = true;
    }
    if (node.type === "AssignmentExpression") {
      for (const id of writtenIdentifiers(node.left)) {
        if (bindingByIdentifier.has(id)) continue;
        const binding = lookup(current, id.name);
        if (binding) binding.violations.push(id);
      }
    } else if (
      node.type === "UpdateExpression" &&
      node.argument?.type === "Identifier"
    ) {
      const binding = lookup(current, node.argument.name);
      if (binding) binding.violations.push(node.argument);
    } else if (
      (node.type === "ForInStatement" || node.type === "ForOfStatement") &&
      node.left?.type !== "VariableDeclaration"
    ) {
      for (const id of writtenIdentifiers(node.left)) {
        const binding = lookup(current, id.name);
        if (binding) binding.violations.push(id);
      }
    }
    for (const [, child] of childEntries(node)) {
      resolvePass(child, node, current);
    }
  };
  resolvePass(program, null, programScope);

  return {
    bindingOf: (identifier) => bindingByIdentifier.get(identifier) ?? null,
    parentOf: (node) => parents.get(node) ?? null,
    get hasDirectEval() {
      return hasDirectEval;
    },
  };
}
