import { parse } from "@babel/parser";
import { THEME_CONTENT_MODULE_PATH } from "@/lib/storefront/theme-content-slots";

/**
 * Whether a Design operation can confirm the export it needs from the Theme's
 * content module.
 *
 * `src/morph/content.ts` is the author's file. Morph seeds it and the Starter
 * upgrade replaces an untouched copy, but an author may edit or delete it. The
 * platform contract is the data interface — `GET /_morph/content` on the
 * origin Core names in `x-morph-content-origin` — not the module. Each Design
 * operation that writes code against the module therefore asks for the one
 * export it writes, and only that operation stops when it cannot be
 * confirmed: a page read through `morph.pages.get` alone does not lose its
 * other editing because it has no `content()`. Saving, building and Code mode
 * never ask.
 *
 * The module is parsed, never executed, so this confirms a shape and not a
 * behaviour: a function the syntax shows is declared here, or a value the
 * syntax shows is not a function. Anything else — a factory's result, a
 * re-export from another file, `export *` — is unconfirmed, and the operation
 * stops rather than guessing. Every Starter generation declares `content` as
 * a plain function (pinned by the tests), so no Starter needs an exception.
 */
export type ThemeContentModuleFunctionExportCheck =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false;
      reason:
        | "missing"
        | "unparseable"
        | "not-exported"
        | "not-callable"
        | "unconfirmed";
      message: string;
    }>;

type ThemeSourceFile = Readonly<{ path: string; content?: string | null }>;

/** Command Palette label of the explicit restore action, named in messages. */
export const RESTORE_THEME_CONTENT_MODULE_COMMAND =
  "Theme: Restore Starter Content Module";

type ValueShape = "function" | "not-function" | "unknown";

/** Type-only wrappers around a value: `x as T`, `x satisfies T`, `x!`, `<T>x`. */
const TYPE_WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "ParenthesizedExpression",
]);

const NOT_FUNCTION_EXPRESSIONS = new Set([
  "NumericLiteral",
  "StringLiteral",
  "TemplateLiteral",
  "BooleanLiteral",
  "NullLiteral",
  "BigIntLiteral",
  "RegExpLiteral",
  "ObjectExpression",
  "ArrayExpression",
  "ClassExpression",
]);

type ModuleShapes = Readonly<{
  /** Exported value names, with what the syntax shows about each. */
  exports: ReadonlyMap<string, ValueShape>;
  /** `export * from "…"`: any other name may come from there. */
  hasExportAll: boolean;
}>;

function readModuleShapes(source: string): ModuleShapes | null {
  let ast: any;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch {
    return null;
  }

  // Top-level bindings, so `export { read as content }` can be followed to
  // its declaration in this file. An import is another file: unknown.
  const declarations = new Map<string, { node: any; kind: "function" | "class" | "variable" | "import" }>();
  const declare = (statement: any) => {
    if (!statement || statement.declare) return;
    if (statement.type === "FunctionDeclaration" && statement.id) {
      declarations.set(statement.id.name, { node: statement, kind: "function" });
    } else if (statement.type === "ClassDeclaration" && statement.id) {
      declarations.set(statement.id.name, { node: statement, kind: "class" });
    } else if (statement.type === "VariableDeclaration") {
      for (const declarator of statement.declarations ?? []) {
        if (declarator.id?.type === "Identifier") {
          declarations.set(declarator.id.name, {
            node: declarator,
            kind: "variable",
          });
        }
      }
    }
  };
  for (const statement of ast.program.body ?? []) {
    if (statement.type === "ImportDeclaration") {
      for (const specifier of statement.specifiers ?? []) {
        if (specifier.local?.type === "Identifier") {
          declarations.set(specifier.local.name, {
            node: specifier,
            kind: "import",
          });
        }
      }
    } else if (statement.type === "ExportNamedDeclaration") {
      declare(statement.declaration);
    } else {
      declare(statement);
    }
  }

  const visiting = new Set<string>();
  const bindingShape = (name: string): ValueShape => {
    const binding = declarations.get(name);
    if (!binding || visiting.has(name)) return "unknown";
    if (binding.kind === "function") return "function";
    if (binding.kind === "class") return "not-function";
    if (binding.kind === "import") return "unknown";
    visiting.add(name);
    try {
      // `let content;` may be assigned later: the declaration alone says
      // nothing about what it holds when called.
      return binding.node.init ? expressionShape(binding.node.init) : "unknown";
    } finally {
      visiting.delete(name);
    }
  };
  const expressionShape = (node: any): ValueShape => {
    let current = node;
    while (current && TYPE_WRAPPERS.has(current.type)) {
      current = current.expression;
    }
    if (!current) return "unknown";
    if (
      current.type === "ArrowFunctionExpression" ||
      current.type === "FunctionExpression"
    ) {
      return "function";
    }
    if (NOT_FUNCTION_EXPRESSIONS.has(current.type)) return "not-function";
    if (current.type === "Identifier") {
      return current.name === "undefined"
        ? "not-function"
        : bindingShape(current.name);
    }
    return "unknown";
  };

  const exports = new Map<string, ValueShape>();
  let hasExportAll = false;
  for (const statement of ast.program.body ?? []) {
    if (statement.type === "ExportAllDeclaration") {
      if (statement.exportKind !== "type") hasExportAll = true;
      continue;
    }
    if (statement.type !== "ExportNamedDeclaration") continue;
    // `export type { … }` names no runtime value.
    if (statement.exportKind === "type") continue;
    const declaration = statement.declaration;
    if (declaration) {
      // `export declare …` is erased: nothing exists at run time.
      if (declaration.declare) continue;
      if (declaration.type === "FunctionDeclaration" && declaration.id) {
        exports.set(declaration.id.name, "function");
      } else if (declaration.type === "ClassDeclaration" && declaration.id) {
        exports.set(declaration.id.name, "not-function");
      } else if (declaration.type === "VariableDeclaration") {
        for (const declarator of declaration.declarations ?? []) {
          // A destructured export binds names whose values the syntax does
          // not show, so it is left unconfirmed rather than guessed at.
          if (declarator.id?.type === "Identifier") {
            exports.set(declarator.id.name, bindingShape(declarator.id.name));
          } else {
            for (const name of patternNames(declarator.id)) {
              exports.set(name, "unknown");
            }
          }
        }
      }
      continue;
    }
    for (const specifier of statement.specifiers ?? []) {
      if (specifier.type !== "ExportSpecifier") continue;
      if (specifier.exportKind === "type") continue;
      const name = moduleExportName(specifier.exported);
      if (!name) continue;
      // Re-exported from another file: what it is lives there.
      exports.set(
        name,
        statement.source
          ? "unknown"
          : bindingShape(moduleExportName(specifier.local) ?? ""),
      );
    }
  }
  return { exports, hasExportAll };
}

function moduleExportName(node: any): string | null {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "StringLiteral") return node.value;
  return null;
}

function patternNames(node: any): string[] {
  if (!node) return [];
  if (node.type === "Identifier") return [node.name];
  if (node.type === "ObjectPattern") {
    return (node.properties ?? []).flatMap((property: any) =>
      patternNames(property.type === "RestElement" ? property.argument : property.value),
    );
  }
  if (node.type === "ArrayPattern") {
    return (node.elements ?? []).flatMap((element: any) =>
      patternNames(element?.type === "RestElement" ? element.argument : element),
    );
  }
  if (node.type === "AssignmentPattern") return patternNames(node.left);
  return [];
}

/**
 * Whether the content module's `exportName` can be confirmed as a function
 * this file declares, for an operation described by `purpose` (e.g. "add a
 * section"). Confirms the shape only; the module is never run.
 *
 * Only for an operation that calls the export. It is not a check of whether
 * the module "supports Morph": the Starter's `morph` is an object and fails
 * here by design, and a module without `content` is complete for a page read
 * through `morph.pages.get`.
 */
export function confirmThemeContentModuleFunctionExport(
  files: readonly ThemeSourceFile[],
  exportName: string,
  purpose: string,
): ThemeContentModuleFunctionExportCheck {
  const file = files.find(
    (candidate) =>
      candidate.path.replace(/\\/g, "/") === THEME_CONTENT_MODULE_PATH,
  );
  if (!file) {
    return {
      ok: false,
      reason: "missing",
      message: `Cannot ${purpose}: ${THEME_CONTENT_MODULE_PATH} is missing, and Design binds sections through its ${exportName}(). Restore it in Code mode with "${RESTORE_THEME_CONTENT_MODULE_COMMAND}" from the Command Palette, then try again.`,
    };
  }
  const shapes = readModuleShapes(file.content ?? "");
  if (!shapes) {
    return {
      ok: false,
      reason: "unparseable",
      message: `Cannot ${purpose}: ${THEME_CONTENT_MODULE_PATH} could not be parsed, so Design cannot confirm the ${exportName}() it needs. Fix the file in Code mode, then try again.`,
    };
  }
  const shape = shapes.exports.get(exportName);
  if (shape === "function") return { ok: true };
  if (shape === "not-function") {
    return {
      ok: false,
      reason: "not-callable",
      message: `Cannot ${purpose}: ${THEME_CONTENT_MODULE_PATH} exports ${exportName}, but not as a function, and Design writes ${exportName}("slot") calls. Change the export in Code mode, then try again.`,
    };
  }
  if (shape === "unknown" || shapes.hasExportAll) {
    return {
      ok: false,
      reason: "unconfirmed",
      message: `Cannot ${purpose}: Design cannot confirm that ${THEME_CONTENT_MODULE_PATH} exports ${exportName} as a function. It confirms only a function declared in that file (\`export function ${exportName}\`, or a const set to an arrow or function expression); a factory's result or a re-export cannot be checked without running your code. Saving and building are not affected.`,
    };
  }
  return {
    ok: false,
    reason: "not-exported",
    message: `Cannot ${purpose}: ${THEME_CONTENT_MODULE_PATH} does not export ${exportName}(), which Design writes to bind a section. Add the export in Code mode, then try again.`,
  };
}
