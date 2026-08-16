import { parse } from "@babel/parser";

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
  elementName: string;
  tag: string;
  className: string;
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
  parseOk: boolean;
  diagnostics: string[];
};

/**
 * Resolves actual component file path from section type using morph.theme.json manifest
 * or convention-based verification against existing workspace files.
 */
export function getComponentFilePath(
  type: string,
  themeFiles?: Array<{ path: string; content?: string }>,
): string | null {
  // 1. Check morph.theme.json manifest if available
  if (themeFiles) {
    const manifestFile = themeFiles.find((f) => f.path === "morph.theme.json");
    if (manifestFile && manifestFile.content) {
      try {
        const manifest = JSON.parse(manifestFile.content);
        if (Array.isArray(manifest.components)) {
          const match = manifest.components.find(
            (c: { name: string; path: string }) =>
              c.name.toLowerCase() === type.toLowerCase().replace(/-/g, ""),
          );
          if (match && themeFiles.some((f) => f.path === match.path)) {
            return match.path;
          }
        }
      } catch {}
    }
  }

  // 2. Standard convention check against existing theme files
  const normalized = type.toLowerCase().replace(/-/g, "");
  if (normalized === "hero") {
    const candidate = "src/components/Hero.tsx";
    if (!themeFiles || themeFiles.some((f) => f.path === candidate)) {
      return candidate;
    }
  }
  if (normalized === "header") {
    const candidate = "src/components/Header.tsx";
    if (!themeFiles || themeFiles.some((f) => f.path === candidate)) {
      return candidate;
    }
  }
  if (normalized === "footer") {
    const candidate = "src/components/Footer.tsx";
    if (!themeFiles || themeFiles.some((f) => f.path === candidate)) {
      return candidate;
    }
  }

  // 3. Fallback to entry page if present in files
  const entryFile = "src/pages/index.tsx";
  if (themeFiles && themeFiles.some((f) => f.path === entryFile)) {
    return entryFile;
  }

  return null;
}

function parseAst(sourceCode: string) {
  return parse(sourceCode, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });
}

function walk(node: any, visitor: (node: any) => void) {
  if (!node || typeof node !== "object") return;
  visitor(node);

  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "comments" || key === "openingElement") continue;
    const value = node[key];
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
export function parseComponentSource(sourceCode: string): ParsedComponentMeta {
  const defaultProps: Record<string, string> = {};
  const elements: Record<string, ComponentElementMeta> = {};
  let parseOk = true;
  const diagnostics: string[] = [];

  try {
    const ast = parseAst(sourceCode);

    walk(ast, (node) => {
      // 1. Extract default props from parameter destructuring (AssignmentPattern)
      if (node.type === "AssignmentPattern" && node.left?.type === "Identifier") {
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

      // 2. Extract JSX element with data-morph-element (strictly JSXElement or JSXSelfClosingElement)
      let openingElement: any = null;
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
      } else if (node.type === "JSXSelfClosingElement") {
        openingElement = node;
        elementStart = node.start ?? 0;
        elementEnd = node.end ?? 0;
        openingStart = node.start ?? 0;
        openingEnd = node.end ?? 0;
      }

      if (openingElement && openingElement.attributes) {
        let morphElementName: string | null = null;
        let className = "";
        let classNameOffsets:
          | { start: number; end: number; isExpression: boolean }
          | undefined;

        for (const attr of openingElement.attributes) {
          if (attr.type === "JSXAttribute" && attr.name?.type === "JSXIdentifier") {
            const attrName = attr.name.name;

            if (attrName === "data-morph-element" && attr.value) {
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
                  start: attr.value.start,
                  end: attr.value.end,
                  isExpression: false,
                };
              } else if (attr.value.type === "JSXExpressionContainer") {
                className = sourceCode.slice(attr.value.start, attr.value.end);
                classNameOffsets = {
                  start: attr.value.start,
                  end: attr.value.end,
                  isExpression: true,
                };
              }
            }
          }
        }

        if (morphElementName) {
          let tagName = "div";
          if (openingElement.name?.type === "JSXIdentifier") {
            tagName = openingElement.name.name;
          }

          const line = openingElement.loc?.start?.line ?? 1;
          const column = (openingElement.loc?.start?.column ?? 0) + 1;

          elements[morphElementName] = {
            elementName: morphElementName,
            tag: tagName,
            className,
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
        }
      }
    });
  } catch (err) {
    parseOk = false;
    diagnostics.push(
      err instanceof Error ? err.message : "Syntax error parsing TSX",
    );
  }

  return {
    defaultProps,
    elements,
    parseOk,
    diagnostics,
  };
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
    let targetNode: any = null;

    walk(ast, (node) => {
      if (targetNode) return;

      let isMatchingComponent = true;
      if (componentName) {
        if (node.type === "FunctionDeclaration" && node.id?.name !== componentName) {
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
        const fn = node.type === "ExportDefaultDeclaration" ? node.declaration : node;
        if (fn && Array.isArray(fn.params)) {
          for (const param of fn.params) {
            if (param.type === "ObjectPattern" && Array.isArray(param.properties)) {
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
        !targetNode &&
        node.type === "AssignmentPattern" &&
        node.left?.type === "Identifier" &&
        node.left.name === propName &&
        node.right
      ) {
        targetNode = node.right;
      }
    });

    if (targetNode && typeof targetNode.start === "number" && typeof targetNode.end === "number") {
      const replacement = JSON.stringify(newValue);
      return sourceCode.slice(0, targetNode.start) + replacement + sourceCode.slice(targetNode.end);
    }
  } catch {}

  return sourceCode;
}

export type PatchClassNameResult = {
  code: string;
  editable: boolean;
  reason?: "not-found" | "dynamic-classname" | "parse-error";
};

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

  const element = parsed.elements[elementName];
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

  // If element has no className attribute yet, insert one before tag close
  const insertPos =
    element.openingEndOffset > 0 ? element.openingEndOffset - 1 : 0;
  if (insertPos > 0) {
    const nextClasses = updater("");
    return {
      code:
        sourceCode.slice(0, insertPos) +
        ` className=${JSON.stringify(nextClasses)}` +
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
