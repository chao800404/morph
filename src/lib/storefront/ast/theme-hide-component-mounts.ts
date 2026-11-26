/**
 * M3 Hide approach E: where a section's component is rendered other than as
 * a section.
 *
 * Morph's gate omits a hidden section at its mount. The same component
 * rendered somewhere else (`<Hero />` in a promo, `createElement(Hero)`, a
 * second Header) is not that mount: it would keep rendering, with the
 * component's defaults, while the section is hidden. So every reference to a
 * section's component, across the whole Theme and through re-exports, must
 * itself be a section mount (a JSX element bound to content, which Morph
 * judges as its own section); any other reference refuses the hide.
 *
 * Pure. Modules are resolved by the caller, exactly as the hide proof does.
 */

type AnyNode = any;

export type ResolveModule = (from: string, specifier: string) => string | null;

export type ComponentReference = Readonly<{
  file: string;
  line: number;
  /** The JSX element the reference names, or null for any other use. */
  elementStart: number | null;
}>;

const SKIPPED_KEYS = new Set([
  "start",
  "end",
  "loc",
  "range",
  "extra",
  "comments",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "tokens",
  "typeAnnotation",
  "returnType",
  "typeParameters",
  "superTypeParameters",
  "typeArguments",
  "implements",
]);

const KEYED = new Set([
  "ObjectProperty",
  "ObjectMethod",
  "ClassProperty",
  "ClassMethod",
  "ClassPrivateProperty",
  "ClassAccessorProperty",
]);

function importedName(node: AnyNode): string {
  return node?.type === "StringLiteral" ? node.value : node?.name;
}

/**
 * Every reference, in `modules`, to the default export of `componentPath`
 * (what a section's JSX element renders), followed through `export … from`
 * re-exports and `import X …; export default X`.
 */
export function findComponentReferences(args: {
  modules: ReadonlyArray<Readonly<{ path: string; ast: AnyNode | null }>>;
  resolve: ResolveModule;
  componentPath: string;
}): ComponentReference[] {
  const byPath = new Map(args.modules.map((module) => [module.path, module.ast]));

  /** Whether `name` exported by `path` is the component's default export. */
  const seen = new Set<string>();
  const isComponent = (path: string, name: string): boolean => {
    if (path === args.componentPath && name === "default") return true;
    const key = `${path}#${name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    try {
      const ast = byPath.get(path);
      if (!ast) return false;
      const local = localBindings(path, ast);
      for (const statement of ast.program?.body ?? []) {
        if (statement.type === "ExportNamedDeclaration" && statement.source) {
          const target = args.resolve(path, statement.source.value);
          if (!target) continue;
          for (const specifier of statement.specifiers ?? []) {
            if (importedName(specifier.exported) === name) {
              if (isComponent(target, importedName(specifier.local))) return true;
            }
          }
        } else if (statement.type === "ExportNamedDeclaration") {
          for (const specifier of statement.specifiers ?? []) {
            if (importedName(specifier.exported) !== name) continue;
            const binding = local.get(importedName(specifier.local));
            if (binding && isComponent(binding.target, binding.imported)) return true;
          }
        } else if (
          statement.type === "ExportDefaultDeclaration" &&
          name === "default" &&
          statement.declaration?.type === "Identifier"
        ) {
          const binding = local.get(statement.declaration.name);
          if (binding && isComponent(binding.target, binding.imported)) return true;
        } else if (
          statement.type === "ExportAllDeclaration" &&
          !statement.exported &&
          name !== "default"
        ) {
          const target = args.resolve(path, statement.source.value);
          if (target && isComponent(target, name)) return true;
        }
      }
      return false;
    } finally {
      seen.delete(key);
    }
  };

  const localBindings = (path: string, ast: AnyNode) => {
    const bindings = new Map<string, { target: string; imported: string }>();
    for (const statement of ast.program?.body ?? []) {
      if (statement.type !== "ImportDeclaration") continue;
      if (statement.importKind === "type" || statement.importKind === "typeof") continue;
      const target = args.resolve(path, statement.source.value);
      if (!target) continue;
      for (const specifier of statement.specifiers ?? []) {
        if (specifier.importKind === "type") continue;
        bindings.set(specifier.local.name, {
          target,
          imported:
            specifier.type === "ImportDefaultSpecifier"
              ? "default"
              : specifier.type === "ImportNamespaceSpecifier"
                ? "*"
                : importedName(specifier.imported),
        });
      }
    }
    return bindings;
  };

  /** Whether a module exports the component under any name. */
  const exportsComponent = (path: string): boolean => {
    const ast = byPath.get(path);
    if (!ast) return false;
    if (isComponent(path, "default")) return true;
    for (const statement of ast.program?.body ?? []) {
      if (statement.type === "ExportAllDeclaration" && !statement.exported) {
        const target = args.resolve(path, statement.source.value);
        if (target === args.componentPath) return true;
      }
      for (const specifier of statement.specifiers ?? []) {
        if (
          statement.type === "ExportNamedDeclaration" &&
          isComponent(path, importedName(specifier.exported))
        ) {
          return true;
        }
      }
    }
    return false;
  };

  const references: ComponentReference[] = [];
  for (const module of args.modules) {
    if (!module.ast || module.path === args.componentPath) continue;
    const bindings = localBindings(module.path, module.ast);
    const names = new Set<string>();
    const namespaces = new Set<string>();
    for (const [local, binding] of bindings) {
      if (binding.imported === "*") {
        // A namespace of the component's module, or of one re-exporting it.
        if (
          binding.target === args.componentPath ||
          exportsComponent(binding.target)
        ) {
          namespaces.add(local);
        }
      } else if (isComponent(binding.target, binding.imported)) {
        names.add(local);
      }
    }
    if (names.size === 0 && namespaces.size === 0) continue;
    const visit = (node: AnyNode, parent: AnyNode, key: string): void => {
      if (!node || typeof node.type !== "string") return;
      if (node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" && node.source) return;
      if (node.type.startsWith("TS") && !/^TS(As|Satisfies|NonNull)Expression$|^TSTypeAssertion$/.test(node.type)) return;
      if (node.type === "JSXOpeningElement") {
        let root = node.name;
        while (root?.type === "JSXMemberExpression") root = root.object;
        if (
          root?.type === "JSXIdentifier" &&
          (names.has(root.name) || namespaces.has(root.name))
        ) {
          references.push({
            file: module.path,
            line: root.loc?.start?.line ?? 0,
            elementStart:
              names.has(root.name) && node.name.type === "JSXIdentifier"
                ? (parent?.start ?? null)
                : null,
          });
        }
        for (const attribute of node.attributes ?? []) visit(attribute, node, "attributes");
        return;
      }
      if (node.type === "JSXClosingElement") return;
      if (node.type === "Identifier") {
        const declaration =
          (KEYED.has(parent?.type) && key === "key" && !parent.computed) ||
          ((parent?.type === "MemberExpression" || parent?.type === "OptionalMemberExpression") &&
            key === "property" &&
            !parent.computed) ||
          parent?.type === "ExportSpecifier" ||
          (parent?.type === "ExportDefaultDeclaration" && key === "declaration");
        if (!declaration && (names.has(node.name) || namespaces.has(node.name))) {
          references.push({
            file: module.path,
            line: node.loc?.start?.line ?? 0,
            elementStart: null,
          });
        }
        return;
      }
      for (const childKey of Object.keys(node)) {
        if (SKIPPED_KEYS.has(childKey)) continue;
        const value = node[childKey];
        if (Array.isArray(value)) {
          for (const child of value) visit(child, node, childKey);
        } else if (value && typeof value === "object") {
          visit(value, node, childKey);
        }
      }
    };
    visit(module.ast.program, null, "");
  }
  return references;
}
