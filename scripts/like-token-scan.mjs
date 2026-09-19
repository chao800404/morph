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
 * Three rules, and the number is deliberate rather than incidental. A query
 * reaches for the spelling in one of two ways — importing the comparison
 * helper, or writing raw SQL in a template — and the pattern strings those
 * helpers consume are a third thing that has to stay in one place. That those
 * are the only ways is established in `check-sql-timestamps.mjs`, which is
 * where the reasoning about how raw SQL reaches this database lives; it is
 * referenced rather than restated so there is one version of it to keep true.
 */

import ts from "typescript";

/** The pattern arithmetic. Only `like-query.ts` may hold one of these strings. */
const PATTERN_BUILDERS = new Set(["containsPattern", "prefixPattern"]);

/**
 * Drizzle's comparison helpers. Binding one — from any module, under any name —
 * is reaching for the spelling.
 */
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
    // The spelling itself, from wherever it is imported.
    //
    // This root used to test the specifier — `=== "drizzle-orm"` — and that is
    // the one thing about it that was wrong. `src/db/index.ts:15` is
    // `export * from "drizzle-orm"`, so `import { like } from "@/db"` binds the
    // same function through a different specifier, and such a file was reported
    // clean with the spelling sitting in its import list. Two files were on the
    // report only through the pattern root, so migrating them — deleting the
    // local `const pattern = containsPattern(…)` and keeping `like` — would
    // have turned this guard green with the LIKE still there. A completion
    // condition that can be met without the condition being true is worse than
    // no completion condition.
    //
    // So it asks about the binding, not the module the binding came from. A
    // list of specifiers would have to name every module that re-exports
    // drizzle, which is a version of the truth rather than the rule, and the
    // day a second barrel appeared it would be a stale version.
    //
    // A re-export needs no rule of its own: `export { like } from "…"` does not
    // bind the name where it is written, so it cannot be called there, and the
    // only way to reach it is an import — which is this. That is why the barrel
    // is neither a finding nor an exception.
    //
    // It reports the name, not a proof that the name is SQL's. A module
    // exporting something unrelated called `like` would be reported too, and a
    // person would decide, which is the same arrangement `NON_SQL_TAGS`
    // documents below. The alternative is a scanner guessing at provenance, and
    // a scanner that guesses is the detector this guard exists to replace.
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
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
            root: "like-binding",
            found: `imports ${reached.join(", ")} from ${specifier}`,
          });
        }
      }
      if (bindings && ts.isNamespaceImport(bindings)) {
        namespaceAliases.add(bindings.name.text);
      }
    }

    // `db.like(...)` is a call, so the tagged-template rule cannot see it.
    // Widening that rule closed two holes and left this one open, which is why
    // they are separate roots rather than one fix.
    //
    // Every namespace import is tracked, for the reason the root above dropped
    // its specifier test: `import * as db from "@/db"` reaches the spelling too.
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      namespaceAliases.has(node.expression.expression.text) &&
      LIKE_BINDINGS.has(node.expression.name.text)
    ) {
      findings.push({
        line: lineOf(node.getStart(parsed)),
        root: "like-binding",
        found: `${node.expression.expression.text}.${node.expression.name.text}() via a namespace import`,
      });
    }

    // The pattern helpers themselves, which is the root that makes the other two
    // finishable rather than merely enforced.
    //
    // Without it every migrated call site has to remember not to pass a pattern
    // where a term belongs: `likeContains(column, pattern)` type-checks, because
    // both are `string`, and produces `%%term%%`. SQL collapses the doubled `%`
    // so nothing looks wrong — but the wrapper characters are inside the budget,
    // so the searchable term shrinks. Measured at the cap: a single wrap keeps 16
    // Chinese characters and a double wrap keeps 15, with the pattern at 48 bytes
    // instead of 50, which means it does not even fail. Only at the boundary, no
    // type error, no test.
    //
    // So once the migration is done the pattern strings cannot leave this module
    // and the mistake is unwritable rather than merely discouraged. It also makes
    // the two completion conditions one: "no LIKE outside the module" and "no
    // pattern string outside the module" are the same state described twice.
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      /(^|\/)like-pattern(\.(ts|js|mjs))?$/.test(node.moduleSpecifier.text)
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        const reached = bindings.elements
          .map((element) => (element.propertyName ?? element.name).text)
          .filter((name) => PATTERN_BUILDERS.has(name));
        if (reached.length > 0) {
          findings.push({
            root: "pattern-import",
            line: lineOf(node.getStart(parsed)),
            found: `imports ${reached.join(", ")} from like-pattern`,
          });
        }
      }
    }

    if (ts.isTaggedTemplateExpression(node)) {
      const tag = node.tag.getText(parsed);
      if (!NON_SQL_TAGS.has(tag)) {
        const body = node.template.getText(parsed);
        PATTERN_OPERATOR.lastIndex = 0;
        for (const operator of body.matchAll(PATTERN_OPERATOR)) {
          findings.push({
            line: lineOf(node.template.getStart(parsed) + operator.index),
            root: "tagged-template",
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
