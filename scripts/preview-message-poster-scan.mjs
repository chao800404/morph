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
 *
 * A template with substitutions is read too: one whose fixed text could
 * spell a guarded type (`morph:storefront-preview-update-${kind}`) is checked
 * as that type. And since the owner is known by name, its file may declare a
 * function of that name only once: a shadowing local or a redeclaration is
 * reported (`shadowed`) rather than trusted as the owner.
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

/** The name `node` gives a function it declares, or null. */
function declaredFunctionName(node) {
  if (ts.isFunctionDeclaration(node) && node.name) {
    return node.name.text;
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    holdsFunction(node.initializer)
  ) {
    return node.name.text;
  }
  if (
    (ts.isMethodDeclaration(node) || ts.isPropertyAssignment(node)) &&
    node.name &&
    ts.isIdentifier(node.name) &&
    (ts.isMethodDeclaration(node) || holdsFunction(node.initializer))
  ) {
    return node.name.text;
  }
  return null;
}

/** The name of the nearest named function around `node`, or null. */
export function owningFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    const name = declaredFunctionName(current);
    if (name) return name;
  }
  return null;
}

/**
 * The shortest fixed run of text a template with substitutions must hold
 * before it is read as possibly spelling a guarded type. Shorter runs are
 * key separators (`${templateId}:${sectionId}`), which could spell anything
 * and name nothing; a run this long names part of the message.
 */
const MIN_TEMPLATE_RUN = 8;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The guarded types a template with substitutions could evaluate to: those
 * its fixed runs, in order, can be read out of with anything in between.
 */
function templateCouldSpell(node) {
  const runs = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
  if (Math.max(...runs.map((run) => run.length)) < MIN_TEMPLATE_RUN) return [];
  const pattern = new RegExp(`^${runs.map(escapeRegExp).join("[\\s\\S]*")}$`);
  return Object.keys(GUARDED_MESSAGES).filter((message) => pattern.test(message));
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
  const lineOf = (node) =>
    parsed.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const check = (node, message) => {
    const rule = GUARDED_MESSAGES[message];
    const kind = classify(node);
    const owner = kind === "built" ? owningFunction(node) : null;
    const allowed =
      kind === "declared" ||
      kind === "parsed" ||
      kind === "compared" ||
      (kind === "built" && fileName === rule.file && owner === rule.owner);
    if (!allowed) findings.push({ message, kind, owner, line: lineOf(node) });
  };
  // Every function in an owner's file carrying an owner's name. The owner is
  // known by name, so a second one — a shadowing local, a later redeclaration
  // — would be allowed to build the message past the real owner's check.
  const ownerDeclarations = new Map();
  const visit = (node) => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      Object.hasOwn(GUARDED_MESSAGES, node.text)
    ) {
      check(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      for (const message of templateCouldSpell(node)) check(node, message);
    }
    const declared = declaredFunctionName(node);
    if (declared) {
      for (const [message, rule] of Object.entries(GUARDED_MESSAGES)) {
        if (rule.file !== fileName || rule.owner !== declared) continue;
        const seen = ownerDeclarations.get(message) ?? [];
        seen.push(node);
        ownerDeclarations.set(message, seen);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  for (const [message, declarations] of ownerDeclarations) {
    if (declarations.length < 2) continue;
    for (const node of declarations) {
      findings.push({
        message,
        kind: "shadowed",
        owner: GUARDED_MESSAGES[message].owner,
        line: lineOf(node),
      });
    }
  }
  return findings;
}
