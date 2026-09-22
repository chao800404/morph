import { parse } from "@babel/parser";
import type {
  ThemeContentFieldDefinition,
  ThemeScalarContentFieldDefinition,
} from "@/lib/storefront/theme-content-capabilities";

const MAX_INFERRED_FIELDS = 100;

export type InferredThemeContentFieldsResult = Readonly<{
  fields: Readonly<Record<string, ThemeContentFieldDefinition>>;
}>;

type TypeMap = ReadonlyMap<string, any>;

function parseAst(source: string): any {
  return parse(source, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });
}

function propertyName(node: any): string | null {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "StringLiteral") return node.value;
  return null;
}

function unwrapType(node: any): any {
  let current = node;
  while (
    current?.type === "TSParenthesizedType" ||
    current?.type === "TSOptionalType" ||
    current?.type === "TSUndefinedKeyword"
  ) {
    current =
      current.type === "TSUndefinedKeyword" ? null : current.typeAnnotation;
  }
  return current;
}

function typeName(node: any): string | null {
  const unwrapped = unwrapType(node);
  return unwrapped?.type === "TSTypeReference"
    ? unwrapped.typeName?.type === "Identifier"
      ? unwrapped.typeName.name
      : null
    : null;
}

function staticValue(node: any): unknown | undefined {
  if (!node) return undefined;
  switch (node.type) {
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
      return node.value;
    case "NullLiteral":
      return null;
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
      return staticValue(node.expression);
    case "ObjectExpression": {
      const result: Record<string, unknown> = {};
      for (const property of node.properties ?? []) {
        if (property.type !== "ObjectProperty" || property.computed) {
          return undefined;
        }
        const key = propertyName(property.key);
        const value = staticValue(property.value);
        if (!key || value === undefined) return undefined;
        result[key] = value;
      }
      return result;
    }
    default:
      return undefined;
  }
}

function isImageObject(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.src === "string" && typeof record.alt === "string";
}

function fieldFromType(
  node: any,
  aliases: TypeMap,
): ThemeScalarContentFieldDefinition | null {
  const unwrapped = unwrapType(node);
  if (!unwrapped) return null;

  if (unwrapped.type === "TSTypeReference") {
    const name = typeName(unwrapped);
    const alias = name ? aliases.get(name) : null;
    return alias ? fieldFromType(alias, aliases) : null;
  }
  if (unwrapped.type === "TSStringKeyword") return { type: "text" };
  if (unwrapped.type === "TSNumberKeyword") return { type: "number" };
  if (unwrapped.type === "TSBooleanKeyword") return { type: "boolean" };
  if (unwrapped.type === "TSLiteralType") {
    if (unwrapped.literal?.type === "StringLiteral") {
      return { type: "text" };
    }
    if (unwrapped.literal?.type === "NumericLiteral") {
      return { type: "number" };
    }
    if (unwrapped.literal?.type === "BooleanLiteral") {
      return { type: "boolean" };
    }
  }
  if (unwrapped.type === "TSUnionType") {
    const values = unwrapped.types
      .map((member: any) => unwrapType(member)?.literal)
      .filter((literal: any) => literal?.type === "StringLiteral")
      .map((literal: any) => literal.value as string);
    if (
      values.length === unwrapped.types.length &&
      new Set(values).size === values.length
    ) {
      return {
        type: "select",
        options: values.map((value: string) => ({ label: value, value })),
      };
    }
  }
  if (unwrapped.type === "TSTypeLiteral") {
    const keys = new Set(
      (unwrapped.members ?? [])
        .map((member: any) => propertyName(member.key))
        .filter((key: string | null): key is string => Boolean(key)),
    );
    if (keys.has("src") && keys.has("alt")) return { type: "image" };
  }
  return null;
}

function typeMembers(node: any): any[] {
  const unwrapped = unwrapType(node);
  if (unwrapped?.type === "TSTypeLiteral") return unwrapped.members ?? [];
  return [];
}

function collectAliases(ast: any): Map<string, any> {
  const aliases = new Map<string, any>();
  for (const statement of ast.program.body ?? []) {
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? statement.declaration
        : statement;
    if (declaration?.type === "TSTypeAliasDeclaration") {
      aliases.set(declaration.id.name, declaration.typeAnnotation);
    }
    if (declaration?.type === "TSInterfaceDeclaration") {
      aliases.set(declaration.id.name, {
        type: "TSTypeLiteral",
        members: declaration.body?.body ?? [],
      });
    }
  }
  return aliases;
}

function findDefaultComponent(ast: any): any | null {
  const defaultDeclaration = (ast.program.body ?? []).find(
    (statement: any) => statement.type === "ExportDefaultDeclaration",
  )?.declaration;
  if (
    defaultDeclaration?.type === "FunctionDeclaration" ||
    defaultDeclaration?.type === "ArrowFunctionExpression" ||
    defaultDeclaration?.type === "FunctionExpression"
  ) {
    return defaultDeclaration;
  }
  const defaultName =
    defaultDeclaration?.type === "Identifier" ? defaultDeclaration.name : null;
  if (!defaultName) return null;
  for (const statement of ast.program.body ?? []) {
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? statement.declaration
        : statement;
    if (
      declaration?.type === "FunctionDeclaration" &&
      declaration.id?.name === defaultName
    ) {
      return declaration;
    }
    if (declaration?.type !== "VariableDeclaration") continue;
    const match = declaration.declarations?.find(
      (entry: any) =>
        entry.id?.type === "Identifier" && entry.id.name === defaultName,
    );
    if (
      match?.init?.type === "ArrowFunctionExpression" ||
      match?.init?.type === "FunctionExpression"
    ) {
      return match.init;
    }
  }
  return null;
}

function inferField(
  key: string,
  binding: any,
  defaultNode: any,
  aliases: TypeMap,
  declaredType?: any,
): ThemeScalarContentFieldDefinition | null {
  const annotation = binding?.typeAnnotation?.typeAnnotation ?? declaredType;
  const inferred = fieldFromType(annotation, aliases);
  if (inferred) return inferred;
  const value = staticValue(defaultNode);
  if (value !== undefined) {
    if (isImageObject(value)) return { type: "image" };
    if (typeof value === "string") return { type: "text" };
    if (typeof value === "number" && Number.isFinite(value))
      return { type: "number" };
    if (typeof value === "boolean") return { type: "boolean" };
  }
  // `key` is intentionally not used to guess a field type. A string named
  // `image` is still only proven to be a string; media needs an object shape or
  // an explicit contentFields override.
  void key;
  return null;
}

function fieldsFromMembers(
  members: any[],
  aliases: TypeMap,
): Record<string, ThemeContentFieldDefinition> {
  const fields: Record<string, ThemeContentFieldDefinition> = {};
  for (const member of members) {
    const key = propertyName(member.key);
    if (!key || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) continue;
    const definition = fieldFromType(
      member.typeAnnotation?.typeAnnotation,
      aliases,
    );
    if (definition) fields[key] = definition;
  }
  return fields;
}

/**
 * The members a props annotation resolves to.
 *
 * Both an inline object type and a same-file alias are accepted, and inline is
 * tried first because that is the shape written at the parameter itself. A
 * named type is looked up only when the annotation references one; a reference
 * to an imported type resolves to nothing, which is how an external type is
 * refused rather than guessed at.
 *
 * One function rather than two, because the two callers previously disagreed:
 * the destructured-parameter path tried the inline type first and the
 * identifier-parameter path did not, so `props: { title: string }` inferred
 * nothing at all while `{ title }: { title: string }` inferred `title`.
 */
function resolveMembers(annotation: any, aliases: TypeMap): any[] {
  const inlineMembers = typeMembers(annotation);
  if (inlineMembers.length > 0) return inlineMembers;
  return typeMembers(aliases.get(typeName(annotation) ?? ""));
}

function fieldsByMemberName(
  parameter: any,
  aliases: TypeMap,
): ReadonlyMap<string, any> {
  const byName = new Map<string, any>();
  for (const member of resolveMembers(
    parameter?.typeAnnotation?.typeAnnotation,
    aliases,
  )) {
    const key = propertyName(member.key);
    if (key) byName.set(key, member);
  }
  return byName;
}

/**
 * Infers only serializable scalar fields from a component's own props.
 *
 * This is deliberately narrower than a TypeScript type checker: it reads
 * default values and same-file object types, never executes source and never
 * follows an imported type. Explicit contentFields remains the escape hatch
 * for media strings, arrays, links, runtime values, and richer semantics.
 */
export function inferThemeContentFields(
  sourceCode: string,
): InferredThemeContentFieldsResult {
  if (typeof sourceCode !== "string" || sourceCode.trim() === "") {
    return { fields: {} };
  }
  let ast: any;
  try {
    ast = parseAst(sourceCode);
  } catch {
    return { fields: {} };
  }

  const aliases = collectAliases(ast);
  const component = findDefaultComponent(ast);
  if (!component) return { fields: {} };
  let parameter = component.params?.[0];
  if (parameter?.type === "AssignmentPattern") parameter = parameter.left;
  if (!parameter) return { fields: {} };

  if (parameter.type === "Identifier") {
    return {
      fields: fieldsFromMembers(
        resolveMembers(parameter.typeAnnotation?.typeAnnotation, aliases),
        aliases,
      ),
    };
  }
  if (parameter.type !== "ObjectPattern")
    return { fields: {} };

  const fields: Record<string, ThemeContentFieldDefinition> = {};
  const members = fieldsByMemberName(parameter, aliases);
  for (const property of parameter.properties ?? []) {
    if (property.type !== "ObjectProperty" || property.computed) continue;
    const key = propertyName(property.key);
    if (!key || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) continue;
    const binding =
      property.value?.type === "AssignmentPattern"
        ? property.value.left
        : property.value;
    const defaultNode =
      property.value?.type === "AssignmentPattern"
        ? property.value.right
        : null;
    const definition = inferField(
      key,
      binding,
      defaultNode,
      aliases,
      members.get(key)?.typeAnnotation?.typeAnnotation,
    );
    if (definition) fields[key] = definition;
    if (Object.keys(fields).length >= MAX_INFERRED_FIELDS) break;
  }
  return { fields };
}
