/**
 * The page-object spelling of a content binding.
 *
 *   const home = await morph.pages.get("/home");
 *   <Hero {...home.hero} />
 *   <Gallery {...home["summer-sale"]} />
 *
 * `<Hero {...content("hero")} />` stays the other spelling. Both name the slot
 * at the call site, which is what the editor needs: the section stays one
 * self-contained element, so adding, moving or removing it never has to edit a
 * second place. That is why this is member access and not destructuring — a
 * destructuring pattern is shared by every section on the page.
 *
 * Only a literal key on a variable whose declaration is a literal
 * `await morph.pages.get("…")` counts. Anything the analysis cannot resolve
 * statically is not a binding, and callers treat it as unbound rather than
 * guess from a variable name.
 */

const CONTENT_MODULE_SPECIFIER = /(?:^|\/)morph\/content(?:\.[cm]?[jt]sx?)?$/;

type AnyNode = any;

function walk(node: AnyNode, visit: (node: AnyNode) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    walk(value, visit);
  }
}

/** The local names `morph` is imported under from the Theme content module. */
function morphLocalNames(ast: AnyNode): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of ast?.program?.body ?? []) {
    if (
      statement?.type !== "ImportDeclaration" ||
      typeof statement.source?.value !== "string" ||
      !CONTENT_MODULE_SPECIFIER.test(statement.source.value)
    ) {
      continue;
    }
    for (const specifier of statement.specifiers ?? []) {
      const imported = specifier.imported?.name ?? specifier.imported?.value;
      if (
        specifier?.type === "ImportSpecifier" &&
        imported === "morph" &&
        specifier.local?.type === "Identifier"
      ) {
        names.add(specifier.local.name);
      }
    }
  }
  return names;
}

function isPagesGetCall(call: AnyNode, morphNames: ReadonlySet<string>) {
  const callee = call?.callee;
  return (
    call?.type === "CallExpression" &&
    callee?.type === "MemberExpression" &&
    !callee.computed &&
    callee.property?.name === "get" &&
    callee.object?.type === "MemberExpression" &&
    !callee.object.computed &&
    callee.object.property?.name === "pages" &&
    callee.object.object?.type === "Identifier" &&
    morphNames.has(callee.object.object.name) &&
    call.arguments?.length === 1 &&
    call.arguments[0]?.type === "StringLiteral"
  );
}

/**
 * Variables declared as `const x = await morph.pages.get("/path")`.
 *
 * Name-based, with no scope tracking: two functions in one route that both
 * name their page `home` resolve to the same set, which is only wrong if they
 * read different paths — and the route is then reading two pages, which the
 * section model does not support yet.
 */
export function collectPageVariables(ast: AnyNode): ReadonlySet<string> {
  const morphNames = morphLocalNames(ast);
  const variables = new Set<string>();
  if (morphNames.size === 0) return variables;
  walk(ast?.program, (node) => {
    if (
      node?.type === "VariableDeclarator" &&
      node.id?.type === "Identifier" &&
      node.init?.type === "AwaitExpression" &&
      isPagesGetCall(node.init.argument, morphNames)
    ) {
      variables.add(node.id.name);
    }
  });
  return variables;
}

export const NO_PAGE_VARIABLES: ReadonlySet<string> = new Set();

function isPageMember(
  expression: AnyNode,
  pageVariables: ReadonlySet<string>,
): boolean {
  return (
    expression?.type === "MemberExpression" &&
    expression.object?.type === "Identifier" &&
    pageVariables.has(expression.object.name)
  );
}

/**
 * The key a spread reads off a page variable: `home.hero` or `home["hero"]`.
 * Not validated as a slot id — each caller already has its own rule for that.
 */
export function readPageBindingKey(
  expression: AnyNode,
  pageVariables: ReadonlySet<string>,
): string | null {
  if (!isPageMember(expression, pageVariables)) return null;
  const property = expression.property;
  if (expression.computed) {
    return property?.type === "StringLiteral" ? property.value : null;
  }
  return property?.type === "Identifier" ? property.name : null;
}

/** Whether the expression reads from a page variable at all, valid key or not. */
export function isPageBindingExpression(
  expression: AnyNode,
  pageVariables: ReadonlySet<string>,
): boolean {
  return isPageMember(expression, pageVariables);
}
