import { parse } from "@babel/parser";
import {
  themeContentFieldDefinitionSchema,
  type ThemeContentFieldDefinition,
} from "@/lib/storefront/theme-content-capabilities";

/** Matches the manifest limit so both declaration sources accept the same set. */
const MAX_COMPONENT_CONTENT_FIELDS = 100;
const MAX_SOURCE_BYTES = 512 * 1024;

export const COLOCATED_CONTENT_FIELDS_EXPORT = "contentFields";

export type ColocatedContentFieldsResult = Readonly<{
  /** `null` when the module declares no content fields at all. */
  fields: Readonly<Record<string, ThemeContentFieldDefinition>> | null;
  diagnostics: readonly string[];
}>;

function parseAst(sourceCode: string) {
  return parse(sourceCode, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });
}

/**
 * Evaluates a statically analysable literal.
 *
 * Only literal data is accepted: a field declaration that depends on runtime
 * values could not be shown in the editor before the Theme runs, so it is
 * refused rather than partially understood.
 */
function readStaticLiteral(node: any): { ok: true; value: unknown } | { ok: false } {
  if (!node) return { ok: false };
  switch (node.type) {
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
      return { ok: true, value: node.value };
    case "NullLiteral":
      return { ok: true, value: null };
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
      // `as const` / `satisfies` wrappers carry no runtime meaning.
      return readStaticLiteral(node.expression);
    case "ArrayExpression": {
      const items: unknown[] = [];
      for (const element of node.elements ?? []) {
        const item = readStaticLiteral(element);
        if (!item.ok) return { ok: false };
        items.push(item.value);
      }
      return { ok: true, value: items };
    }
    case "ObjectExpression": {
      const object: Record<string, unknown> = {};
      for (const property of node.properties ?? []) {
        if (property.type !== "ObjectProperty" || property.computed) {
          return { ok: false };
        }
        const key =
          property.key?.type === "Identifier"
            ? property.key.name
            : property.key?.type === "StringLiteral"
              ? property.key.value
              : null;
        if (typeof key !== "string") return { ok: false };
        const value = readStaticLiteral(property.value);
        if (!value.ok) return { ok: false };
        object[key] = value.value;
      }
      return { ok: true, value: object };
    }
    default:
      return { ok: false };
  }
}

function findContentFieldsInitializer(ast: any): any | null {
  for (const statement of ast.program.body ?? []) {
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? statement.declaration
        : null;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const declarator of declaration.declarations ?? []) {
      if (
        declarator.id?.type === "Identifier" &&
        declarator.id.name === COLOCATED_CONTENT_FIELDS_EXPORT
      ) {
        return declarator.init ?? null;
      }
    }
  }
  return null;
}

/**
 * Reads a component's own content field declaration from its source.
 *
 * Declaring fields next to the component they describe removes the manifest as
 * a separately maintained registry: a component and its editable fields are
 * authored in one file and cannot drift apart. Anything unparseable fails
 * closed with a diagnostic rather than silently exposing a partial form.
 *
 * ```tsx
 * export const contentFields = {
 *   title: { type: "text", label: "Title" },
 * } as const;
 * ```
 */
/**
 * Parsed declarations keyed by the exact source that produced them.
 *
 * The editor resolves capabilities again on every workspace change, which in
 * Code mode is every keystroke, and every declaring component would otherwise
 * be re-parsed each time. Keyed by content rather than by path so an edited
 * file misses and a reverted one hits.
 */
const parseCache = new Map<string, ColocatedContentFieldsResult>();

const MAX_PARSE_CACHE_ENTRIES = 200;

function cacheParse(
  sourceCode: string,
  result: ColocatedContentFieldsResult,
): ColocatedContentFieldsResult {
  parseCache.set(sourceCode, result);
  if (parseCache.size > MAX_PARSE_CACHE_ENTRIES) {
    const oldest = parseCache.keys().next().value;
    if (oldest !== undefined) parseCache.delete(oldest);
  }
  return result;
}

export function parseColocatedContentFields(
  sourceCode: string,
): ColocatedContentFieldsResult {
  if (typeof sourceCode !== "string" || sourceCode.trim() === "") {
    return { fields: null, diagnostics: [] };
  }
  const cached = parseCache.get(sourceCode);
  if (cached) return cached;
  if (sourceCode.length > MAX_SOURCE_BYTES) {
    return cacheParse(sourceCode, {
      fields: null,
      diagnostics: ["Component source is too large to scan for contentFields."],
    });
  }
  // Cheap guard so unrelated component files are not parsed at all.
  if (!sourceCode.includes(COLOCATED_CONTENT_FIELDS_EXPORT)) {
    return cacheParse(sourceCode, { fields: null, diagnostics: [] });
  }

  let ast: any;
  try {
    ast = parseAst(sourceCode);
  } catch (error) {
    return cacheParse(sourceCode, {
      fields: null,
      diagnostics: [
        `Could not parse component source: ${
          error instanceof Error ? error.message : "invalid source"
        }`,
      ],
    });
  }

  const initializer = findContentFieldsInitializer(ast);
  if (!initializer) return cacheParse(sourceCode, { fields: null, diagnostics: [] });

  const literal = readStaticLiteral(initializer);
  if (!literal.ok || !literal.value || typeof literal.value !== "object") {
    return cacheParse(sourceCode, {
      fields: null,
      diagnostics: [
        `"${COLOCATED_CONTENT_FIELDS_EXPORT}" must be a static object literal to be editable.`,
      ],
    });
  }

  const entries = Object.entries(literal.value as Record<string, unknown>);
  if (entries.length > MAX_COMPONENT_CONTENT_FIELDS) {
    return cacheParse(sourceCode, {
      fields: null,
      diagnostics: [
        `"${COLOCATED_CONTENT_FIELDS_EXPORT}" declares more than ${MAX_COMPONENT_CONTENT_FIELDS} fields.`,
      ],
    });
  }

  const fields: Record<string, ThemeContentFieldDefinition> = {};
  const diagnostics: string[] = [];

  for (const [key, definition] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) || key.length > 64) {
      diagnostics.push(`Invalid content field name: "${key}".`);
      continue;
    }
    // Validated with the manifest's own schema so both declaration sources
    // accept exactly the same field definitions.
    const parsed = themeContentFieldDefinitionSchema.safeParse(definition);
    if (!parsed.success) {
      diagnostics.push(`Invalid content field "${key}".`);
      continue;
    }
    fields[key] = parsed.data;
  }

  return cacheParse(sourceCode, {
    fields: Object.keys(fields).length > 0 ? fields : null,
    diagnostics,
  });
}
