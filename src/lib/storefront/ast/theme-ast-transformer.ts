import { parse } from "@babel/parser";
import type {
  JSXElement,
  JSXFragment,
  JSXOpeningElement,
  Node,
} from "@babel/types";
import { resolveElementMeta } from "./element-target";

/**
 * Morph Theme Component AST Transformer & Parser
 *
 * Built with universal @babel/parser (100% compatible with Cloudflare Workers,
 * Browser, and SSR runtimes without Node.js globals).
 */

export type SourceLocation = {
  line: number;
  column: number;
};

export type ComponentElementMeta = {
  nodeId?: string;
  elementName: string;
  tag: string;
  className: string;
  isSelfClosing: boolean;
  location: SourceLocation;
  startOffset: number;
  endOffset: number;
  openingStartOffset: number;
  openingEndOffset: number;
  classNameOffsets?: {
    start: number;
    end: number;
    isExpression: boolean;
  };
};

export type ParsedComponentMeta = {
  defaultProps: Record<string, string>;
  elements: Record<string, ComponentElementMeta>;
  nodeMap: Record<string, ComponentElementMeta>;
  /** Every element keyed by `"line:column"` of its opening tag. */
  locationMap: Record<string, ComponentElementMeta>;
  instanceClasses: Record<string, string>;
  parseOk: boolean;
  diagnostics: string[];
};

const MORPH_INSTANCE_CLASS_MAP = "morphInstanceClasses";

const MAX_THEME_MANIFEST_BYTES = 256 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMorphInstanceClassLookup(argument: Node): boolean {
  let node = argument;
  while (
    node?.type === "OptionalMemberExpression" ||
    node?.type === "MemberExpression"
  ) {
    if (node.object?.type === "Identifier") {
      return node.object.name === MORPH_INSTANCE_CLASS_MAP;
    }
    node = node.object;
  }
  return false;
}

function readStaticCnClassName(expression: Node): string | null {
  if (
    expression?.type !== "CallExpression" ||
    expression.callee?.type !== "Identifier" ||
    expression.callee.name !== "cn" ||
    !expression.arguments.every(
      (argument) =>
        argument.type === "StringLiteral" ||
        isMorphInstanceClassLookup(argument),
    )
  ) {
    return null;
  }

  return expression.arguments
    .filter((argument) => argument.type === "StringLiteral")
    .map((argument) => argument.value.trim())
    .filter(Boolean)
    .join(" ");
}

function readStaticClassNameExpression(expression: Node): string | null {
  const cnClassName = readStaticCnClassName(expression);
  if (cnClassName !== null) return cnClassName;

  if (
    expression?.type === "LogicalExpression" &&
    expression.operator === "??" &&
    isMorphInstanceClassLookup(expression.left) &&
    expression.right?.type === "StringLiteral"
  ) {
    return expression.right.value;
  }

  return null;
}

/**
 * Resolves actual component file path from section type and optional componentRef
 * using morph.theme.json manifest or convention-based verification against existing workspace files.
 * Returns null if the section has no dedicated source file (CMS-only).
 */
export function getComponentFilePath(
  type: string,
  themeFiles?: Array<{ path: string; content?: string }>,
  componentRef?: string,
): string | null {
  const normalizedType = type.toLowerCase().trim();
  const strippedType = normalizedType.replace(/-/g, "");

  // 1. Check morph.theme.json manifest if available
  if (themeFiles) {
    const directComponentRefPath = componentRef?.replace(/\\/g, "/");
    if (
      directComponentRefPath?.startsWith("src/") &&
      themeFiles.some((file) => file.path === directComponentRefPath)
    ) {
      return directComponentRefPath;
    }
    const manifestFile = themeFiles.find((f) => f.path === "morph.theme.json");
    if (manifestFile && manifestFile.content) {
      try {
        const manifest = JSON.parse(manifestFile.content);

        // A. If componentRef is specified e.g. "hero.editorial", check manifest.components[componentRef]
        if (
          componentRef &&
          manifest.components &&
          typeof manifest.components === "object"
        ) {
          const compConfig = manifest.components[componentRef];
          const sourcePath =
            typeof compConfig === "string"
              ? compConfig
              : (compConfig?.source ?? compConfig?.path);
          if (sourcePath && themeFiles.some((f) => f.path === sourcePath)) {
            return sourcePath;
          }
        }

        // B. Check structured `manifest.sections` object mapping
        if (manifest.sections && typeof manifest.sections === "object") {
          const sectionConfig =
            manifest.sections[normalizedType] ??
            manifest.sections[strippedType];
          const sourcePath =
            typeof sectionConfig === "string"
              ? sectionConfig
              : (sectionConfig?.source ?? sectionConfig?.path);
          if (sourcePath && themeFiles.some((f) => f.path === sourcePath)) {
            return sourcePath;
          }
        }

        // C. Check `manifest.components` array
        if (Array.isArray(manifest.components)) {
          const match = manifest.components.find(
            (c: {
              name: string;
              path?: string;
              source?: string;
              id?: string;
            }) => {
              if (
                componentRef &&
                (c.id === componentRef || c.name === componentRef)
              ) {
                return true;
              }
              const name = (c.name || "").toLowerCase().replace(/-/g, "");
              return name === strippedType || name === normalizedType;
            },
          );
          const sourcePath = match?.path ?? match?.source;
          if (sourcePath && themeFiles.some((f) => f.path === sourcePath)) {
            return sourcePath;
          }
        }
      } catch {}
    }
  }

  // 2. Standard convention check against existing theme files
  if (strippedType === "hero") {
    const candidate = "src/components/Hero.tsx";
    if (themeFiles ? themeFiles.some((f) => f.path === candidate) : true) {
      return candidate;
    }
  }
  if (strippedType === "header") {
    const candidate = "src/components/Header.tsx";
    if (themeFiles ? themeFiles.some((f) => f.path === candidate) : true) {
      return candidate;
    }
  }
  if (strippedType === "footer") {
    const candidate = "src/components/Footer.tsx";
    if (themeFiles ? themeFiles.some((f) => f.path === candidate) : true) {
      return candidate;
    }
  }

  // 3. Check if a component file named directly after the section type exists in src/components/
  if (themeFiles) {
    const pascalName = normalizedType
      .split("-")
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join("");
    const directCandidate = `src/components/${pascalName}.tsx`;
    if (themeFiles.some((f) => f.path === directCandidate)) {
      return directCandidate;
    }
  }

  return null;
}

/**
 * Resolves the optional Theme Workspace page shell used to wrap the versioned
 * Template Document. The explicit manifest capability prevents an older entry
 * file that hard-codes sections from silently replacing stored document
 * assembly in Live Preview.
 */
export function getThemeDocumentLayoutFilePath(
  themeFiles?: Array<{ path: string; content?: string }>,
): string | null {
  if (!themeFiles) return null;
  const manifestFile = themeFiles.find(
    (file) => file.path === "morph.theme.json",
  );
  if (
    !manifestFile?.content ||
    manifestFile.content.length > MAX_THEME_MANIFEST_BYTES
  ) {
    return null;
  }

  try {
    const manifest: unknown = JSON.parse(manifestFile.content);
    if (!isRecord(manifest) || !isRecord(manifest.documentLayout)) return null;
    const source = manifest.documentLayout.source;
    if (typeof source !== "string" || !source.trim()) return null;
    return themeFiles.some((file) => file.path === source) ? source : null;
  } catch {
    return null;
  }
}

function parseAst(sourceCode: string) {
  return parse(sourceCode, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });
}

function isAstNode(value: unknown): value is Node {
  return isRecord(value) && typeof value.type === "string";
}

function walk(node: unknown, visitor: (node: Node) => void) {
  if (!isAstNode(node)) return;
  visitor(node);

  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "comments" || key === "openingElement")
      continue;
    if (Array.isArray(value)) {
      for (const child of value) {
        walk(child, visitor);
      }
    } else if (value && typeof value === "object") {
      walk(value, visitor);
    }
  }
}

/**
 * Parses a TSX component source and extracts default props, morph elements, and diagnostics.
 */
type ParsedComponentSourceCacheEntry = {
  sourceCode: string;
  parsed: ParsedComponentMeta;
};

const parsedComponentSourceCache = new Map<
  string,
  ParsedComponentSourceCacheEntry
>();
const MAX_PARSED_COMPONENT_SOURCE_CACHE_ENTRIES = 100;

export function parseComponentSource(
  sourceCode: string,
  sourceIdentity = "",
): ParsedComponentMeta {
  // Selection changes are high-frequency, while the source file usually stays
  // unchanged. Keep only the latest derived result for each source identity so
  // repeated edits cannot retain every historical source string and AST.
  const cached = sourceIdentity
    ? parsedComponentSourceCache.get(sourceIdentity)
    : undefined;
  if (cached?.sourceCode === sourceCode) return cached.parsed;

  const defaultProps: Record<string, string> = {};
  const elements: Record<string, ComponentElementMeta> = {};
  const nodeMap: Record<string, ComponentElementMeta> = {};
  const locationMap: Record<string, ComponentElementMeta> = {};
  const instanceClasses: Record<string, string> = {};
  let parseOk = true;
  const diagnostics: string[] = [];

  try {
    const ast = parseAst(sourceCode);

    walk(ast, (node) => {
      if (
        node.type === "VariableDeclarator" &&
        node.id?.type === "Identifier" &&
        node.id.name === MORPH_INSTANCE_CLASS_MAP &&
        node.init?.type === "ObjectExpression"
      ) {
        for (const property of node.init.properties ?? []) {
          if (
            property.type === "ObjectProperty" &&
            property.key?.type === "StringLiteral" &&
            property.value?.type === "StringLiteral"
          ) {
            instanceClasses[property.key.value] = property.value.value;
          }
        }
      }

      // 1. Extract default props from parameter destructuring (AssignmentPattern)
      if (
        node.type === "AssignmentPattern" &&
        node.left?.type === "Identifier"
      ) {
        const propName = node.left.name;
        if (node.right?.type === "StringLiteral") {
          defaultProps[propName] = node.right.value;
        } else if (
          node.right?.type === "TemplateLiteral" &&
          node.right.quasis?.length === 1 &&
          node.right.expressions?.length === 0
        ) {
          defaultProps[propName] = node.right.quasis[0].value.raw;
        }
      }

      // 2. Extract JSX element with data-morph-element or data-morph-node
      let openingElement: JSXOpeningElement | null = null;
      let elementStart = 0;
      let elementEnd = 0;
      let openingStart = 0;
      let openingEnd = 0;

      if (node.type === "JSXElement") {
        openingElement = node.openingElement;
        elementStart = node.start ?? 0;
        elementEnd = node.end ?? 0;
        openingStart = node.openingElement?.start ?? 0;
        openingEnd = node.openingElement?.end ?? 0;
      }

      if (openingElement && openingElement.attributes) {
        let morphNodeId: string | null = null;
        let morphElementName: string | null = null;
        let className = "";
        let classNameOffsets:
          { start: number; end: number; isExpression: boolean } | undefined;

        for (const attr of openingElement.attributes) {
          if (
            attr.type === "JSXAttribute" &&
            attr.name?.type === "JSXIdentifier"
          ) {
            const attrName = attr.name.name;

            if (attrName === "data-morph-node" && attr.value) {
              if (attr.value.type === "StringLiteral") {
                morphNodeId = attr.value.value;
              } else if (
                attr.value.type === "JSXExpressionContainer" &&
                attr.value.expression?.type === "StringLiteral"
              ) {
                morphNodeId = attr.value.expression.value;
              }
            } else if (attrName === "data-morph-element" && attr.value) {
              if (attr.value.type === "StringLiteral") {
                morphElementName = attr.value.value;
              } else if (
                attr.value.type === "JSXExpressionContainer" &&
                attr.value.expression?.type === "StringLiteral"
              ) {
                morphElementName = attr.value.expression.value;
              }
            } else if (
              attrName === "data-morph-section" &&
              !morphElementName &&
              attr.value
            ) {
              morphElementName = "section";
            }

            if (attrName === "className" && attr.value) {
              if (attr.value.type === "StringLiteral") {
                className = attr.value.value;
                classNameOffsets = {
                  start: attr.value.start ?? 0,
                  end: attr.value.end ?? 0,
                  isExpression: false,
                };
              } else if (attr.value.type === "JSXExpressionContainer") {
                className =
                  readStaticClassNameExpression(attr.value.expression) ??
                  sourceCode.slice(attr.value.start ?? 0, attr.value.end ?? 0);
                classNameOffsets = {
                  start: attr.value.start ?? 0,
                  end: attr.value.end ?? 0,
                  isExpression: true,
                };
              }
            }
          }
        }

        const isSelfClosing = Boolean(
          openingElement.selfClosing ||
          (node.type === "JSXElement" && node.openingElement.selfClosing),
        );

        const primaryKey = morphNodeId || morphElementName;

        {
          let tagName = "div";
          if (openingElement.name?.type === "JSXIdentifier") {
            tagName = openingElement.name.name;
          }

          // Same convention the Live preview emits, so a selection made by
          // source position resolves to exactly this element.
          const line = openingElement.loc?.start?.line ?? 1;
          const column = (openingElement.loc?.start?.column ?? 0) + 1;
          const locationKey = `${line}:${column}`;

          const meta: ComponentElementMeta = {
            nodeId: morphNodeId ?? undefined,
            elementName: morphElementName ?? primaryKey ?? locationKey,
            tag: tagName,
            className,
            isSelfClosing,
            location: {
              line,
              column,
            },
            startOffset: elementStart,
            endOffset: elementEnd,
            openingStartOffset: openingStart,
            openingEndOffset: openingEnd,
            classNameOffsets,
          };

          // Every element is indexed by position, so an element the author
          // never marked is still editable. Authored markers stay authoritative
          // because a position shifts whenever the file above it is edited.
          if (!locationMap[locationKey]) {
            locationMap[locationKey] = meta;
          }

          if (morphElementName) {
            if (!elements[morphElementName]) {
              elements[morphElementName] = meta;
            } else {
              diagnostics.push(
                `Duplicate data-morph-element "${morphElementName}" requires a unique data-morph-node for precise editing.`,
              );
            }
          }
          if (morphNodeId) {
            if (nodeMap[morphNodeId]) {
              parseOk = false;
              diagnostics.push(
                `Duplicate data-morph-node "${morphNodeId}" detected. Node IDs must be unique within a source file.`,
              );
            } else {
              elements[morphNodeId] = meta;
              nodeMap[morphNodeId] = meta;
            }
          }
        }
      }
    });
  } catch (err) {
    parseOk = false;
    diagnostics.push(
      err instanceof Error ? err.message : "Syntax error parsing TSX",
    );
  }

  const parsed = {
    defaultProps,
    elements,
    nodeMap,
    locationMap,
    instanceClasses,
    parseOk,
    diagnostics,
  };

  if (sourceIdentity) {
    parsedComponentSourceCache.set(sourceIdentity, { sourceCode, parsed });
    if (
      parsedComponentSourceCache.size >
      MAX_PARSED_COMPONENT_SOURCE_CACHE_ENTRIES
    ) {
      const oldestKey = parsedComponentSourceCache.keys().next().value;
      if (oldestKey) parsedComponentSourceCache.delete(oldestKey);
    }
  }

  return parsed;
}

/**
 * Patches a default prop string literal inside component source code using precise AST node offsets.
 */
export function patchComponentDefaultProp(
  sourceCode: string,
  propName: string,
  newValue: string,
  componentName?: string,
): string {
  try {
    const ast = parseAst(sourceCode);
    let targetNode: Node | null = null;

    walk(ast, (node) => {
      if (targetNode) return;

      let isMatchingComponent = true;
      if (componentName) {
        if (node.type === "FunctionDeclaration") {
          isMatchingComponent = node.id?.name === componentName;
        } else if (node.type === "ExportDefaultDeclaration") {
          const decl = node.declaration;
          if (
            (decl.type === "FunctionDeclaration" ||
              decl.type === "ClassDeclaration") &&
            decl.id?.type === "Identifier"
          ) {
            isMatchingComponent = decl.id.name === componentName;
          } else {
            isMatchingComponent = componentName === "default" || !componentName;
          }
        } else {
          isMatchingComponent = false;
        }
      }

      if (
        (node.type === "FunctionDeclaration" ||
          node.type === "ExportDefaultDeclaration" ||
          node.type === "ArrowFunctionExpression" ||
          node.type === "FunctionExpression") &&
        isMatchingComponent
      ) {
        const fn =
          node.type === "ExportDefaultDeclaration" ? node.declaration : node;
        if (
          (fn.type === "FunctionDeclaration" ||
            fn.type === "ArrowFunctionExpression" ||
            fn.type === "FunctionExpression") &&
          Array.isArray(fn.params)
        ) {
          for (const param of fn.params) {
            if (
              param.type === "ObjectPattern" &&
              Array.isArray(param.properties)
            ) {
              for (const prop of param.properties) {
                if (
                  prop.type === "ObjectProperty" &&
                  prop.value?.type === "AssignmentPattern" &&
                  prop.value.left?.type === "Identifier" &&
                  prop.value.left.name === propName &&
                  prop.value.right
                ) {
                  targetNode = prop.value.right;
                  return;
                }
              }
            }
          }
        }
      }

      if (
        !componentName &&
        !targetNode &&
        node.type === "AssignmentPattern" &&
        node.left?.type === "Identifier" &&
        node.left.name === propName &&
        node.right
      ) {
        targetNode = node.right;
      }
    });

    const resolvedTargetNode = targetNode as Node | null;
    if (
      resolvedTargetNode &&
      typeof resolvedTargetNode.start === "number" &&
      typeof resolvedTargetNode.end === "number"
    ) {
      const replacement = JSON.stringify(newValue);
      return (
        sourceCode.slice(0, resolvedTargetNode.start) +
        replacement +
        sourceCode.slice(resolvedTargetNode.end)
      );
    }
  } catch {}

  return sourceCode;
}

export type PatchClassNameResult = {
  code: string;
  editable: boolean;
  reason?: "not-found" | "dynamic-classname" | "parse-error";
};

export type SwapSiblingMorphNodesResult = {
  code: string;
  editable: boolean;
  reason?: "parse-error" | "not-found" | "not-siblings" | "same-node";
};

export type RemoveJsxElementResult = {
  code: string;
  editable: boolean;
  reason?: "parse-error" | "not-found" | "not-direct-child";
};

/**
 * `line:column` of a JSX element's opening tag.
 *
 * Same convention `locationMap` and the Live preview's `data-morph-loc` use, so
 * an element the author never marked is still addressable.
 */
function jsxElementLocationKey(node: JSXElement): string | null {
  const opening = node.openingElement;
  const line = opening?.loc?.start?.line;
  if (typeof line !== "number") return null;
  return `${line}:${(opening.loc?.start.column ?? 0) + 1}`;
}

/**
 * Whether a JSX element is the one a reorder target names.
 *
 * Accepts either an authored `data-morph-node` or a source position, in that
 * order: a marker survives edits above it, a position does not, so the marker
 * has to win wherever both exist.
 */
function jsxElementMatchesTargetKey(
  node: JSXElement,
  targetKey: string,
): boolean {
  if (staticMorphNodeId(node) === targetKey) return true;
  return jsxElementLocationKey(node) === targetKey;
}

function walkWithParent(
  node: unknown,
  parent: Node | null,
  visitor: (node: Node, parent: Node | null) => void,
) {
  if (!isAstNode(node)) return;
  visitor(node, parent);

  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "comments" || key === "openingElement") {
      continue;
    }
    if (Array.isArray(value)) {
      for (const child of value) walkWithParent(child, node, visitor);
    } else if (value && typeof value === "object") {
      walkWithParent(value, node, visitor);
    }
  }
}

function staticMorphNodeIdForDeletion(node: JSXElement): string | null {
  const openingElement = node.openingElement;

  for (const attribute of openingElement.attributes ?? []) {
    if (
      attribute.type !== "JSXAttribute" ||
      attribute.name?.type !== "JSXIdentifier" ||
      attribute.name.name !== "data-morph-node"
    ) {
      continue;
    }
    if (attribute.value?.type === "StringLiteral") {
      return attribute.value.value;
    }
    if (
      attribute.value?.type === "JSXExpressionContainer" &&
      attribute.value.expression?.type === "StringLiteral"
    ) {
      return attribute.value.expression.value;
    }
  }
  return null;
}

function jsxElementMatchesDeletionTarget(node: JSXElement, targetKey: string) {
  return (
    staticMorphNodeIdForDeletion(node) === targetKey ||
    jsxElementLocationKey(node) === targetKey
  );
}

function staticMorphNodeId(node: JSXElement): string | null {
  for (const attribute of node.openingElement.attributes) {
    if (
      attribute.type !== "JSXAttribute" ||
      attribute.name?.type !== "JSXIdentifier" ||
      attribute.name.name !== "data-morph-node"
    ) {
      continue;
    }
    if (attribute.value?.type === "StringLiteral") {
      return attribute.value.value;
    }
    if (
      attribute.value?.type === "JSXExpressionContainer" &&
      attribute.value.expression?.type === "StringLiteral"
    ) {
      return attribute.value.expression.value;
    }
  }
  return null;
}

/**
 * Swaps two statically-addressable JSX siblings without reformatting the rest
 * of the source file. Runtime DOM order is never used as source of truth: the
 * transformer succeeds only when both targets resolve to exactly one direct
 * child of the same JSX parent in the parsed TSX source.
 *
 * Each target is an authored `data-morph-node` or a `line:column` position, so
 * a component that carries no markers at all can still be reordered.
 */
export function swapSiblingMorphNodes(
  sourceCode: string,
  firstNodeId: string,
  secondNodeId: string,
): SwapSiblingMorphNodesResult {
  if (firstNodeId === secondNodeId) {
    return { code: sourceCode, editable: false, reason: "same-node" };
  }

  try {
    const ast = parseAst(sourceCode);
    let firstMatchCount = 0;
    let secondMatchCount = 0;
    let siblingPair: { first: JSXElement; second: JSXElement } | null = null;

    walk(ast, (node) => {
      if (node.type !== "JSXElement" || !Array.isArray(node.children)) return;

      let first: JSXElement | null = null;
      let second: JSXElement | null = null;
      for (const child of node.children) {
        if (child?.type !== "JSXElement") continue;
        if (jsxElementMatchesTargetKey(child, firstNodeId)) {
          firstMatchCount += 1;
          first = child;
        }
        if (jsxElementMatchesTargetKey(child, secondNodeId)) {
          secondMatchCount += 1;
          second = child;
        }
      }
      if (first && second) siblingPair = { first, second };
    });

    if (firstMatchCount !== 1 || secondMatchCount !== 1) {
      return { code: sourceCode, editable: false, reason: "not-found" };
    }
    const resolvedSiblingPair = siblingPair as {
      first: JSXElement;
      second: JSXElement;
    } | null;
    if (!resolvedSiblingPair) {
      return { code: sourceCode, editable: false, reason: "not-siblings" };
    }

    const { first, second } = resolvedSiblingPair;
    const firstStart = first.start ?? -1;
    const firstEnd = first.end ?? -1;
    const secondStart = second.start ?? -1;
    const secondEnd = second.end ?? -1;
    if (
      firstStart < 0 ||
      firstEnd <= firstStart ||
      secondStart < 0 ||
      secondEnd <= secondStart
    ) {
      return { code: sourceCode, editable: false, reason: "not-found" };
    }

    const earlier =
      firstStart < secondStart
        ? { start: firstStart, end: firstEnd }
        : { start: secondStart, end: secondEnd };
    const later =
      firstStart < secondStart
        ? { start: secondStart, end: secondEnd }
        : { start: firstStart, end: firstEnd };
    const earlierSource = sourceCode.slice(earlier.start, earlier.end);
    const laterSource = sourceCode.slice(later.start, later.end);

    return {
      code:
        sourceCode.slice(0, earlier.start) +
        laterSource +
        sourceCode.slice(earlier.end, later.start) +
        earlierSource +
        sourceCode.slice(later.end),
      editable: true,
    };
  } catch {
    return { code: sourceCode, editable: false, reason: "parse-error" };
  }
}

/**
 * Removes one statically-addressable JSX child without reformatting the rest
 * of the source file. Deletion is intentionally limited to an element that is
 * a direct child of a JSX element/fragment; removing an expression such as
 * `condition && <Thing />` would otherwise leave invalid TSX behind.
 */
export function removeJsxElement(
  sourceCode: string,
  targetKey: string,
): RemoveJsxElementResult {
  if (!targetKey.trim()) {
    return { code: sourceCode, editable: false, reason: "not-found" };
  }

  try {
    const ast = parseAst(sourceCode);
    const matches: Array<{
      node: JSXElement;
      parent: JSXElement | JSXFragment | null;
    }> = [];

    walkWithParent(ast, null, (node, parent) => {
      if (
        node.type === "JSXElement" &&
        jsxElementMatchesDeletionTarget(node, targetKey)
      ) {
        matches.push({
          node,
          parent:
            parent?.type === "JSXElement" || parent?.type === "JSXFragment"
              ? parent
              : null,
        });
      }
    });

    if (matches.length !== 1) {
      return { code: sourceCode, editable: false, reason: "not-found" };
    }

    const { node, parent } = matches[0];
    if (
      !parent ||
      (parent.type !== "JSXElement" && parent.type !== "JSXFragment") ||
      !Array.isArray(parent.children) ||
      !parent.children.includes(node)
    ) {
      return {
        code: sourceCode,
        editable: false,
        reason: "not-direct-child",
      };
    }

    const start = node.start;
    const end = node.end;
    if (
      typeof start !== "number" ||
      typeof end !== "number" ||
      start < 0 ||
      end <= start
    ) {
      return { code: sourceCode, editable: false, reason: "not-found" };
    }

    return {
      code: sourceCode.slice(0, start) + sourceCode.slice(end),
      editable: true,
    };
  } catch {
    return { code: sourceCode, editable: false, reason: "parse-error" };
  }
}

/**
 * Patches the className of a specific morph element in component source code using exact AST node offsets.
 */
export function patchElementClassNameResult(
  sourceCode: string,
  elementName: string,
  updater: (prevClasses: string) => string,
): PatchClassNameResult {
  const parsed = parseComponentSource(sourceCode);
  if (!parsed.parseOk) {
    return { code: sourceCode, editable: false, reason: "parse-error" };
  }

  const element = resolveElementMeta(parsed, elementName);
  if (!element) {
    return { code: sourceCode, editable: false, reason: "not-found" };
  }

  if (element.classNameOffsets?.isExpression) {
    return { code: sourceCode, editable: false, reason: "dynamic-classname" };
  }

  if (element.classNameOffsets && !element.classNameOffsets.isExpression) {
    const { start, end } = element.classNameOffsets;
    const nextClasses = updater(element.className);
    const replacement = JSON.stringify(nextClasses);
    return {
      code: sourceCode.slice(0, start) + replacement + sourceCode.slice(end),
      editable: true,
    };
  }

  // If element has no className attribute yet, insert one before tag close (> or />)
  let insertPos = 0;
  if (element.isSelfClosing) {
    const slashIdx = sourceCode.lastIndexOf("/", element.openingEndOffset);
    insertPos = slashIdx !== -1 ? slashIdx : element.openingEndOffset - 2;
  } else {
    const closeIdx = sourceCode.lastIndexOf(">", element.openingEndOffset);
    insertPos = closeIdx !== -1 ? closeIdx : element.openingEndOffset - 1;
  }

  if (insertPos > 0) {
    const nextClasses = updater("");
    return {
      code:
        sourceCode.slice(0, insertPos) +
        ` className=${JSON.stringify(nextClasses)} ` +
        sourceCode.slice(insertPos),
      editable: true,
    };
  }

  return { code: sourceCode, editable: true };
}

export function patchElementClassName(
  sourceCode: string,
  elementName: string,
  updater: (prevClasses: string) => string,
): string {
  return patchElementClassNameResult(sourceCode, elementName, updater).code;
}

/**
 * Finds the exact line and column of a morph element in component source code.
 */
export function findSourceLocation(
  sourceCode: string,
  elementName: string,
): { line: number; column: number } | null {
  const parsed = parseComponentSource(sourceCode);
  const element = parsed.elements[elementName];
  if (element) {
    return element.location;
  }
  return null;
}

/**
 * Replaces or adds a Tailwind class matching a specific prefix or regex.
 */
export function updateTailwindClass(
  currentClasses: string,
  matcher: string | RegExp,
  newClass: string,
): string {
  const tokens = currentClasses.split(/\s+/).filter(Boolean);
  const filtered = tokens.filter((t) => {
    if (typeof matcher === "string") {
      return !t.startsWith(matcher);
    }
    return !matcher.test(t);
  });
  if (newClass) {
    filtered.push(newClass);
  }
  return filtered.join(" ");
}

const TAILWIND_FONT_SIZE_MAP: Record<string, number> = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
  "5xl": 48,
  "6xl": 60,
  "7xl": 72,
  "8xl": 96,
  "9xl": 128,
};

export type TailwindFontSizeResult =
  | { type: "exact"; value: number }
  | { type: "complex"; raw: string }
  | { type: "none" };

/**
 * Detailed parser for font size from Tailwind className string, supporting complex clamp()/calc() expressions.
 */
export function parseTailwindFontSizeDetailed(
  className?: string,
): TailwindFontSizeResult {
  if (!className) return { type: "none" };

  // Check complex arbitrary expressions first e.g. text-[clamp(3.25rem,7vw,7rem)]
  const complexMatch = className.match(
    /\btext-\[(clamp\(.+?\)|calc\(.+?\)|min\(.+?\)|max\(.+?\))\]/,
  );
  if (complexMatch) {
    return { type: "complex", raw: complexMatch[1] };
  }

  // Check exact pixel values e.g. text-[100px] or text-[64]
  const arbitraryMatch = className.match(/\btext-\[(\d+)(?:px)?\]/);
  if (arbitraryMatch) {
    return { type: "exact", value: parseInt(arbitraryMatch[1], 10) };
  }

  // Check standard token scale e.g. text-6xl
  const tokenMatch = className.match(
    /\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/,
  );
  if (tokenMatch && TAILWIND_FONT_SIZE_MAP[tokenMatch[1]]) {
    return { type: "exact", value: TAILWIND_FONT_SIZE_MAP[tokenMatch[1]] };
  }

  return { type: "none" };
}

/**
 * Parses font size in pixels from Tailwind className string. Returns null if missing or complex.
 */
export function parseTailwindFontSize(className?: string): number | null {
  const res = parseTailwindFontSizeDetailed(className);
  return res.type === "exact" ? res.value : null;
}

/**
 * Parses font family from Tailwind className string.
 */
export function parseTailwindFontFamily(className?: string): string | null {
  if (!className) return null;
  const match = className.match(/\bfont-(serif|sans|mono)\b/);
  return match ? match[1] : null;
}

/**
 * Parses font weight from Tailwind className string.
 */
export function parseTailwindFontWeight(className?: string): string | null {
  if (!className) return null;
  const match = className.match(/\bfont-(light|normal|medium|semibold|bold)\b/);
  if (!match) return null;
  switch (match[1]) {
    case "light":
      return "300";
    case "normal":
      return "normal";
    case "medium":
      return "medium";
    case "semibold":
    case "bold":
      return "bold";
    default:
      return null;
  }
}

/**
 * Parses text alignment from Tailwind className string.
 */
export function parseTailwindTextAlign(
  className?: string,
): "left" | "center" | "right" | null {
  if (!className) return null;
  const match = className.match(/\btext-(left|center|right)\b/);
  return match ? (match[1] as "left" | "center" | "right") : null;
}

/**
 * Parses line height multiplier from Tailwind className string.
 */
export function parseTailwindLineHeight(className?: string): number | null {
  if (!className) return null;
  const arbitraryMatch = className.match(/\bleading-\[(\d+(?:\.\d+)?)\]/);
  if (arbitraryMatch) {
    return parseFloat(arbitraryMatch[1]);
  }
  const tokenMatch = className.match(
    /\bleading-(none|tight|snug|normal|relaxed|loose)\b/,
  );
  if (tokenMatch) {
    switch (tokenMatch[1]) {
      case "none":
        return 1;
      case "tight":
        return 1.25;
      case "snug":
        return 1.375;
      case "normal":
        return 1.5;
      case "relaxed":
        return 1.625;
      case "loose":
        return 2;
    }
  }
  return null;
}

const TAILWIND_SPACING_SCALE: Record<string, number> = {
  "0": 0,
  "1": 4,
  "2": 8,
  "3": 12,
  "4": 16,
  "5": 20,
  "6": 24,
  "8": 32,
  "10": 40,
  "12": 48,
  "16": 64,
  "20": 80,
  "24": 96,
  "32": 128,
};

/**
 * Parses padding values in pixels from Tailwind className string.
 */
export function parseTailwindPadding(className?: string): {
  all?: number;
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  x?: number;
  y?: number;
} {
  if (!className) return {};
  const res: {
    all?: number;
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
    x?: number;
    y?: number;
  } = {};

  const allMatch = className.match(/\bp-\[(\d+)(?:px)?\]/);
  if (allMatch) res.all = parseInt(allMatch[1], 10);
  else {
    const token = className.match(/\bp-(\d+)\b/);
    if (token && TAILWIND_SPACING_SCALE[token[1]] !== undefined) {
      res.all = TAILWIND_SPACING_SCALE[token[1]];
    }
  }

  const yMatch = className.match(/\bpy-\[(\d+)(?:px)?\]/);
  if (yMatch) res.y = parseInt(yMatch[1], 10);
  else {
    const token = className.match(/\bpy-(\d+)\b/);
    if (token && TAILWIND_SPACING_SCALE[token[1]] !== undefined) {
      res.y = TAILWIND_SPACING_SCALE[token[1]];
    }
  }

  const xMatch = className.match(/\bpx-\[(\d+)(?:px)?\]/);
  if (xMatch) res.x = parseInt(xMatch[1], 10);
  else {
    const token = className.match(/\bpx-(\d+)\b/);
    if (token && TAILWIND_SPACING_SCALE[token[1]] !== undefined) {
      res.x = TAILWIND_SPACING_SCALE[token[1]];
    }
  }

  const topMatch = className.match(/\bpt-\[(\d+)(?:px)?\]/);
  if (topMatch) res.top = parseInt(topMatch[1], 10);

  const bottomMatch = className.match(/\bpb-\[(\d+)(?:px)?\]/);
  if (bottomMatch) res.bottom = parseInt(bottomMatch[1], 10);

  const leftMatch = className.match(/\bpl-\[(\d+)(?:px)?\]/);
  if (leftMatch) res.left = parseInt(leftMatch[1], 10);

  const rightMatch = className.match(/\bpr-\[(\d+)(?:px)?\]/);
  if (rightMatch) res.right = parseInt(rightMatch[1], 10);

  return res;
}

const TAILWIND_COLOR_MAP: Record<string, string> = {
  "bg-white": "#ffffff",
  "bg-black": "#000000",
  "bg-stone-50": "#fafaf9",
  "bg-stone-100": "#f5f5f4",
  "bg-stone-200": "#e7e5e4",
  "bg-stone-900": "#1c1917",
  "bg-stone-950": "#0c0a09",
  "bg-slate-50": "#f8fafc",
  "bg-slate-100": "#f1f5f9",
  "bg-slate-900": "#0f172a",
  "bg-zinc-50": "#fafafa",
  "bg-zinc-100": "#f4f4f5",
  "bg-zinc-900": "#18181b",
};

/**
 * Parses background color hex from Tailwind className string.
 */
export function parseTailwindBackgroundColor(
  className?: string,
): string | null {
  if (!className) return null;
  const arbitraryMatch = className.match(/\bbg-\[(#\w{3,8}|rgba?\(.+?\))\]/);
  if (arbitraryMatch) {
    return arbitraryMatch[1];
  }
  for (const [token, hex] of Object.entries(TAILWIND_COLOR_MAP)) {
    if (new RegExp(`\\b${token}\\b`).test(className)) {
      return hex;
    }
  }
  return null;
}

const TAILWIND_TEXT_COLOR_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(TAILWIND_COLOR_MAP).map(([token, color]) => [
    token.replace(/^bg-/, "text-"),
    color,
  ]),
);

/** Parses text color hex from a Tailwind className string. */
export function parseTailwindTextColor(className?: string): string | null {
  if (!className) return null;
  const arbitraryMatch = className.match(/\btext-\[(#\w{3,8}|rgba?\(.+?\))\]/);
  if (arbitraryMatch) return arbitraryMatch[1];
  for (const [token, hex] of Object.entries(TAILWIND_TEXT_COLOR_MAP)) {
    if (new RegExp("\\b" + token + "\\b").test(className)) return hex;
  }
  return null;
}

const TAILWIND_RADIUS_MAP: Record<string, number> = {
  none: 0,
  sm: 2,
  DEFAULT: 4,
  md: 6,
  lg: 8,
  xl: 12,
  "2xl": 16,
  "3xl": 24,
  full: 9999,
};

/**
 * Parses border radius in pixels from Tailwind className string.
 */
export function parseTailwindBorderRadius(className?: string): number | null {
  if (!className) return null;
  const arbitraryMatch = className.match(
    /(?:^|\s)(?:[a-z0-9-]+:)*rounded-\[(-?\d+(?:\.\d+)?)(?:px)?\](?=\s|$)/i,
  );
  if (arbitraryMatch) {
    return Number.parseFloat(arbitraryMatch[1]);
  }
  const tokenMatch = className.match(
    /(?:^|\s)(?:[a-z0-9-]+:)*rounded-(none|sm|md|lg|xl|2xl|3xl|full)(?=\s|$)/,
  );
  if (tokenMatch && TAILWIND_RADIUS_MAP[tokenMatch[1]] !== undefined) {
    return TAILWIND_RADIUS_MAP[tokenMatch[1]];
  }
  if (/(?:^|\s)(?:[a-z0-9-]+:)*rounded(?=\s|$)/.test(className)) {
    return TAILWIND_RADIUS_MAP.DEFAULT;
  }
  return null;
}

export type TailwindBorderRadii = {
  all: number | null;
  topLeft: number | null;
  topRight: number | null;
  bottomRight: number | null;
  bottomLeft: number | null;
};

function parseTailwindCornerRadius(
  className: string,
  corner: "tl" | "tr" | "br" | "bl",
): number | null {
  const arbitraryMatch = className.match(
    new RegExp(`\\brounded-${corner}-\\[(-?\\d+(?:\\.\\d+)?)(?:px)?\\]`),
  );
  if (arbitraryMatch) return Number.parseFloat(arbitraryMatch[1]);
  const tokenMatch = className.match(
    new RegExp(`\\brounded-${corner}-(none|sm|md|lg|xl|2xl|3xl|full)\\b`),
  );
  return tokenMatch && TAILWIND_RADIUS_MAP[tokenMatch[1]] !== undefined
    ? TAILWIND_RADIUS_MAP[tokenMatch[1]]
    : null;
}

export function parseTailwindBorderRadii(
  className?: string,
): TailwindBorderRadii {
  const source = className ?? "";
  const all = parseTailwindBorderRadius(source);
  return {
    all,
    topLeft: parseTailwindCornerRadius(source, "tl") ?? all,
    topRight: parseTailwindCornerRadius(source, "tr") ?? all,
    bottomRight: parseTailwindCornerRadius(source, "br") ?? all,
    bottomLeft: parseTailwindCornerRadius(source, "bl") ?? all,
  };
}

export function parseTailwindBorderWidth(className?: string): number | null {
  if (!className) return null;
  const arbitraryMatch = className.match(
    /(?:^|\s)(?:[a-z0-9-]+:)*border-\[(-?\d+(?:\.\d+)?)px\](?=\s|$)/i,
  );
  if (arbitraryMatch) return Number.parseFloat(arbitraryMatch[1]);
  const namedMatch = className.match(
    /(?:^|\s)(?:[a-z0-9-]+:)*border(?:-(0|2|4|8))?(?=\s|$)/,
  );
  if (!namedMatch) return null;
  return namedMatch[1] ? Number.parseInt(namedMatch[1], 10) : 1;
}

export function parseTailwindBorderStyle(className?: string): string | null {
  if (!className) return null;
  return (
    className.match(
      /(?:^|\s)(?:[a-z0-9-]+:)*border-(solid|dashed|dotted|double|hidden|none)(?=\s|$)/,
    )?.[1] ?? null
  );
}

const TAILWIND_BORDER_COLOR_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(TAILWIND_COLOR_MAP).map(([token, color]) => [
    token.replace(/^bg-/, "border-"),
    color,
  ]),
);

export function parseTailwindBorderColor(className?: string): string | null {
  if (!className) return null;
  const arbitraryMatch = className.match(
    /(?:^|\s)(?:[a-z0-9-]+:)*border-\[((?:#(?:[0-9a-f]{3,8})|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\(.+?\)))\](?=\s|$)/i,
  );
  if (arbitraryMatch) return arbitraryMatch[1];
  for (const [token, color] of Object.entries(TAILWIND_BORDER_COLOR_MAP)) {
    if (
      new RegExp(`(?:^|\\s)(?:[a-z0-9-]+:)*${token}(?=\\s|$)`).test(className)
    ) {
      return color;
    }
  }
  return null;
}
