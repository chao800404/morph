/**
 * Where the editor builds the two content messages the preview page applies,
 * as a pure function over one file's text.
 *
 * `morph:storefront-preview-update-section-props` and
 * `morph:storefront-preview-update-selection-field` put values on the canvas.
 * A section the editor holds as hidden must not have its stored values posted
 * to the page, and the editor decides that at one place each: the section
 * message in `postPreviewSectionProps`, the selection-field message in
 * `previewSelectionField` (both in `visual-editor-shell.tsx`). A second place
 * that builds either message would post past that check without anything
 * saying so, so the rule is that there is none.
 *
 * Separated from the command so the rule has an independent witness
 * (`preview-message-poster-scan.test.mjs`), the same split as
 * `like-token-scan.mjs`.
 *
 * Parsed, not matched: a string the parser sees is classified by where it
 * stands, so the protocol's type declaration, its parser's `case`, and a
 * receiver's comparison are told apart from a message being built. Anything
 * the rule cannot classify is reported too, rather than passed: a constant
 * holding the type and spread into a message later is exactly the kind of
 * second poster this exists to find.
 */

import ts from "typescript";

/** Each guarded message type, and the one function allowed to build it. */
export const GUARDED_MESSAGES = Object.freeze({
  "morph:storefront-preview-update-section-props": Object.freeze({
    file: "src/routes/_editor/-components/visual-editor-shell.tsx",
    owner: "postPreviewSectionProps",
  }),
  "morph:storefront-preview-update-selection-field": Object.freeze({
    file: "src/routes/_editor/-components/visual-editor-shell.tsx",
    owner: "previewSelectionField",
  }),
});

const FUNCTION_KINDS = new Set([
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.MethodDeclaration,
]);

/** Whether `node` is a function, or a call wrapping one (`useCallback(fn)`). */
function holdsFunction(node) {
  if (!node) return false;
  if (FUNCTION_KINDS.has(node.kind)) return true;
  if (ts.isCallExpression(node)) return node.arguments.some(holdsFunction);
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
    return holdsFunction(node.expression);
  }
  return false;
}

/** The name of the nearest named function around `node`, or null. */
export function owningFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name) {
      return current.name.text;
    }
    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      holdsFunction(current.initializer)
    ) {
      return current.name.text;
    }
    if (
      (ts.isMethodDeclaration(current) || ts.isPropertyAssignment(current)) &&
      current.name &&
      ts.isIdentifier(current.name) &&
      (ts.isMethodDeclaration(current) || holdsFunction(current.initializer))
    ) {
      return current.name.text;
    }
  }
  return null;
}

/**
 * Where a guarded string stands:
 *
 * - `declared`: a type (`type: "…"` in the protocol's union);
 * - `parsed`: a `case` label;
 * - `compared`: an operand of `===`, `!==`, `==` or `!=`;
 * - `built`: the value of `type:` in an object literal — a message;
 * - `other`: anything else, reported.
 */
export function classify(literal) {
  const parent = literal.parent;
  if (ts.isLiteralTypeNode(parent)) return "declared";
  if (ts.isCaseClause(parent) && parent.expression === literal) return "parsed";
  if (
    ts.isBinaryExpression(parent) &&
    [
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken,
    ].includes(parent.operatorToken.kind)
  ) {
    return "compared";
  }
  if (
    ts.isPropertyAssignment(parent) &&
    parent.initializer === literal &&
    ts.isObjectLiteralExpression(parent.parent) &&
    (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name)) &&
    parent.name.text === "type"
  ) {
    return "built";
  }
  return "other";
}

/**
 * Every place in one file a guarded message is built outside its owner, or
 * a guarded type is used in a way the rule cannot classify.
 *
 * `fileName` is the path relative to the repository root, which is how the
 * owner's file is named.
 */
export function scanSource(source, fileName) {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings = [];
  const visit = (node) => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      Object.hasOwn(GUARDED_MESSAGES, node.text)
    ) {
      const rule = GUARDED_MESSAGES[node.text];
      const kind = classify(node);
      const owner = kind === "built" ? owningFunction(node) : null;
      const allowed =
        kind === "declared" ||
        kind === "parsed" ||
        kind === "compared" ||
        (kind === "built" && fileName === rule.file && owner === rule.owner);
      if (!allowed) {
        const { line } = parsed.getLineAndCharacterOfPosition(node.getStart());
        findings.push({
          message: node.text,
          kind,
          owner,
          line: line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return findings;
}
