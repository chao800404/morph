/**
 * The shapes the two roots have to tell apart.
 *
 * An independent witness, run by `node --test`. Not vitest: its include pattern
 * is `src/**\/*.test.{ts,tsx}`, so a test beside the runner would never be
 * collected — and a guard whose tests never run is the thing this guard exists
 * to prevent. Not a `--self-test` flag either: that puts the assertions inside
 * the subject, so the scanner's correctness depends on the scanner working well
 * enough to reach them.
 *
 * Three of these were missed by the first version — a namespace import, an
 * aliased `sql`, and a tag re-exported locally. Each is written down because a
 * hand-run check does not stop the next edit from reopening the hole, which is
 * how a detector ends up reporting a defect one run in six.
 *
 * This file holds every forbidden shape on purpose, so it is named in the
 * command's allowlist. That is the fixtures' fault, not the rule's: nothing here
 * reaches a database.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scanSource } from "./like-token-scan.mjs";

const finds = (source) => scanSource(source).length;

describe("the drizzle binding root", () => {
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
