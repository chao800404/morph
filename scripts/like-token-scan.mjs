/**
 * Where `LIKE` is spelled, as a pure function over one file's text.
 *
 * Separated from the command so the rules can be tested by an independent
 * witness. The first version put its assertions inside the scanner behind a
 * `--self-test` flag, which makes the scanner's correctness depend on the
 * scanner running correctly enough to reach its own assertions.
 *
 * The rule: `src/lib/db/like-query.ts` holds the only spellings in the
 * application. It says so of itself, and nothing enforced it — a claim every
 * future query had to re-earn by remembering. The arithmetic is not obvious and
 * the failure is not local: D1 caps a LIKE pattern at 50 **bytes**, so a Chinese
 * search breaks at 17 characters and a path prefix built from two UUIDs is over
 * the cap before its second level. That limit has been met three times here, by
 * three different people — a GLOB in migration 0054, the asset folder id path,
 * and an end-to-end verifier's marker.
 *
 * Two roots, because there are two ways a query reaches for it. That these are
 * the only two is established in `check-sql-timestamps.mjs`, which is where the
 * reasoning about how raw SQL reaches this database lives; it is referenced
 * rather than restated so there is one version of it to keep true.
 */

import ts from "typescript";

/** Drizzle's comparison helpers. Importing one is reaching for the spelling. */
const LIKE_BINDINGS = new Set(["like", "notLike", "ilike", "notIlike"]);

/**
 * Tags that are not SQL, and so may contain the word LIKE harmlessly.
 *
 * Empty, because there are none. Measured with this same parser over `src/**`
 * and `scripts/**`: 179 tagged templates, every one of them tagged `sql`. It
 * exists so that the day someone introduces a `css` or `html` template holding
 * the word, the guard asks a person rather than failing silently or being
 * loosened in a hurry.
 *
 * An entry here needs a reason beside it. A list that accepts bare additions
 * becomes the place where care is no longer required, which is the shape this
 * guard exists to remove.
 */
const NON_SQL_TAGS = new Set([]);

/**
 * Case-insensitive, because SQL keywords are: `sql`${x} like ${y}`` is valid and
 * an exact-case rule would not see it. Free to fix — every spelling in the repo
 * today is upper case — so it closes a latent hole without widening the result.
 */
const PATTERN_OPERATOR = /\b(LIKE|GLOB)\b/gi;

/**
 * Parsed, not matched. This is the second thing the regex version got wrong and
 * the more important one.
 *
 * A pattern cannot tell a template's opening backtick from its closing one, so
 * it pairs them across a file and reads the last word of each body as a tag.
 * That produced `px``, `ready`` and `column`` — tags nobody wrote — and it read
 * `return `...`` as a template tagged `return`. Every one of those was a false
 * positive in a file with no query in it.
 *
 * `ts.createSourceFile` is syntax only: no program, no type checker, no symbol
 * resolution. So it costs a parse per file and cannot produce the false
 * negatives that tracking a binding through scopes would — it does not try to
 * prove a tag is Drizzle's, it reports every tagged template and lets
 * `NON_SQL_TAGS` name the exceptions. Comment masking is gone with it: a parser
 * does not see comments, which is why the prose describing this cap in five
 * files no longer needs special handling.
 */
export function scanSource(source, fileName = "input.ts") {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const findings = [];
  const lineOf = (position) =>
    parsed.getLineAndCharacterOfPosition(position).line + 1;

  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "drizzle-orm"
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        // `propertyName` is the exported name when the import is aliased, so
        // `{ like as l }` is recognised by what it imports, not what it is called.
        const reached = bindings.elements
          .map((element) => (element.propertyName ?? element.name).text)
          .filter((name) => LIKE_BINDINGS.has(name));
        if (reached.length > 0) {
          findings.push({
            line: lineOf(node.getStart(parsed)),
            found: `imports ${reached.join(", ")} from drizzle-orm`,
          });
        }
      }
      if (bindings && ts.isNamespaceImport(bindings)) {
        namespaceAliases.add(bindings.name.text);
      }
    }

    // `drizzle.like(...)` is a call, so the tagged-template rule cannot see it.
    // Widening that rule closed two holes and left this one open, which is why
    // they are separate roots rather than one fix.
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      namespaceAliases.has(node.expression.expression.text) &&
      LIKE_BINDINGS.has(node.expression.name.text)
    ) {
      findings.push({
        line: lineOf(node.getStart(parsed)),
        found: `${node.expression.expression.text}.${node.expression.name.text}() via a namespace import of drizzle-orm`,
      });
    }

    if (ts.isTaggedTemplateExpression(node)) {
      const tag = node.tag.getText(parsed);
      if (!NON_SQL_TAGS.has(tag)) {
        const body = node.template.getText(parsed);
        PATTERN_OPERATOR.lastIndex = 0;
        for (const operator of body.matchAll(PATTERN_OPERATOR)) {
          findings.push({
            line: lineOf(node.template.getStart(parsed) + operator.index),
            found: `raw ${operator[0].toUpperCase()} in a ${tag}\`\` template`,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  const namespaceAliases = new Set();
  visit(parsed);
  return findings.sort((a, b) => a.line - b.line);
}
