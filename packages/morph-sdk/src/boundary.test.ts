// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE = dirname(fileURLToPath(import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

/** Every module specifier a file names: static, re-exported or dynamic. */
function specifiers(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\b(?:import|export)\b[^'"`;]*?\bfrom\s*["'`]([^"'`]+)["'`]/g,
    /\bimport\s*["'`]([^"'`]+)["'`]/g,
    /\bimport\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /\brequire\s*\(\s*["'`]([^"'`]+)["'`]/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
}

describe("the SDK core depends on nothing but itself", () => {
  it("imports only its own files: no framework, no Morph server code, no package", () => {
    const files = sourceFiles(SOURCE);
    expect(files.length).toBeGreaterThan(0);
    const outside: string[] = [];
    for (const file of files) {
      for (const specifier of specifiers(readFileSync(file, "utf8"))) {
        const inside =
          specifier.startsWith("./") || specifier.startsWith("../")
            ? !relative(SOURCE, resolve(dirname(file), specifier)).startsWith(
                "..",
              )
            : false;
        if (!inside) outside.push(`${relative(SOURCE, file)} -> ${specifier}`);
      }
    }
    expect(outside).toEqual([]);
  });

  it("finds the imports it is meant to refuse", () => {
    // The scan above passing proves nothing if it cannot see an import.
    expect(
      specifiers(
        [
          'import React from "react";',
          'import { createIsomorphicFn } from "@tanstack/react-start";',
          'export { x } from "@/lib/storefront/theme-media";',
          'import "astro";',
          'const m = await import("../../../src/server");',
        ].join("\n"),
      ),
    ).toEqual([
      "react",
      "@tanstack/react-start",
      "@/lib/storefront/theme-media",
      "astro",
      "../../../src/server",
    ]);
  });
});
