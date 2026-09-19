/**
 * The shapes the three rules have to tell apart.
 *
 * An independent witness, run by `node --test`. Not vitest: its include pattern
 * is `src/**\/*.test.{ts,tsx}`, so a test beside the runner would never be
 * collected — and a guard whose tests never run is the thing this guard exists
 * to prevent. Not a `--self-test` flag either: that puts the assertions inside
 * the subject, so the scanner's correctness depends on the scanner working well
 * enough to reach them.
 *
 * Four of these were missed by an earlier version — a namespace import, an
 * aliased `sql`, a tag re-exported locally, and a named import through the
 * `@/db` barrel. Each is written down because a hand-run check does not stop
 * the next edit from reopening the hole, which is how a detector ends up
 * reporting a defect one run in six.
 *
 * This file needs no exemption, and the reason is worth keeping: every
 * forbidden shape below sits inside a string literal, so the parser sees a
 * string where the regex version saw an import. The tree is scanned exactly as
 * it stands and this file contributes no finding — a property of the parser,
 * not a promise about the fixtures. Nothing here reaches a database either way.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scanSource } from "./like-token-scan.mjs";

const finds = (source) => scanSource(source).length;

describe("the like binding root", () => {
  it("catches a named import through a re-exporting barrel", () => {
    // The regression this root was rewritten for. `src/db/index.ts:15` is
    // `export * from "drizzle-orm"`, so `@/db` is a second source of the same
    // binding, and a root that tested the specifier reported such a file clean
    // while `like` sat in its import list. Two files were on the report only
    // through the pattern root, so deleting the local `containsPattern` binding
    // and keeping this import would have made the guard green with the LIKE
    // still in place.
    //
    // No fixture in `src` can catch this any more — both files are migrated —
    // which is why it is written here instead. A rule that cannot be falsified
    // by the tree it guards is exactly what a test is for.
    assert.equal(finds('import { like } from "@/db";'), 1);
  });

  it("catches a namespace import of a barrel used as a call", () => {
    assert.equal(
      finds('import * as db from "@/db";\nexport const q = (c, p) => db.like(c, p);'),
      1,
    );
  });

  it("reports the same name from an unrelated module, and a person decides", () => {
    // Deliberate, not an oversight. The parser sees a binding, not a
    // provenance: proving a given `like` is drizzle's needs a type checker, and
    // `ts.createSourceFile` is deliberately not one. So the rule reports the
    // name, and a genuinely unrelated module gets an entry with a reason
    // beside it — the arrangement `NON_SQL_TAGS` documents. Narrowing the rule
    // back to a list of specifiers is what produced the false negative above.
    assert.equal(finds('import { like } from "some-unrelated-library";'), 1);
  });

  it("names the root, so an exception can be scoped to it", () => {
    assert.deepEqual(
      scanSource('import { like } from "@/db";').map((finding) => finding.root),
      ["like-binding"],
    );
  });

  it("catches a named import", () => {
    assert.equal(finds('import { like } from "drizzle-orm";'), 1);
  });

  it("catches an aliased named import", () => {
    // `{ like as l }` renames the binding; the capability is the same.
    assert.equal(finds('import { like as l } from "drizzle-orm";'), 1);
  });

  it("catches every comparison helper, not only `like`", () => {
    assert.equal(finds('import { notLike, ilike } from "drizzle-orm";'), 1);
  });

  it("catches a namespace import used as a call", () => {
    // A function call, so the tagged-template root cannot see it. Widening that
    // root closed two holes and left this one open.
    assert.equal(
      finds('import * as d from "drizzle-orm";\nexport const q = (c, p) => d.like(c, p);'),
      1,
    );
  });

  it("ignores an unrelated drizzle import", () => {
    assert.equal(finds('import { eq, and } from "drizzle-orm";'), 0);
  });

  it("ignores a namespace import that never reaches a helper", () => {
    assert.equal(
      finds('import * as d from "drizzle-orm";\nexport const q = (c) => d.eq(c, 1);'),
      0,
    );
  });
});

describe("the tagged template root", () => {
  it("catches a sql template", () => {
    assert.equal(finds("export const q = (c, p) => sql`${c} LIKE ${p}`;"), 1);
  });

  it("catches an aliased sql tag", () => {
    assert.equal(
      finds('import { sql as raw } from "drizzle-orm";\nexport const q = (c, p) => raw`${c} LIKE ${p}`;'),
      1,
    );
  });

  it("catches a tag re-exported from a local module", () => {
    assert.equal(finds('import { db } from "./db";\nexport const q = (c) => db`${c} GLOB \'a*\'`;'), 1);
  });

  it("catches lower case, because SQL keywords are case-insensitive", () => {
    assert.equal(finds("export const q = (c, p) => sql`${c} like ${p}`;"), 1);
  });

  it("catches an operator on a later line of the same template", () => {
    assert.equal(
      finds("export const q = (c, p) => sql`\n  SELECT *\n  WHERE ${c} LIKE ${p}\n`;"),
      1,
    );
  });

  it("ignores an untagged template, which is a string and not a query", () => {
    assert.equal(finds("const label = `sounds LIKE a UI string`;"), 0);
  });

  it("ignores GLOB as a bare word outside a template", () => {
    assert.equal(finds("const mode = GLOB_MODE;"), 0);
  });
});

describe("prose is not code", () => {
  it("ignores a line comment", () => {
    assert.equal(finds("// a note about LIKE and GLOB caps"), 0);
  });

  it("ignores a block comment holding an example", () => {
    assert.equal(finds("/**\n * sql`${c} LIKE ${p}` as an example.\n */"), 0);
  });

  it("ignores a string that contains what looks like a comment", () => {
    assert.equal(finds('const s = "// not a comment, LIKE this";'), 0);
  });

  it("reports the line the query is on, not the line the prose is on", () => {
    const source = "// LIKE in prose\n\nexport const q = (c, p) => sql`${c} LIKE ${p}`;";
    assert.deepEqual(
      scanSource(source).map((finding) => finding.line),
      [3],
    );
  });

  it("is not confused by a template literal that follows a keyword", () => {
    // `return `...`` is not a tagged template, and a pattern-based scan read it
    // as one tagged `return`. Same for a backtick paired across a file, which
    // produced tags nobody wrote — `px``, `ready``, `column``.
    assert.equal(finds("export const q = () => {\n  return `LIKE a string`;\n};"), 0);
  });

  it("is not confused by backticks inside a regular expression", () => {
    // The scanner's own regexes used to contain backticks, and a quote-tracking
    // masker reported the scanner as a violation of itself.
    assert.equal(finds("const pattern = /`([^`]*)`/g;\nconst note = `LIKE`;"), 0);
  });
});

describe("the pattern arithmetic root", () => {
  it("catches an import of containsPattern", () => {
    assert.equal(finds('import { containsPattern } from "@/lib/db/like-pattern";'), 1);
  });

  it("catches prefixPattern, and a relative specifier", () => {
    assert.equal(finds('import { prefixPattern } from "./like-pattern";'), 1);
  });

  it("names the root, so an exception can be scoped to it", () => {
    // The command excuses `like-pattern.test.ts` from this root and from no
    // other: it has to import the arithmetic, which is no reason to stop
    // checking it for queries.
    assert.deepEqual(
      scanSource('import { containsPattern } from "./like-pattern";').map((f) => f.root),
      ["pattern-import"],
    );
  });

  it("ignores an import of something else from the same module", () => {
    assert.equal(finds('import { MAX_TERM_BYTES } from "./like-pattern";'), 0);
  });

  it("ignores a module whose name merely ends in similar text", () => {
    assert.equal(finds('import { containsPattern } from "./not-like-patterns";'), 0);
  });
});

describe("the builders themselves", () => {
  it("ignores a call to likeContains", () => {
    assert.equal(
      finds('import { likeContains } from "@/lib/db/like-query";\nexport const q = (c, t) => likeContains(c, t);'),
      0,
    );
  });

  it("ignores likePrefix and sqlContains", () => {
    assert.equal(
      finds('import { likePrefix, sqlContains } from "@/lib/db/like-query";\nexport const q = (c, t) => [likePrefix(c, t), sqlContains(c, t)];'),
      0,
    );
  });
});
