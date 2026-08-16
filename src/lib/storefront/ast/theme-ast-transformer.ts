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
};

/**
 * Resolves standard component file path from section type.
 */
export function getComponentFilePath(type: string): string {
  switch (type) {
    case "hero":
      return "src/components/Hero.tsx";
    case "editorial-intro":
      return "src/components/EditorialIntro.tsx";
    case "category-showcase":
      return "src/components/CategoryShowcase.tsx";
    case "image-with-text":
      return "src/components/Hero.tsx";
    case "principles":
    case "newsletter":
      return "src/pages/index.tsx";
    default:
      return "src/pages/index.tsx";
  }
}

function parseAst(sourceCode: string) {
  return parse(sourceCode, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
    errorRecovery: true,
  });
}

/**
 * Recursively visits all AST nodes.
 */
function walk(node: any, callback: (node: any) => void) {
  if (!node || typeof node !== "object") return;
  callback(node);

  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "loc") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        walk(item, callback);
      }
    } else if (child && typeof child === "object") {
      walk(child, callback);
    }
  }
}

/**
 * Parses TSX component source code via Babel AST to extract
 * default prop values, morph element locations, tags, and classNames.
 */
export function parseComponentSource(sourceCode: string): ParsedComponentMeta {
  const defaultProps: Record<string, string> = {};
  const elements: Record<string, ComponentElementMeta> = {};

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
  } catch {}

  return {
    defaultProps,
    elements,
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

/**
 * Patches the className of a specific morph element in component source code using exact AST node offsets.
 */
export function patchElementClassName(
  sourceCode: string,
  elementName: string,
  updater: (prevClasses: string) => string,
): string {
  const parsed = parseComponentSource(sourceCode);
  const element = parsed.elements[elementName];
  if (!element) return sourceCode;

  if (element.classNameOffsets && !element.classNameOffsets.isExpression) {
    const { start, end } = element.classNameOffsets;
    const nextClasses = updater(element.className);
    const replacement = JSON.stringify(nextClasses);
    return sourceCode.slice(0, start) + replacement + sourceCode.slice(end);
  }

  return sourceCode;
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

/**
 * Find exact line and column location of an element for Monaco editor positioning.
 */
export function findSourceLocation(
  sourceCode: string,
  elementName: string,
): SourceLocation | null {
  const parsed = parseComponentSource(sourceCode);
  return parsed.elements[elementName]?.location ?? null;
}
