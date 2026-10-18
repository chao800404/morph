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
 * receiver's comparison are told apart from a message being built. A guarded
 * type spelled whole somewhere the rule does not classify is reported
 * (`other`) rather than passed — a constant holding the type, say — and so
 * are the shapes listed below; anything else the scan does not see.
 *
 * A template with substitutions is read too: one whose fixed text could
 * spell a guarded type (`morph:storefront-preview-update-${kind}`) is checked
 * as that type. And since the owner is known by name, its file may declare a
 * function of that name only once: a shadowing local or a redeclaration is
 * reported (`shadowed`) rather than trusted as the owner.
 *
 * Inside its owner, a message must name the fields its receiver requires
 * (`requiredFields`) as properties of its own, written out rather than spread
 * in (`missing-field`): the selection-field message names its `sectionId`.
 *
 * Outside the owners, two more shapes are reported: a fixed run of text (a
 * string, or a template's run) of 8 or more characters that is a piece of a
 * guarded type crossing one of its separators (`fragment`: `P +
 * "update-section-props"`), and an object posted through a `post…Message`
 * call whose `type:` is not a literal (`unliteral-type`: `${NS}-${k}`).
 *
 * Known limits. This is a bounded architecture check that keeps the editor's
 * ordinary code on the one poster per message. It is not a security
 * boundary and does not claim it cannot be bypassed. It does not catch:
 *
 * - a type carried in by spread (`{ ...base }`);
 * - a message object built first and passed by variable
 *   (`const m = { type: t }; postMessage(m)`);
 * - a call through an alias, `bind`, bracket access (`w["postMessage"]`), or
 *   a wrapper not named `post…Message`;
 * - arguments serialised or cloned on the way (`JSON.parse(JSON.stringify(m))`,
 *   `structuredClone(m)`);
 * - computed keys (`{ [k]: t }`);
 * - a type joined only from bare words with no separator in any of them
 *   (`"storefront"`, `"preview"`, …);
 * - a superset string: a literal holding the whole type inside longer text
 *   (`"[morph:…-update-section-props]"`), later cut down to it.
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
    // The frame applies the post only to the section it names; the owner
    // writes the name out itself, so nothing spread in can drop or replace it.
    requiredFields: Object.freeze(["sectionId"]),
  }),
});

/** Whether an object literal names `field` itself: written out, not spread in. */
function namesOwnField(object, field) {
  return object.properties.some(
    (property) =>
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === field,
  );
}

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

/** Calls that post a message: `postMessage`, `postEditorToPreviewMessage`, … */
const POST_MESSAGE = /^post\w*Message$/i;

/** `x as T`, `x as const`, `x satisfies T`, `x!` and `(x)`, as `x`. */
function unwrapped(node) {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

/**
 * Whether `message` reads as `runs` in order with anything between them: the
 * first run at its start, the last at its end. Walked with `indexOf`, not a
 * regular expression: a pattern of `[\s\S]*` per substitution backtracks
 * exponentially on a template of many empty runs that does not match.
 */
function spellsInOrder(message, runs) {
  const first = runs[0];
  const last = runs[runs.length - 1];
  if (!message.startsWith(first)) return false;
  let at = first.length;
  for (const run of runs.slice(1, -1)) {
    const found = message.indexOf(run, at);
    if (found < 0) return false;
    at = found + run.length;
  }
  return message.length - last.length >= at && message.endsWith(last);
}

/**
 * The guarded types a template with substitutions could evaluate to: those
 * its fixed runs, in order, can be read out of with anything in between.
 */
function templateCouldSpell(node) {
  const runs = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
  if (Math.max(...runs.map((run) => run.length)) < MIN_TEMPLATE_RUN) return [];
  return Object.keys(GUARDED_MESSAGES).filter((message) => spellsInOrder(message, runs));
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
    if (!allowed) {
      findings.push({ message, kind, owner, line: lineOf(node) });
      return;
    }
    // Built in its owner: it must name the fields its receiver requires
    // (`missing-field`). `node.parent` is the `type:` property.
    if (kind === "built") {
      const object = node.parent.parent;
      for (const field of rule.requiredFields ?? []) {
        if (!namesOwnField(object, field)) {
          findings.push({
            message,
            kind: "missing-field",
            owner,
            field,
            line: lineOf(node),
          });
        }
      }
    }
  };
  // Inside one of the owners, in the owners' file: the only place a guarded
  // type may be assembled from pieces.
  const insideOwner = (node) => {
    const owner = owningFunction(node);
    return Object.values(GUARDED_MESSAGES).some(
      (rule) => rule.file === fileName && rule.owner === owner,
    );
  };
  // A run of fixed text long enough to name part of a guarded type
  // (`"update-section-props"`, the head of a template): a piece that
  // something else could join into the whole type.
  //
  // Only a run that crosses one of the type's separators (`:` or `-`) is a
  // piece of it. A single word it happens to contain — "storefront", the
  // sales-channel kind used throughout src/ — names no message: whatever
  // joins it into the type has to supply the separators, so it is that
  // other piece, not the word, that the rule has to see.
  const fragment = (node, text) => {
    if (text.length < MIN_TEMPLATE_RUN || !/[-:]/.test(text)) return;
    if (insideOwner(node)) return;
    for (const message of Object.keys(GUARDED_MESSAGES)) {
      if (message !== text && message.includes(text)) {
        findings.push({
          message,
          kind: "fragment",
          owner: owningFunction(node),
          line: lineOf(node),
          text,
        });
      }
    }
  };
  // A value whose every outcome is a literal (`a ? "x" : "y"`). Its strings
  // are visited on their own, so a guarded one is still reported.
  const literalValue = (value) => {
    value = unwrapped(value);
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
      return true;
    }
    return (
      ts.isConditionalExpression(value) &&
      literalValue(value.whenTrue) &&
      literalValue(value.whenFalse)
    );
  };
  // A message posted with a `type:` the parser cannot read: whatever it
  // holds at run time, nothing here can say it is not a guarded type.
  const postedTypes = (node) => {
    const callee = ts.isPropertyAccessExpression(node.expression)
      ? node.expression.name
      : node.expression;
    if (!ts.isIdentifier(callee) || !POST_MESSAGE.test(callee.text)) return;
    for (const passed of node.arguments) {
      const argument = unwrapped(passed);
      if (!ts.isObjectLiteralExpression(argument)) continue;
      for (const property of argument.properties) {
        const named =
          (ts.isPropertyAssignment(property) ||
            ts.isShorthandPropertyAssignment(property)) &&
          (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
          property.name.text === "type";
        if (!named) continue;
        const value = ts.isPropertyAssignment(property)
          ? property.initializer
          : property.name;
        if (literalValue(value) || insideOwner(value)) continue;
        findings.push({
          message: "(not a literal)",
          kind: "unliteral-type",
          owner: owningFunction(value),
          line: lineOf(value),
        });
      }
    }
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
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      fragment(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      const spelled = templateCouldSpell(node);
      for (const message of spelled) check(node, message);
      // Already checked as the whole type it could spell; its runs are not
      // reported a second time as pieces of it.
      if (spelled.length === 0) {
        for (const run of [node.head, ...node.templateSpans.map((span) => span.literal)]) {
          fragment(node, run.text);
        }
      }
    } else if (ts.isCallExpression(node)) {
      postedTypes(node);
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

const SHELL_FILE = "src/routes/_editor/-components/visual-editor-shell.tsx";

/**
 * Findings in src/ that are not posters, each with its reason.
 *
 * An entry is keyed by file, message, kind and owning function (`null`
 * outside any named function), and a fragment entry by its exact text too.
 * It carries the number of findings it expects. Fewer or more is a failure,
 * and so is an entry that matches nothing, so an entry cannot quietly excuse
 * a second use of the same text, in the same file or the same function.
 */
export const UNCLASSIFIED_ALLOWED = Object.freeze([
  {
    file: "src/routes/_editor/store/$storefrontId/themes/$themeId/preview.tsx",
    message: "morph:storefront-preview-update-section-props",
    kind: "other",
    owner: null,
    count: 1,
    // Morph's own preview route lists the messages after which it measures
    // again. It receives them; it posts none.
    reason: "receive-side set of messages that change the page's geometry",
  },
  ...Object.keys(GUARDED_MESSAGES).map((message) => ({
    file: SHELL_FILE,
    message,
    kind: "fragment",
    text: "morph:storefront-preview-",
    owner: "handlePreviewSelection",
    count: 1,
    // The development warning for a message the parser rejected checks the
    // received type's namespace. It reads a message; it builds none.
    reason: "receive-side namespace test on a rejected preview message",
  })),
]);

/**
 * Findings (each with its `file`) split into those no entry excuses, and the
 * entries whose number of matches is not the `count` they expect.
 */
export function applyAllowList(findings, allowList = UNCLASSIFIED_ALLOWED) {
  const matched = allowList.map(() => 0);
  const unexcused = [];
  for (const finding of findings) {
    const index = allowList.findIndex(
      (entry) =>
        entry.file === finding.file &&
        entry.message === finding.message &&
        entry.kind === finding.kind &&
        entry.owner === (finding.owner ?? null) &&
        (entry.kind !== "fragment" || entry.text === finding.text),
    );
    if (index < 0) unexcused.push(finding);
    else matched[index] += 1;
  }
  const miscounted = allowList.flatMap((entry, index) =>
    matched[index] === entry.count ? [] : [{ ...entry, found: matched[index] }],
  );
  return { unexcused, miscounted };
}
