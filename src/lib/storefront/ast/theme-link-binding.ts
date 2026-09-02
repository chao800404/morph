import { parse } from "@babel/parser";

const MAX_SOURCE_BYTES = 512 * 1024;

/** How a component sends a content field to the page. */
export type ThemeLinkBinding = "router" | "anchor" | "unknown";

export type PatchThemeLinkBindingResult = {
  code: string;
  editable: boolean;
  reason?: "not-found" | "ambiguous" | "parse-error";
};

function parseAst(sourceCode: string) {
  return parse(sourceCode, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });
}

/** `x`, `x.href`, `x ?? y`, `cond ? x : y` — every form a destination arrives in. */
function expressionMentions(node: any, name: string, depth = 0): boolean {
  if (!node || depth > 8) return false;
  switch (node.type) {
    case "Identifier":
      return node.name === name;
    case "MemberExpression":
      return expressionMentions(node.object, name, depth + 1);
    case "LogicalExpression":
    case "BinaryExpression":
      return (
        expressionMentions(node.left, name, depth + 1) ||
        expressionMentions(node.right, name, depth + 1)
      );
    case "ConditionalExpression":
      return (
        expressionMentions(node.test, name, depth + 1) ||
        expressionMentions(node.consequent, name, depth + 1) ||
        expressionMentions(node.alternate, name, depth + 1)
      );
    case "TSAsExpression":
    case "TSNonNullExpression":
    case "JSXExpressionContainer":
      return expressionMentions(node.expression, name, depth + 1);
    default:
      return false;
  }
}

function elementName(opening: any): string {
  const name = opening?.name;
  if (!name) return "";
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXMemberExpression") return name.property?.name ?? "";
  return "";
}

function walk(node: any, visit: (node: any) => void, depth = 0): void {
  if (!node || typeof node !== "object" || depth > 60) return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, depth + 1);
    return;
  }
  if (typeof node.type === "string") visit(node);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "leadingComments" || key === "trailingComments") {
      continue;
    }
    walk(node[key], visit, depth + 1);
  }
}

/**
 * Whether a link field's destination is handed to the router or to an anchor.
 *
 * The distinction decides what an author may put there. `<Link to>` resolves
 * against this Theme's route tree, so an address on another site cannot work —
 * offering one would produce a link that survives the preview, where the
 * interpreter renders a plain anchor, and breaks on the built site, where the
 * real router has to match it. `<a href>` takes either.
 *
 * `unknown` means the field's destination could not be traced to an element,
 * which is treated as the permissive case rather than guessed at.
 */
export function resolveThemeLinkBinding(
  sourceCode: string | null | undefined,
  fieldKey: string,
): ThemeLinkBinding {
  if (typeof sourceCode !== "string" || sourceCode.length > MAX_SOURCE_BYTES) {
    return "unknown";
  }
  if (!sourceCode.includes(fieldKey)) return "unknown";

  let ast;
  try {
    ast = parseAst(sourceCode);
  } catch {
    return "unknown";
  }

  let binding: ThemeLinkBinding = "unknown";
  walk(ast.program, (node) => {
    if (binding !== "unknown") return;
    if (node.type !== "JSXOpeningElement") return;
    const tag = elementName(node);
    for (const attribute of node.attributes ?? []) {
      if (
        attribute?.type !== "JSXAttribute" ||
        attribute.name?.type !== "JSXIdentifier"
      ) {
        continue;
      }
      const attributeName = attribute.name.name;
      if (attributeName !== "to" && attributeName !== "href") continue;
      if (!expressionMentions(attribute.value, fieldKey)) continue;
      // `to` is the router's; `href` on a lowercase tag is a real anchor. A
      // capitalised component taking `href` is a wrapper around one, so it is
      // read the same way.
      binding = attributeName === "to" ? "router" : "anchor";
      if (tag === "a") binding = "anchor";
      return;
    }
  });
  return binding;
}

const ROUTER_MODULE = "@tanstack/react-router";

/** Where an edit has to be applied to turn one element into the other. */
type LinkElementSite = {
  openingNameStart: number;
  openingNameEnd: number;
  attributeNameStart: number;
  attributeNameEnd: number;
  closingNameStart?: number;
  closingNameEnd?: number;
  binding: ThemeLinkBinding;
};

function findLinkElementSites(
  ast: any,
  fieldKey: string,
): LinkElementSite[] {
  const sites: LinkElementSite[] = [];
  walk(ast.program, (node) => {
    if (node.type !== "JSXElement") return;
    const opening = node.openingElement;
    const name = opening?.name;
    if (!opening || name?.type !== "JSXIdentifier") return;

    for (const attribute of opening.attributes ?? []) {
      if (
        attribute?.type !== "JSXAttribute" ||
        attribute.name?.type !== "JSXIdentifier"
      ) {
        continue;
      }
      const attributeName = attribute.name.name;
      if (attributeName !== "to" && attributeName !== "href") continue;
      if (!expressionMentions(attribute.value, fieldKey)) continue;
      if (
        typeof name.start !== "number" ||
        typeof name.end !== "number" ||
        typeof attribute.name.start !== "number" ||
        typeof attribute.name.end !== "number"
      ) {
        return;
      }
      const closingName = node.closingElement?.name;
      sites.push({
        openingNameStart: name.start,
        openingNameEnd: name.end,
        attributeNameStart: attribute.name.start,
        attributeNameEnd: attribute.name.end,
        closingNameStart:
          closingName?.type === "JSXIdentifier" &&
          typeof closingName.start === "number"
            ? closingName.start
            : undefined,
        closingNameEnd:
          closingName?.type === "JSXIdentifier" &&
          typeof closingName.end === "number"
            ? closingName.end
            : undefined,
        binding: attributeName === "to" ? "router" : "anchor",
      });
      return;
    }
  });
  return sites;
}

/**
 * Adds `Link` to the Theme's router import, or writes the import if absent.
 *
 * Returns `null` when nothing needs adding, so the caller can tell an edit from
 * a no-op.
 */
function ensureRouterLinkImport(
  ast: any,
): { start: number; end: number; text: string } | null {
  let sideEffectOnly: any = null;
  for (const statement of ast.program.body ?? []) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.source?.value !== ROUTER_MODULE
    ) {
      continue;
    }
    const specifiers = statement.specifiers ?? [];
    if (
      specifiers.some(
        (specifier: any) =>
          specifier.type === "ImportSpecifier" &&
          specifier.imported?.name === "Link",
      )
    ) {
      return null;
    }
    const named = specifiers.find(
      (specifier: any) => specifier.type === "ImportSpecifier",
    );
    if (named && typeof named.start === "number") {
      return { start: named.start, end: named.start, text: "Link, " };
    }
    sideEffectOnly = statement;
  }

  const insertAt =
    sideEffectOnly && typeof sideEffectOnly.end === "number"
      ? sideEffectOnly.end
      : 0;
  const importLine = `import { Link } from "${ROUTER_MODULE}";\n`;
  return insertAt === 0
    ? { start: 0, end: 0, text: importLine }
    : { start: insertAt, end: insertAt, text: `\n${importLine.trimEnd()}` };
}

/**
 * Rewrites a link between the router's `<Link to>` and a plain `<a href>`.
 *
 * Which element is used is what decides where a link may point, so choosing the
 * destination kind in the Inspector has to change the element rather than only
 * the value. `<Link>` resolves against this Theme's routes; `<a>` addresses
 * anything, including another site, `mailto:` and `tel:`.
 *
 * Only a single unambiguous destination is rewritten. A file with several links
 * bound to the same field is left alone: picking one would silently change a
 * link the author did not have in view.
 */
export function patchThemeLinkElement(
  sourceCode: string,
  fieldKey: string,
  target: Exclude<ThemeLinkBinding, "unknown">,
): PatchThemeLinkBindingResult {
  if (
    typeof sourceCode !== "string" ||
    sourceCode.length > MAX_SOURCE_BYTES ||
    !sourceCode.includes(fieldKey)
  ) {
    return { code: sourceCode, editable: false, reason: "not-found" };
  }

  try {
    const ast = parseAst(sourceCode);
    const sites = findLinkElementSites(ast, fieldKey);
    if (sites.length === 0) {
      return { code: sourceCode, editable: false, reason: "not-found" };
    }
    if (sites.length !== 1) {
      return { code: sourceCode, editable: false, reason: "ambiguous" };
    }

    const [site] = sites;
    if (site.binding === target) return { code: sourceCode, editable: true };

    const toRouter = target === "router";
    const tagName = toRouter ? "Link" : "a";
    const attributeName = toRouter ? "to" : "href";

    const edits: Array<{ start: number; end: number; text: string }> = [
      {
        start: site.openingNameStart,
        end: site.openingNameEnd,
        text: tagName,
      },
      {
        start: site.attributeNameStart,
        end: site.attributeNameEnd,
        text: attributeName,
      },
    ];
    if (
      site.closingNameStart !== undefined &&
      site.closingNameEnd !== undefined
    ) {
      edits.push({
        start: site.closingNameStart,
        end: site.closingNameEnd,
        text: tagName,
      });
    }
    if (toRouter) {
      const importEdit = ensureRouterLinkImport(ast);
      if (importEdit) edits.push(importEdit);
    }

    // Applied back to front so an earlier edit cannot shift a later offset.
    let code = sourceCode;
    for (const edit of edits.sort((left, right) => right.start - left.start)) {
      code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
    }
    return { code, editable: true };
  } catch {
    return { code: sourceCode, editable: false, reason: "parse-error" };
  }
}

/**
 * Connect one hard-coded TanStack `<Link to="...">` to a component prop.
 *
 * This is deliberately narrower than the resolver: it only rewrites a single
 * statically-addressable `Link` destination and refuses ambiguous files. The
 * editor can therefore offer a one-click repair without guessing which of
 * several links should receive the field.
 */
export function patchThemeLinkBinding(
  sourceCode: string,
  fieldKey: string,
): PatchThemeLinkBindingResult {
  if (
    typeof sourceCode !== "string" ||
    sourceCode.length > MAX_SOURCE_BYTES ||
    !sourceCode.includes(fieldKey)
  ) {
    return { code: sourceCode, editable: false, reason: "not-found" };
  }

  try {
    const ast = parseAst(sourceCode);
    const candidates: Array<{ start: number; end: number }> = [];

    walk(ast.program, (node) => {
      if (node.type !== "JSXOpeningElement") return;
      if (elementName(node) !== "Link") return;

      for (const attribute of node.attributes ?? []) {
        if (
          attribute?.type !== "JSXAttribute" ||
          attribute.name?.type !== "JSXIdentifier" ||
          attribute.name.name !== "to"
        ) {
          continue;
        }
        // A value that already mentions the field is not a repair target.
        if (expressionMentions(attribute.value, fieldKey)) return;
        // Keep dynamic expressions code-only. Only a literal can be replaced
        // without changing the author's runtime logic.
        if (
          attribute.value?.type !== "StringLiteral" ||
          typeof attribute.value.start !== "number" ||
          typeof attribute.value.end !== "number"
        ) {
          return;
        }
        candidates.push({
          start: attribute.value.start,
          end: attribute.value.end,
        });
        return;
      }
    });

    if (candidates.length === 0) {
      return { code: sourceCode, editable: false, reason: "not-found" };
    }
    if (candidates.length !== 1) {
      return { code: sourceCode, editable: false, reason: "ambiguous" };
    }

    const [candidate] = candidates;
    return {
      code:
        sourceCode.slice(0, candidate.start) +
        `{${fieldKey}}` +
        sourceCode.slice(candidate.end),
      editable: true,
    };
  } catch {
    return { code: sourceCode, editable: false, reason: "parse-error" };
  }
}
