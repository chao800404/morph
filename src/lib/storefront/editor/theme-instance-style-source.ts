import { parse } from "@babel/parser";
import { tokenizeTailwindClasses } from "@/lib/storefront/ast/tailwind-token-engine";

export type ThemeInstanceStyleTarget = {
  sectionId: string;
  fieldPath: string;
  itemId?: string;
};

type ThemeSourceFile = {
  path: string;
  content: string;
};

type LocatedClassName = {
  opening: any;
  attribute: any | null;
  expression: any | null;
  staticClassName: string | null;
  cnCall: any | null;
  ast: any;
};

const INSTANCE_VARIANT_PREFIX = "[[data-storefront-section-id='";
const MORPH_INSTANCE_CLASS_MAP = "morphInstanceClasses";

function parseTsx(sourceCode: string) {
  return parse(sourceCode, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });
}

function walk(node: any, visitor: (node: any) => void) {
  if (!node || typeof node !== "object") return;
  visitor(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "comments") continue;
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visitor);
    } else if (value && typeof value === "object") {
      walk(value, visitor);
    }
  }
}

function jsxAttribute(opening: any, name: string): any | null {
  return (
    opening.attributes?.find(
      (attribute: any) =>
        attribute.type === "JSXAttribute" &&
        attribute.name?.type === "JSXIdentifier" &&
        attribute.name.name === name,
    ) ?? null
  );
}

function literalAttributeValue(attribute: any): string | null {
  if (!attribute?.value) return null;
  if (attribute.value.type === "StringLiteral") return attribute.value.value;
  if (
    attribute.value.type === "JSXExpressionContainer" &&
    attribute.value.expression?.type === "StringLiteral"
  ) {
    return attribute.value.expression.value;
  }
  return null;
}

function locateClassName(
  sourceCode: string,
  elementName: string,
): LocatedClassName | null {
  const ast = parseTsx(sourceCode);
  let nodeMatch: any | null = null;
  let elementMatch: any | null = null;

  walk(ast, (node) => {
    if (node.type !== "JSXOpeningElement") return;
    if (
      literalAttributeValue(jsxAttribute(node, "data-morph-node")) ===
      elementName
    ) {
      nodeMatch ??= node;
    }
    if (
      literalAttributeValue(jsxAttribute(node, "data-morph-element")) ===
      elementName
    ) {
      elementMatch ??= node;
    }
  });

  const opening = nodeMatch ?? elementMatch;
  if (!opening) return null;
  const attribute = jsxAttribute(opening, "className");
  if (!attribute?.value) {
    return {
      opening,
      attribute: null,
      expression: null,
      staticClassName: null,
      cnCall: null,
      ast,
    };
  }
  if (attribute.value.type === "StringLiteral") {
    return {
      opening,
      attribute,
      expression: null,
      staticClassName: attribute.value.value,
      cnCall: null,
      ast,
    };
  }
  if (attribute.value.type !== "JSXExpressionContainer") {
    return {
      opening,
      attribute,
      expression: null,
      staticClassName: null,
      cnCall: null,
      ast,
    };
  }

  const expression = attribute.value.expression;
  const cnCall =
    expression?.type === "CallExpression" &&
    expression.callee?.type === "Identifier" &&
    expression.callee.name === "cn"
      ? expression
      : null;
  return {
    opening,
    attribute,
    expression,
    staticClassName: null,
    cnCall,
    ast,
  };
}

function safeTarget(target: ThemeInstanceStyleTarget): boolean {
  return (
    target.sectionId.length > 0 &&
    target.sectionId.length <= 256 &&
    target.fieldPath.length > 0 &&
    target.fieldPath.length <= 512 &&
    /^[A-Za-z0-9._:/-]+$/.test(target.sectionId) &&
    /^[A-Za-z0-9._:/-]+$/.test(target.fieldPath) &&
    (!target.itemId ||
      (target.itemId.length <= 256 &&
        /^[A-Za-z0-9._:/-]+$/.test(target.itemId)))
  );
}

function instanceVariant(target: ThemeInstanceStyleTarget): string {
  return `[[data-storefront-section-id='${target.sectionId}']_&[data-storefront-field-path='${target.fieldPath}']]`;
}

function scopedTokens(
  value: string,
  target: ThemeInstanceStyleTarget,
): string[] {
  const prefix = `${instanceVariant(target)}:`;
  return tokenizeTailwindClasses(value)
    .map((token) => token.raw)
    .filter((token) => token.startsWith(prefix))
    .map((token) => token.slice(prefix.length));
}

function cnStringArguments(call: any): any[] {
  return call.arguments.filter(
    (argument: any) => argument.type === "StringLiteral",
  );
}

function isInstanceLookup(argument: any): boolean {
  return Boolean(
    argument?.type === "MemberExpression" &&
    argument.computed &&
    argument.object?.type === "Identifier" &&
    argument.object.name === MORPH_INSTANCE_CLASS_MAP,
  );
}

function isStaticCnCall(call: any): boolean {
  return Boolean(
    call &&
    call.arguments.every(
      (argument: any) =>
        argument.type === "StringLiteral" || isInstanceLookup(argument),
    ),
  );
}

function cnManagedArgument(
  call: any,
  target: ThemeInstanceStyleTarget,
): any | null {
  return (
    cnStringArguments(call).find(
      (argument) => scopedTokens(argument.value, target).length > 0,
    ) ?? null
  );
}

function baseClasses(location: LocatedClassName): string {
  if (location.staticClassName !== null) return location.staticClassName;
  if (!location.cnCall) return "";
  return cnStringArguments(location.cnCall)
    .flatMap((argument) =>
      tokenizeTailwindClasses(argument.value)
        .map((token) => token.raw)
        .filter((token) => !token.startsWith(INSTANCE_VARIANT_PREFIX)),
    )
    .join(" ");
}

function findInstanceClassMap(ast: any): any | null {
  let result: any | null = null;
  walk(ast, (node) => {
    if (
      !result &&
      node.type === "VariableDeclarator" &&
      node.id?.type === "Identifier" &&
      node.id.name === MORPH_INSTANCE_CLASS_MAP &&
      node.init?.type === "ObjectExpression"
    ) {
      result = node.init;
    }
  });
  return result;
}

function instanceKey(
  target: ThemeInstanceStyleTarget,
  elementName: string,
): string | null {
  return target.itemId ? target.itemId + ":" + elementName : null;
}

function readMapEntry(
  sourceCode: string,
  target: ThemeInstanceStyleTarget,
  elementName: string,
): string | null {
  const key = instanceKey(target, elementName);
  if (!key) return null;
  const map = findInstanceClassMap(parseTsx(sourceCode));
  const property = map?.properties?.find(
    (candidate: any) =>
      candidate.type === "ObjectProperty" &&
      candidate.key?.type === "StringLiteral" &&
      candidate.key.value === key &&
      candidate.value?.type === "StringLiteral",
  );
  return property?.value?.value ?? null;
}

function hasTopLevelCnBinding(ast: any): boolean {
  return ast.program.body.some((node: any) => {
    if (node.type === "ImportDeclaration") {
      return node.specifiers?.some(
        (specifier: any) => specifier.local?.name === "cn",
      );
    }
    if (
      (node.type === "FunctionDeclaration" ||
        node.type === "ClassDeclaration") &&
      node.id?.name === "cn"
    ) {
      return true;
    }
    if (node.type === "VariableDeclaration") {
      return node.declarations?.some(
        (declaration: any) => declaration.id?.name === "cn",
      );
    }
    return false;
  });
}

function ensureCnImport(sourceCode: string): string {
  const ast = parseTsx(sourceCode);
  if (hasTopLevelCnBinding(ast)) return sourceCode;
  const imports = ast.program.body.filter(
    (node: any) => node.type === "ImportDeclaration",
  );
  const insertAt = imports.at(-1)?.end ?? 0;
  const statement = 'import { clsx as cn } from "clsx";';
  if (insertAt === 0) return `${statement}\n\n${sourceCode}`;
  return (
    sourceCode.slice(0, insertAt) +
    `\n${statement}` +
    sourceCode.slice(insertAt)
  );
}

function ensureInstanceClassMap(sourceCode: string): string {
  const ast = parseTsx(sourceCode);
  if (findInstanceClassMap(ast)) return sourceCode;
  const imports = ast.program.body.filter(
    (node: any) => node.type === "ImportDeclaration",
  );
  const insertAt = imports.at(-1)?.end ?? 0;
  const statement = "const morphInstanceClasses: Record<string, string> = {};";
  if (insertAt === 0) return statement + "\n\n" + sourceCode;
  return (
    sourceCode.slice(0, insertAt) +
    "\n\n" +
    statement +
    sourceCode.slice(insertAt)
  );
}

function ensureRepeatedItemIdType(sourceCode: string): string {
  const ast = parseTsx(sourceCode);
  let target: any | null = null;
  for (const node of ast.program.body) {
    const declaration =
      node.type === "ExportNamedDeclaration" ? node.declaration : node;
    if (
      declaration?.type === "TSTypeAliasDeclaration" &&
      /Item$/.test(declaration.id?.name ?? "") &&
      declaration.typeAnnotation?.type === "TSTypeLiteral" &&
      !declaration.typeAnnotation.members?.some(
        (member: any) =>
          member.type === "TSPropertySignature" &&
          member.key?.type === "Identifier" &&
          member.key.name === "id",
      )
    ) {
      target = declaration.typeAnnotation;
      break;
    }
  }
  if (!target || typeof target.start !== "number") return sourceCode;
  return (
    sourceCode.slice(0, target.start + 1) +
    "\n  id?: string;" +
    sourceCode.slice(target.start + 1)
  );
}

function findRepeaterItemVariable(ast: any, opening: any): string | null {
  let bestMatch: { name: string; size: number } | null = null;
  walk(ast, (node) => {
    if (
      node.type !== "CallExpression" ||
      node.callee?.type !== "MemberExpression" ||
      node.callee.property?.type !== "Identifier" ||
      node.callee.property.name !== "map"
    ) {
      return;
    }
    const callback = node.arguments?.[0];
    const itemParameter = callback?.params?.[0];
    if (
      (callback?.type !== "ArrowFunctionExpression" &&
        callback?.type !== "FunctionExpression") ||
      itemParameter?.type !== "Identifier" ||
      typeof callback.start !== "number" ||
      typeof callback.end !== "number" ||
      callback.start > opening.start ||
      callback.end < opening.end
    ) {
      return;
    }
    const size = callback.end - callback.start;
    if (!bestMatch || size < bestMatch.size) {
      bestMatch = { name: itemParameter.name, size };
    }
  });
  return bestMatch === null
    ? null
    : (bestMatch as { name: string; size: number }).name;
}

function ensureLookupArgument(
  sourceCode: string,
  elementName: string,
): string | null {
  const location = locateClassName(sourceCode, elementName);
  if (!location) return null;
  const itemVariable = findRepeaterItemVariable(location.ast, location.opening);
  if (!itemVariable) return null;
  const tick = String.fromCharCode(96);
  const lookup =
    "morphInstanceClasses[" +
    tick +
    "$" +
    "{" +
    itemVariable +
    ".id}:" +
    elementName +
    tick +
    "]";

  if (location.cnCall) {
    if (!isStaticCnCall(location.cnCall)) return null;
    if (location.cnCall.arguments.some(isInstanceLookup)) return sourceCode;
    const last = location.cnCall.arguments.at(-1);
    const insertAt = last?.end ?? location.cnCall.end - 1;
    return (
      sourceCode.slice(0, insertAt) +
      (last ? ", " : "") +
      lookup +
      sourceCode.slice(insertAt)
    );
  }
  if (location.staticClassName !== null) {
    return (
      sourceCode.slice(0, location.attribute.value.start) +
      "{cn(" +
      JSON.stringify(location.staticClassName) +
      ", " +
      lookup +
      ")}" +
      sourceCode.slice(location.attribute.value.end)
    );
  }
  if (!location.attribute) {
    const insertAt =
      location.opening.end - (location.opening.selfClosing ? 2 : 1);
    return (
      sourceCode.slice(0, insertAt) +
      " className={cn(" +
      lookup +
      ")}" +
      sourceCode.slice(insertAt)
    );
  }
  return null;
}

function setMapEntry(sourceCode: string, key: string, value: string): string {
  const map = findInstanceClassMap(parseTsx(sourceCode));
  if (!map) return sourceCode;
  const property = map.properties?.find(
    (candidate: any) =>
      candidate.type === "ObjectProperty" &&
      candidate.key?.type === "StringLiteral" &&
      candidate.key.value === key,
  );
  if (property) {
    if (!value) {
      const properties = map.properties;
      const index = properties.indexOf(property);
      let start = property.start;
      let end = property.end;
      if (index < properties.length - 1) {
        end = properties[index + 1].start;
      } else if (index > 0) {
        start = properties[index - 1].end;
      } else {
        const commaAfter = sourceCode.indexOf(",", property.end);
        if (commaAfter >= 0 && commaAfter < map.end) {
          end = commaAfter + 1;
        }
      }
      return sourceCode.slice(0, start) + sourceCode.slice(end);
    }
    return (
      sourceCode.slice(0, property.value.start) +
      JSON.stringify(value) +
      sourceCode.slice(property.value.end)
    );
  }
  if (!value) return sourceCode;
  const entry =
    "\n  " + JSON.stringify(key) + ": " + JSON.stringify(value) + ",\n";
  return (
    sourceCode.slice(0, map.end - 1) + entry + sourceCode.slice(map.end - 1)
  );
}

function removeArgument(sourceCode: string, call: any, argument: any): string {
  const args = call.arguments;
  const index = args.indexOf(argument);
  if (index > 0) {
    return (
      sourceCode.slice(0, args[index - 1].end) + sourceCode.slice(argument.end)
    );
  }
  if (index === 0 && args.length > 1) {
    return (
      sourceCode.slice(0, argument.start) + sourceCode.slice(args[1].start)
    );
  }
  return sourceCode.slice(0, argument.start) + sourceCode.slice(argument.end);
}

export function isRepeatedFieldPath(
  fieldPath: string | null | undefined,
): fieldPath is string {
  return Boolean(
    fieldPath && fieldPath.split(".").some((segment) => /^\d+$/.test(segment)),
  );
}

export function canPatchThemeInstanceStyleClasses(
  sourceCode: string,
  elementName: string,
  target: ThemeInstanceStyleTarget,
): boolean {
  if (!safeTarget(target)) return false;
  try {
    const location = locateClassName(sourceCode, elementName);
    return Boolean(
      location &&
      findRepeaterItemVariable(location.ast, location.opening) &&
      (!location.attribute ||
        location.staticClassName !== null ||
        isStaticCnCall(location.cnCall)),
    );
  } catch {
    return false;
  }
}

export function readThemeInstanceStyleClasses(
  sourceCode: string,
  target: ThemeInstanceStyleTarget,
  elementName: string,
): string | null {
  if (!safeTarget(target)) return null;
  try {
    const mapped = readMapEntry(sourceCode, target, elementName);
    if (mapped !== null) return mapped;
    const location = locateClassName(sourceCode, elementName);
    if (!location?.cnCall) return null;
    const argument = cnManagedArgument(location.cnCall, target);
    const classes = argument ? scopedTokens(argument.value, target) : [];
    return classes.length > 0 ? classes.join(" ") : null;
  } catch {
    return null;
  }
}

export function readThemeElementBaseClasses(
  sourceCode: string,
  elementName: string,
): string | null {
  try {
    const location = locateClassName(sourceCode, elementName);
    if (!location) return null;
    if (
      location.attribute &&
      location.staticClassName === null &&
      (!location.cnCall || !isStaticCnCall(location.cnCall))
    ) {
      return null;
    }
    return baseClasses(location);
  } catch {
    return null;
  }
}

export type PatchThemeInstanceStyleResult =
  | { editable: true; code: string }
  | {
      editable: false;
      code: string;
      reason:
        | "unsafe-class-list"
        | "unsafe-target"
        | "parse-error"
        | "not-found"
        | "dynamic-classname";
    };

export function patchThemeInstanceStyleClasses(
  sourceCode: string,
  target: ThemeInstanceStyleTarget,
  elementName: string,
  updater: (previousClasses: string) => string,
): PatchThemeInstanceStyleResult {
  if (!safeTarget(target) || !target.itemId) {
    return { editable: false, code: sourceCode, reason: "unsafe-target" };
  }

  let location: LocatedClassName | null;
  try {
    location = locateClassName(sourceCode, elementName);
  } catch {
    return { editable: false, code: sourceCode, reason: "parse-error" };
  }
  if (!location) {
    return { editable: false, code: sourceCode, reason: "not-found" };
  }
  if (
    location.attribute &&
    location.staticClassName === null &&
    (!location.cnCall || !isStaticCnCall(location.cnCall))
  ) {
    return { editable: false, code: sourceCode, reason: "dynamic-classname" };
  }

  const mapped = readMapEntry(sourceCode, target, elementName);
  const legacyArgument = location.cnCall
    ? cnManagedArgument(location.cnCall, target)
    : null;
  const previous =
    mapped ??
    (legacyArgument
      ? scopedTokens(legacyArgument.value, target).join(" ")
      : baseClasses(location));
  const next = updater(previous).trim().replace(/\s+/g, " ");
  if (
    next.length > 20_000 ||
    next.includes("/*") ||
    next.includes("*/") ||
    /[{};\r\n]/.test(next)
  ) {
    return { editable: false, code: sourceCode, reason: "unsafe-class-list" };
  }

  let code = sourceCode;
  if (legacyArgument && location.cnCall) {
    code = removeArgument(code, location.cnCall, legacyArgument);
  }
  code = ensureCnImport(code);
  code = ensureInstanceClassMap(code);
  code = ensureRepeatedItemIdType(code);
  const withLookup = ensureLookupArgument(code, elementName);
  if (withLookup === null) {
    return { editable: false, code: sourceCode, reason: "dynamic-classname" };
  }
  code = setMapEntry(withLookup, instanceKey(target, elementName)!, next);
  return { editable: true, code };
}

/**
 * Legacy CSS helpers are read/remove-only migration support. New overrides
 * must use patchThemeInstanceStyleClasses() against the component TSX.
 */
const START_MARKER_PREFIX = "/* morph-instance-style:";

function markerKey(target: ThemeInstanceStyleTarget): string {
  return `${encodeURIComponent(target.sectionId)}:${encodeURIComponent(target.fieldPath)}`;
}

function markers(target: ThemeInstanceStyleTarget) {
  const key = markerKey(target);
  return {
    start: `${START_MARKER_PREFIX}${key} */`,
    end: `/* /morph-instance-style:${key} */`,
  };
}

export function readLegacyThemeInstanceStyleClasses(
  cssSource: string,
  target: ThemeInstanceStyleTarget,
): string | null {
  const { start, end } = markers(target);
  const startIndex = cssSource.indexOf(start);
  if (startIndex < 0) return null;
  const endIndex = cssSource.indexOf(end, startIndex + start.length);
  if (endIndex < 0) return null;
  const block = cssSource.slice(startIndex + start.length, endIndex);
  return block.match(/@apply\s+([^;]+);/)?.[1]?.trim() ?? null;
}

export function removeLegacyThemeInstanceStyle(
  cssSource: string,
  target: ThemeInstanceStyleTarget,
): string {
  const { start, end } = markers(target);
  const startIndex = cssSource.indexOf(start);
  const endIndex =
    startIndex >= 0 ? cssSource.indexOf(end, startIndex + start.length) : -1;
  if (startIndex < 0 || endIndex < 0) return cssSource;
  const before = cssSource.slice(0, startIndex).trimEnd();
  const after = cssSource.slice(endIndex + end.length).trimStart();
  const result = [before, after].filter(Boolean).join("\n\n");
  return result ? `${result}\n` : "";
}

function normalizeThemePath(value: string): string {
  const segments: string[] = [];
  for (const segment of value.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
}

function resolveThemeImportPath(importerPath: string, importPath: string) {
  if (!importPath.startsWith(".")) return normalizeThemePath(importPath);
  const importerDirectory = importerPath.split("/").slice(0, -1).join("/");
  return normalizeThemePath(importerDirectory + "/" + importPath);
}

export function removeLegacyThemeInstanceStyleImport(
  cssSource: string,
  stylesheetPath: string,
  importerPath = "src/styles/global.css",
): string {
  const normalizedTarget = normalizeThemePath(stylesheetPath);
  return cssSource.replace(
    /^[ \t]*@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?\s*;?[ \t]*(?:\r?\n|$)/gm,
    (statement, importPath: string) =>
      resolveThemeImportPath(importerPath, importPath) === normalizedTarget
        ? ""
        : statement,
  );
}

export function findLegacyThemeInstanceStyleSheet<T extends ThemeSourceFile>(
  files: T[],
  componentPath?: string | null,
  target?: ThemeInstanceStyleTarget,
): T | null {
  const adjacentPath =
    componentPath && /\.[jt]sx?$/.test(componentPath)
      ? componentPath.replace(/\.[jt]sx?$/, ".morph.css")
      : null;
  const candidates = [
    adjacentPath ? files.find((file) => file.path === adjacentPath) : undefined,
    files.find((file) => file.path === "src/styles/global.css"),
  ].filter((file): file is T => Boolean(file));

  if (target) {
    return (
      candidates.find(
        (file) =>
          readLegacyThemeInstanceStyleClasses(file.content, target) !== null,
      ) ?? null
    );
  }
  return candidates[0] ?? null;
}
