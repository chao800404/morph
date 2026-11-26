/**
 * M3 Hide approach E: where a section's component is rendered other than as
 * a section.
 *
 * Morph's gate omits a hidden section at its mount. The same component
 * rendered somewhere else (`<Hero />` in a promo, `createElement(Hero)`, a
 * second Header) is not that mount: it would keep rendering, with the
 * component's defaults, while the section is hidden. So every reference to a
 * section's component, across the whole Theme, must itself be a section
 * mount (a JSX element bound to content, which Morph judges as its own
 * section); any other reference refuses the hide.
 *
 * The component is followed to its definition: the declaration in the module
 * that defines it, whichever name and path the section's mount imported it
 * by. Every acquisition of that declaration is a reference: a default or a
 * named import of any module that re-exports it (a barrel, `export *`, the
 * defining file itself), a namespace of such a module, a use inside the
 * defining module, and a dynamic `import()` (React.lazy) of a module that
 * exports it. What cannot be followed refuses too: a dynamic import whose
 * module is not written out, `import.meta.glob`, and a component exported as
 * a value Morph cannot see through (`export default memo(HeroBody)`), whose
 * implementation could be rendered unwrapped.
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
  /** Why the reference cannot be a section mount, when it is not an element. */
  detail?: string;
}>;

/** The import a section's mount renders: the module and the export name. */
export type ComponentImport = Readonly<{ path: string; exportName: string }>;

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

const FUNCTION_LIKE = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassDeclaration",
  "ClassExpression",
]);

/** A specifier that names a file of the Theme rather than a package. */
const RELATIVE_SPECIFIER = /^(\.{1,2}\/|\/|@\/|~\/)/;

function importedName(node: AnyNode): string {
  return node?.type === "StringLiteral" ? node.value : node?.name;
}

function unwrapTs(node: AnyNode): AnyNode {
  let current = node;
  while (
    current &&
    /^TS(As|Satisfies|NonNull)Expression$|^TSTypeAssertion$/.test(current.type)
  ) {
    current = current.expression;
  }
  return current;
}

/** The declaration a component is: one module's top-level local, or its anonymous default. */
type Definition = Readonly<{ module: string; local: string | null; line: number }>;

type Resolution =
  | Readonly<{ kind: "definition"; definition: Definition; plain: boolean }>
  | Readonly<{ kind: "namespace"; module: string }>
  | null;

const definitionKey = (definition: Definition) =>
  `${definition.module}#${definition.local ?? "*default*"}`;

export function findComponentReferences(args: {
  modules: ReadonlyArray<Readonly<{ path: string; ast: AnyNode | null }>>;
  resolve: ResolveModule;
  component: ComponentImport;
}): ComponentReference[] {
  const byPath = new Map(args.modules.map((module) => [module.path, module.ast]));
  const body = (path: string): AnyNode[] => byPath.get(path)?.program?.body ?? [];

  /** A module's top-level declarations: whether each is a plain function or class. */
  const declarationCache = new Map<string, Map<string, { plain: boolean; line: number }>>();
  const declarations = (path: string) => {
    let found = declarationCache.get(path);
    if (found) return found;
    found = new Map();
    for (const raw of body(path)) {
      const statement =
        (raw.type === "ExportNamedDeclaration" || raw.type === "ExportDefaultDeclaration") &&
        raw.declaration
          ? raw.declaration
          : raw;
      if (
        (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") &&
        statement.id
      ) {
        found.set(statement.id.name, { plain: true, line: statement.loc?.start?.line ?? 0 });
      } else if (statement.type === "VariableDeclaration") {
        for (const declarator of statement.declarations ?? []) {
          if (declarator.id?.type !== "Identifier") continue;
          const init = unwrapTs(declarator.init);
          found.set(declarator.id.name, {
            plain: Boolean(init && FUNCTION_LIKE.has(init.type)),
            line: declarator.loc?.start?.line ?? 0,
          });
        }
      }
    }
    declarationCache.set(path, found);
    return found;
  };

  const importBindings = (path: string) => {
    const bindings = new Map<string, { target: string | null; imported: string }>();
    for (const statement of body(path)) {
      if (statement.type !== "ImportDeclaration") continue;
      if (statement.importKind === "type" || statement.importKind === "typeof") continue;
      const target = args.resolve(path, statement.source.value);
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

  const resolving = new Set<string>();
  const resolveLocal = (path: string, local: string): Resolution => {
    const binding = importBindings(path).get(local);
    if (binding) {
      if (!binding.target) return null;
      if (binding.imported === "*") return { kind: "namespace", module: binding.target };
      return resolveExport(binding.target, binding.imported);
    }
    const declared = declarations(path).get(local);
    return declared
      ? {
          kind: "definition",
          definition: { module: path, local, line: declared.line },
          plain: declared.plain,
        }
      : null;
  };

  /** What `name`, exported by `path`, is. */
  const resolveExport = (path: string, name: string): Resolution => {
    const key = `${path}#${name}`;
    if (resolving.has(key)) return null;
    resolving.add(key);
    try {
      const statements = body(path);
      for (const statement of statements) {
        if (statement.type === "ExportNamedDeclaration") {
          const declaration = statement.declaration;
          if (declaration) {
            const names =
              declaration.type === "VariableDeclaration"
                ? (declaration.declarations ?? []).map((d: AnyNode) => d.id?.name)
                : [declaration.id?.name];
            if (names.includes(name)) return resolveLocal(path, name);
          }
          for (const specifier of statement.specifiers ?? []) {
            if (importedName(specifier.exported) !== name) continue;
            const target = statement.source ? args.resolve(path, statement.source.value) : null;
            if (specifier.type === "ExportNamespaceSpecifier") {
              return target ? { kind: "namespace", module: target } : null;
            }
            if (statement.source) {
              return target ? resolveExport(target, importedName(specifier.local)) : null;
            }
            return resolveLocal(path, importedName(specifier.local));
          }
        } else if (statement.type === "ExportDefaultDeclaration" && name === "default") {
          const declaration = statement.declaration;
          if (declaration?.type === "Identifier") return resolveLocal(path, declaration.name);
          const line = declaration?.loc?.start?.line ?? 0;
          if (
            (declaration?.type === "FunctionDeclaration" ||
              declaration?.type === "ClassDeclaration") &&
            declaration.id
          ) {
            return {
              kind: "definition",
              definition: { module: path, local: declaration.id.name, line },
              plain: true,
            };
          }
          return {
            kind: "definition",
            definition: { module: path, local: null, line },
            plain: Boolean(declaration && FUNCTION_LIKE.has(unwrapTs(declaration).type)),
          };
        } else if (
          statement.type === "ExportAllDeclaration" &&
          statement.exported &&
          importedName(statement.exported) === name
        ) {
          const target = args.resolve(path, statement.source.value);
          return target ? { kind: "namespace", module: target } : null;
        }
      }
      if (name !== "default") {
        for (const statement of statements) {
          if (statement.type !== "ExportAllDeclaration" || statement.exported) continue;
          const target = args.resolve(path, statement.source.value);
          const found = target ? resolveExport(target, name) : null;
          if (found) return found;
        }
      }
      return null;
    } finally {
      resolving.delete(key);
    }
  };

  const target = resolveExport(args.component.path, args.component.exportName);
  if (target?.kind !== "definition") {
    return [
      {
        file: args.component.path,
        line: 0,
        elementStart: null,
        detail: `Morph cannot tell which component ${args.component.path} exports as ${args.component.exportName}.`,
      },
    ];
  }
  const definition = target.definition;
  if (!target.plain) {
    return [
      {
        file: definition.module,
        line: definition.line,
        elementStart: null,
        detail: `${definition.module}:${definition.line} exports the section's component as a value Morph cannot see through, so what it wraps could render elsewhere.`,
      },
    ];
  }
  const wanted = definitionKey(definition);
  const isComponent = (resolution: Resolution) =>
    resolution?.kind === "definition" && definitionKey(resolution.definition) === wanted;

  /** Whether a module exports the component under any name, a namespace of it included. */
  const exporting = new Map<string, boolean>();
  const exportsComponent = (path: string): boolean => {
    const known = exporting.get(path);
    if (known !== undefined) return known;
    exporting.set(path, false);
    let found = false;
    for (const statement of body(path)) {
      if (found) break;
      if (statement.type === "ExportAllDeclaration") {
        const target = args.resolve(path, statement.source.value);
        found = Boolean(target && (target === definition.module || exportsComponent(target)));
      } else if (statement.type === "ExportDefaultDeclaration") {
        found = isComponent(resolveExport(path, "default"));
      } else if (statement.type === "ExportNamedDeclaration") {
        const declaration = statement.declaration;
        const names = declaration
          ? declaration.type === "VariableDeclaration"
            ? (declaration.declarations ?? []).map((d: AnyNode) => d.id?.name)
            : [declaration.id?.name]
          : (statement.specifiers ?? []).map((specifier: AnyNode) =>
              importedName(specifier.exported),
            );
        found = names.some((name: string) => {
          const resolution = resolveExport(path, name);
          return (
            isComponent(resolution) ||
            (resolution?.kind === "namespace" &&
              (resolution.module === definition.module || exportsComponent(resolution.module)))
          );
        });
      }
    }
    exporting.set(path, found);
    return found;
  };
  const namespaceHolds = (module: string) =>
    module === definition.module || exportsComponent(module);

  const references: ComponentReference[] = [];
  for (const module of args.modules) {
    if (!module.ast) continue;
    const names = new Set<string>();
    const namespaces = new Set<string>();
    for (const [local, binding] of importBindings(module.path)) {
      if (!binding.target) continue;
      const resolution =
        binding.imported === "*"
          ? ({ kind: "namespace", module: binding.target } as const)
          : resolveExport(binding.target, binding.imported);
      if (isComponent(resolution)) names.add(local);
      else if (resolution?.kind === "namespace" && namespaceHolds(resolution.module)) {
        namespaces.add(local);
      }
    }
    if (module.path === definition.module && definition.local) names.add(definition.local);

    const reference = (node: AnyNode, elementStart: number | null, detail?: string) =>
      references.push({
        file: module.path,
        line: node?.loc?.start?.line ?? 0,
        elementStart,
        ...(detail ? { detail } : {}),
      });

    /** A dynamic import: of a module that exports the component, or of one Morph cannot tell. */
    const dynamicImport = (node: AnyNode, source: AnyNode) => {
      const specifier =
        source?.type === "StringLiteral"
          ? source.value
          : source?.type === "TemplateLiteral" && (source.expressions ?? []).length === 0
            ? source.quasis?.[0]?.value?.cooked
            : null;
      if (typeof specifier !== "string") {
        reference(node, null, `${module.path} imports a module whose name Morph cannot tell.`);
        return;
      }
      const target = args.resolve(module.path, specifier);
      if (!target) {
        if (RELATIVE_SPECIFIER.test(specifier)) {
          reference(node, null, `${module.path} imports ${specifier}, which Morph cannot resolve.`);
        }
        return;
      }
      if (namespaceHolds(target)) {
        reference(node, null, `${module.path} loads the section's component through import().`);
      }
    };

    const visit = (node: AnyNode, parent: AnyNode, key: string): void => {
      if (!node || typeof node.type !== "string") return;
      if (node.type === "ImportDeclaration" || (node.type === "ExportNamedDeclaration" && node.source)) return;
      if (node.type === "ExportAllDeclaration") return;
      if (node.type.startsWith("TS") && !/^TS(As|Satisfies|NonNull)Expression$|^TSTypeAssertion$/.test(node.type)) return;
      if (node.type === "ImportExpression") {
        dynamicImport(node, node.source);
      } else if (
        (node.type === "CallExpression" || node.type === "OptionalCallExpression") &&
        (node.callee?.type === "Import" ||
          (node.callee?.type === "Identifier" && node.callee.name === "require"))
      ) {
        dynamicImport(node, node.arguments?.[0]);
      } else if (
        (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") &&
        node.object?.type === "MetaProperty" &&
        node.object.meta?.name === "import" &&
        node.object.property?.name === "meta" &&
        !node.computed &&
        /^glob/.test(node.property?.name ?? "")
      ) {
        reference(node, null, `${module.path} loads modules through import.meta.${node.property.name}.`);
        return;
      }
      if (node.type === "JSXOpeningElement") {
        let root = node.name;
        while (root?.type === "JSXMemberExpression") root = root.object;
        if (
          root?.type === "JSXIdentifier" &&
          (names.has(root.name) || namespaces.has(root.name))
        ) {
          reference(
            root,
            names.has(root.name) && node.name.type === "JSXIdentifier"
              ? (parent?.start ?? null)
              : null,
          );
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
          (parent?.type === "ExportDefaultDeclaration" && key === "declaration") ||
          (key === "id" &&
            (FUNCTION_LIKE.has(parent?.type) || parent?.type === "VariableDeclarator"));
        if (!declaration && (names.has(node.name) || namespaces.has(node.name))) {
          reference(node, null);
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
