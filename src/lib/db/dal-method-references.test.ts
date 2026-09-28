// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A DAL method handed on as a value — `setCartCredit: cartDal.setStoreCredit`
 * in a service's dependencies — is called without its object, so `this` inside
 * it is undefined. Applying a gift card to a cart failed on every attempt that
 * way ("this.findById is not a function"), while the service's unit tests,
 * which inject fakes, passed.
 *
 * So a method that uses `this` must only ever be called through its object.
 * A method that is passed on names its object instead (`cartDal.findById`).
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(process.cwd(), path),
  text: readFileSync(path, "utf8"),
}));

/** Methods of each exported object literal that use `this`. */
function methodsUsingThis(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const { text } of files) {
    for (const match of text.matchAll(/export const (\w+) = \{\n/g)) {
      const start = match.index! + match[0].length;
      const end = text.indexOf("\n};", start);
      const body = `\n${text.slice(start, end)}`;
      for (const method of body.split(/\n {2}(?=(?:async )?\w+\()/)) {
        const name = /^(?:async )?(\w+)\(/.exec(method)?.[1];
        if (name && method.includes("this.")) {
          const methods = found.get(match[1]!) ?? new Set<string>();
          methods.add(name);
          found.set(match[1]!, methods);
        }
      }
    }
  }
  return found;
}

describe("DAL methods that use this", () => {
  it("are never passed on without their object", () => {
    const found: string[] = [];
    for (const [object, methods] of methodsUsingThis()) {
      for (const method of methods) {
        const reference = new RegExp(
          `(?<!typeof\\s+)\\b${object}\\.${method}\\b(?!\\s*[(<])`,
          "g",
        );
        for (const { path, text } of files) {
          for (const match of text.matchAll(reference)) {
            const line = text.slice(0, match.index).split("\n").length;
            found.push(`${path}:${line} ${object}.${method}`);
          }
        }
      }
    }
    expect(found).toEqual([]);
  });
});
