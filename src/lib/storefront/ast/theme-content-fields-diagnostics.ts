import { parse } from "@babel/parser";
import {
  readComponentSourcePaths,
  resolveThemeContentCapabilitiesFromFiles,
} from "../theme-content-capability-resolver";
import { parseComponentSource } from "./theme-ast-transformer";
import { findUnindexedContentArrayMaps } from "./inject-preview-bindings";

const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_PROPS_PER_COMPONENT = 50;
const propCache = new Map<string, ReadonlyMap<string, PropLocation>>();

/** The shape consumed by the Code workspace Problems panel. */
export type ThemeContentFieldsDiagnostic = Readonly<{
  id: string;
  path: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
  source: string;
  severity: "warning";
}>;

type PropLocation = Readonly<{ line: number; column: number }>;

function isNode(value: unknown): value is { type: string; [key: string]: any } {
  return typeof value === "object" && value !== null && "type" in value;
}

function walk(node: unknown, visitor: (node: any) => void): void {
  if (!isNode(node)) return;
  visitor(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "comments") continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visitor));
    else if (value && typeof value === "object") walk(value, visitor);
  }
}

function keyName(node: any): string | null {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "StringLiteral") return node.value;
  if (node?.type === "NumericLiteral") return String(node.value);
  return null;
}

function unwrapParameter(node: any): any {
  let current = node;
  while (
    current?.type === "AssignmentPattern" ||
    current?.type === "TSParameterProperty"
  ) {
    current = current.left;
  }
  return current;
}

function readTypeMemberNames(typeNode: any): Map<string, PropLocation> {
  const result = new Map<string, PropLocation>();
  const body =
    typeNode?.type === "TSTypeLiteral" || typeNode?.type === "TSInterfaceBody"
      ? typeNode
      : typeNode?.body;
  for (const member of body?.members ?? body?.body ?? []) {
    if (
      member?.type !== "TSPropertySignature" &&
      member?.type !== "TSMethodSignature"
    ) {
      continue;
    }
    const name = keyName(member.key);
    if (!name || result.has(name)) continue;
    result.set(name, {
      line: member.loc?.start?.line ?? 1,
      column: (member.loc?.start?.column ?? 0) + 1,
    });
  }
  return result;
}

function readParameterProps(
  parameter: any,
  typeAliases: ReadonlyMap<string, Map<string, PropLocation>>,
): Map<string, PropLocation> {
  const result = new Map<string, PropLocation>();
  const unwrapped = unwrapParameter(parameter);
  if (unwrapped?.type === "ObjectPattern") {
    for (const property of unwrapped.properties ?? []) {
      if (property?.type !== "ObjectProperty") continue;
      const name = keyName(property.key);
      if (!name || result.has(name)) continue;
      result.set(name, {
        line: property.loc?.start?.line ?? 1,
        column: (property.loc?.start?.column ?? 0) + 1,
      });
    }
    return result;
  }

  if (unwrapped?.type !== "Identifier") return result;
  const annotation =
    unwrapped.typeAnnotation?.type === "TSTypeAnnotation"
      ? unwrapped.typeAnnotation.typeAnnotation
      : unwrapped.typeAnnotation;
  if (annotation?.type === "TSTypeLiteral") {
    return readTypeMemberNames(annotation);
  }
  if (annotation?.type === "TSTypeReference") {
    const name = keyName(annotation.typeName);
    const members = name ? typeAliases.get(name) : undefined;
    if (members) return new Map(members);
  }
  return result;
}

function isComponentName(name: unknown): name is string {
  return typeof name === "string" && /^[A-Z]/.test(name);
}

function likelyContentProp(name: string): boolean {
  const lower = name.toLowerCase();
  if (
    name === "children" ||
    name === "key" ||
    name === "ref" ||
    name === "className" ||
    name === "style" ||
    name === "variant" ||
    name === "size" ||
    name === "asChild" ||
    name === "disabled" ||
    name === "loading" ||
    name === "open" ||
    name === "value" ||
    name === "checked" ||
    name === "selected" ||
    lower.startsWith("on") ||
    lower.startsWith("is") ||
    lower.startsWith("has")
  ) {
    return false;
  }
  return true;
}

/**
 * Finds statically visible component props without executing theme code.
 * Runtime-only props are deliberately ignored; this is a reminder, not an
 * attempt to turn TypeScript's complete prop type into a content schema.
 */
export function collectComponentPropNames(
  source: string,
): ReadonlyMap<string, PropLocation> {
  if (source.length > MAX_SOURCE_BYTES) return new Map();
  const cached = propCache.get(source);
  if (cached) return cached;
  let ast: any;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch {
    const empty = new Map<string, PropLocation>();
    propCache.set(source, empty);
    return empty;
  }

  const typeAliases = new Map<string, Map<string, PropLocation>>();
  walk(ast, (node) => {
    if (node.type === "TSInterfaceDeclaration") {
      const name = node.id?.name;
      if (name) typeAliases.set(name, readTypeMemberNames(node.body));
    } else if (node.type === "TSTypeAliasDeclaration") {
      const name = node.id?.name;
      if (name) typeAliases.set(name, readTypeMemberNames(node.typeAnnotation));
    }
  });

  const props = new Map<string, PropLocation>();
  const collect = (node: any, componentName?: string) => {
    if (!componentName && !node) return;
    const firstParameter = node?.params?.[0];
    for (const [name, location] of readParameterProps(
      firstParameter,
      typeAliases,
    )) {
      if (props.size >= MAX_PROPS_PER_COMPONENT || !likelyContentProp(name)) {
        continue;
      }
      if (!props.has(name)) props.set(name, location);
    }
  };

  walk(ast, (node) => {
    if (node.type === "FunctionDeclaration" && isComponentName(node.id?.name)) {
      collect(node, node.id.name);
    } else if (
      node.type === "VariableDeclarator" &&
      isComponentName(node.id?.name) &&
      (node.init?.type === "ArrowFunctionExpression" ||
        node.init?.type === "FunctionExpression")
    ) {
      collect(node.init, node.id.name);
    } else if (
      node.type === "ExportDefaultDeclaration" &&
      (node.declaration?.type === "ArrowFunctionExpression" ||
        node.declaration?.type === "FunctionExpression" ||
        node.declaration?.type === "FunctionDeclaration")
    ) {
      collect(node.declaration, "default");
    }
  });

  propCache.set(source, props);
  if (propCache.size > 200) {
    const oldest = propCache.keys().next().value;
    if (oldest !== undefined) propCache.delete(oldest);
  }
  return props;
}

/**
 * Reports props that the Design editor cannot expose because the component's
 * `contentFields` allowlist does not contain them. The result is advisory and
 * contains no source edit or inferred field type.
 */
export function collectThemeContentFieldsDiagnostics(
  themeFiles: ReadonlyArray<{ path: string; content?: string | null }>,
): ThemeContentFieldsDiagnostic[] {
  const manifest = themeFiles.find(
    (file) => file.path === "morph.theme.json",
  )?.content;
  const sourceRefs = readComponentSourcePaths(manifest);
  const capabilities = resolveThemeContentCapabilitiesFromFiles(themeFiles);
  const diagnostics: ThemeContentFieldsDiagnostic[] = [];

  for (const file of themeFiles) {
    if (!file.path.startsWith("src/") || !/\.(?:tsx|jsx)$/.test(file.path)) {
      continue;
    }
    // Route files receive framework loader/search params rather than Document
    // content. Restrict the reminder to authored component locations (or a
    // file explicitly registered as a Theme component) to avoid noisy advice
    // for normal application routes.
    const isRegisteredComponent = [...sourceRefs.values()].includes(file.path);
    if (
      !isRegisteredComponent &&
      !file.path.includes("/components/") &&
      !file.path.includes("/sections/")
    ) {
      continue;
    }
    if (typeof file.content !== "string") continue;

    // A repeated field whose callback takes no index. Reported before the
    // declaration reminder below because it is the more consequential of the
    // two: the props one says a field will not appear, this one says every row
    // of a field that does appear is unreachable — and only once the array
    // holds more than one item, so it reads as software that worked yesterday.
    for (const unindexed of findUnindexedContentArrayMaps({
      path: file.path,
      content: file.content,
    })) {
      diagnostics.push({
        id: `content-array-index:${file.path}:${unindexed.arrayPath}`,
        path: file.path,
        line: unindexed.line,
        column: unindexed.column,
        endLine: unindexed.line,
        endColumn: unindexed.column + 3,
        message: `"${unindexed.arrayPath}" is a repeated content field, and this map takes no index. Its rows cannot be told apart in Design mode once the array holds more than one item — take a second parameter, as in ${unindexed.arrayPath}.map((item, index) => …).`,
        source: "Morph content fields",
        severity: "warning",
      });
    }

    const props = collectComponentPropNames(file.content);
    if (props.size === 0) continue;
    // Legacy components with literal defaults already have the bounded source
    // editing contract supported by the Inspector. Do not tell an author that
    // those defaults are missing from Design mode; only genuinely unrepresented
    // props need the new declaration reminder.
    const legacyDefaults = new Set(
      Object.keys(parseComponentSource(file.content, file.path).defaultProps),
    );
    const componentRef = [...sourceRefs.entries()].find(
      ([, sourcePath]) => sourcePath === file.path,
    )?.[0];
    const fields =
      capabilities.capabilities[file.path]?.fields ??
      (componentRef ? capabilities.capabilities[componentRef]?.fields : null);
    const missing = [...props.entries()].filter(
      ([name]) =>
        !legacyDefaults.has(name) &&
        (!fields || !Object.prototype.hasOwnProperty.call(fields, name)),
    );
    if (missing.length === 0) continue;
    const [firstName, firstLocation] = missing[0];
    const names = missing.map(([name]) => `"${name}"`).join(", ");
    diagnostics.push({
      id: `content-fields:${file.path}:${firstName}`,
      path: file.path,
      line: firstLocation.line,
      column: firstLocation.column,
      endLine: firstLocation.line,
      endColumn: firstLocation.column + firstName.length,
      message: `Props ${names} are not declared in contentFields and will not appear in Design mode.`,
      source: "Morph content fields",
      severity: "warning",
    });
  }

  return diagnostics;
}
