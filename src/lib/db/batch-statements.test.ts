// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Statement shapes that fail in the running app while the better-sqlite3
 * stand-in lets them through, found by reading the source, since the unit
 * tests cannot see them fail.
 * d1-batch.integration.test.ts shows both failing on real D1.
 *
 * - `db.run(sql\`…${value}…\`)`, or `db.run(helper())` returning one: a raw
 *   statement with a bound value. Inside
 *   `db.batch` it throws in drizzle's D1 driver. Use `batchGuard` for a
 *   precondition and a query builder (`insert`/`update`/`insert().select()`)
 *   for a write.
 * - `EXISTS (${builder})`: drizzle already parenthesises an interpolated
 *   query builder, and the doubled parentheses are a syntax error in D1.
 *   Write `EXISTS ${builder}`. A `sql` fragment is not parenthesised, so
 *   `EXISTS (${fragment})` is right and is not flagged.
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The template body starting at `start`, through its closing backtick. */
function templateBody(text: string, start: number): string {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (depth === 0 && text[i] === "`") return text.slice(start, i);
    if (text.startsWith("${", i)) {
      depth += 1;
      i += 1;
    } else if (depth > 0 && text[i] === "{") depth += 1;
    else if (depth > 0 && text[i] === "}") depth -= 1;
  }
  return text.slice(start);
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(process.cwd(), path),
  text: readFileSync(path, "utf8"),
}));
const lineOf = (text: string, index: number) =>
  text.slice(0, index).split("\n").length;

describe("statements a D1 batch can carry", () => {
  it("has no raw db.run(sql) with a bound value", () => {
    const found: string[] = [];
    for (const { path, text } of files) {
      for (const match of text.matchAll(/db\.run\(\s*sql`/g)) {
        const body = templateBody(text, match.index! + match[0].length);
        if (body.includes("${"))
          found.push(`${path}:${lineOf(text, match.index!)}`);
      }
    }
    expect(found).toEqual([]);
  });

  // A helper that returns the raw statement hides the template from the
  // check above: `db.run(versionGuard({…}))` broke creating a return. Every
  // raw statement here is batched, so none is allowed outside comments.
  it("has no raw db.run(…) statement at all", () => {
    const found: string[] = [];
    for (const { path, text } of files) {
      text.split("\n").forEach((line, index) => {
        const code = line.trim();
        if (code.startsWith("//") || code.startsWith("*")) return;
        if (/\b(?:db|tx)\.run\(/.test(code.replace(/\/\/.*$/, "")))
          found.push(`${path}:${index + 1}`);
      });
    }
    expect(found).toEqual([]);
  });

  // json_each yields a string element as plain text, and json_extract on
  // plain text raises "malformed JSON" — which the guards read as "the
  // condition failed". Confirming any draft order edit failed that way.
  it("does not json_extract a json_each value", () => {
    const found: string[] = [];
    for (const { path, text } of files) {
      for (const match of text.matchAll(
        /json_extract\(\s*(?:\w+\.)?value\s*,\s*'\$'\s*\)/g,
      ))
        found.push(`${path}:${lineOf(text, match.index!)}`);
    }
    expect(found).toEqual([]);
  });

  it("puts no query builder inside EXISTS (…)", () => {
    const found: string[] = [];
    for (const { path, text } of files) {
      for (const match of text.matchAll(
        /EXISTS\s*\(\s*\$\{\s*(\w+)\s*\}\s*\)/g,
      )) {
        const name = match[1]!;
        const definition = [
          ...text
            .slice(0, match.index)
            .matchAll(
              new RegExp(
                `(?:const|let)\\s+${name}\\b[^=]*=\\s*([^;]{0,40})`,
                "g",
              ),
            ),
        ].at(-1)?.[1];
        // A builder starts from the database handle or a select.
        if (definition && /^(db|tx)\b|\.select\(/.test(definition.trim())) {
          found.push(`${path}:${lineOf(text, match.index!)} ${name}`);
        }
      }
    }
    expect(found).toEqual([]);
  });
});
