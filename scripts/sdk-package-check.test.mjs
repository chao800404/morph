/**
 * What `sdk-package-check.mjs` has to refuse, and that the real package
 * passes.
 *
 * Run by `node --test`, not vitest: vitest collects `src/**` and
 * `packages/*\/src/**` only, so a test beside this script would never run.
 *
 * Each case copies the real package into a scratch directory and changes one
 * thing, so the package itself is never edited and every case differs from
 * the passing one by exactly that change. A copy sits outside the repository,
 * where nothing can be resolved from the app's `node_modules`; refusing an
 * undeclared dependency there and in place are both covered (the import scan
 * does not depend on resolution).
 */
import assert from "node:assert/strict";
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkSdkPackage,
  classifySpecifier,
  moduleSpecifiers,
} from "./sdk-package-check.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const realPackage = join(projectRoot, "packages", "morph-sdk");
const scratchRoot = mkdtempSync(join(tmpdir(), "morph-sdk-check-test-"));
after(() => rmSync(scratchRoot, { recursive: true, force: true }));

let copies = 0;
/** The real package, copied, with `change` applied to the copy. */
function packageWith(change) {
  copies += 1;
  const directory = join(scratchRoot, `case-${copies}`, "morph-sdk");
  cpSync(realPackage, directory, {
    recursive: true,
    filter: (source) => !/[\\/](?:node_modules|dist)(?:[\\/]|$)/.test(source),
  });
  change?.(directory);
  return directory;
}

const appendTo = (file, line) => (directory) =>
  appendFileSync(join(directory, file), `\n${line}\n`);

async function kindsFor(directory) {
  const scratch = mkdtempSync(join(scratchRoot, "out-"));
  const { findings } = await checkSdkPackage(directory, {
    scratch,
    aliases: ["@/", "@queries/", "@views/"],
  });
  return new Set(findings.map((finding) => finding.kind));
}

describe("the import scan", () => {
  it("sees every way a module can be named", () => {
    assert.deepEqual(
      moduleSpecifiers(
        [
          // A reference directive counts only before the first statement;
          // TypeScript reads one further down as a plain comment.
          '/// <reference types="node" />',
          'import React from "react";',
          'import type { X } from "type-only";',
          'export { y } from "@/lib/y";',
          'export * from "../outside";',
          'import "side-effect";',
          'const lazy = await import("dynamic");',
          'const old = require("required");',
        ].join("\n"),
      ).sort(),
      [
        "../outside",
        "@/lib/y",
        "dynamic",
        "node",
        "react",
        "required",
        "side-effect",
        "type-only",
      ],
    );
  });

  it("tells the four outcomes apart", () => {
    const context = {
      packageDir: "/repo/packages/morph-sdk",
      declared: new Set(["declared-dep", "@scope/dep"]),
      ownName: "@morph/sdk",
      aliases: ["@/"],
    };
    const file = "/repo/packages/morph-sdk/src/client.ts";
    const kind = (specifier) =>
      classifySpecifier(specifier, file, context)?.kind ?? null;
    assert.equal(kind("./errors"), null);
    assert.equal(kind("../package.json"), null);
    assert.equal(kind("declared-dep/sub"), null);
    assert.equal(kind("@scope/dep"), null);
    assert.equal(kind("@/lib/x"), "app-alias");
    assert.equal(kind("../../../src/server"), "escapes-package");
    assert.equal(kind("/repo/src/server"), "escapes-package");
    assert.equal(kind("react"), "undeclared-dependency");
    assert.equal(kind("@scope/other"), "undeclared-dependency");
    assert.equal(kind("node:fs"), "undeclared-dependency");
    assert.equal(kind("fs"), "undeclared-dependency");
  });
});

describe("the package check", () => {
  it("passes the real package, copied as it is", async () => {
    assert.deepEqual([...(await kindsFor(packageWith()))], []);
  });

  it("passes the real package in place and bundles it for all three targets", async () => {
    const scratch = mkdtempSync(join(scratchRoot, "out-"));
    const { findings, checked } = await checkSdkPackage(realPackage, {
      scratch,
      aliases: ["@/"],
    });
    assert.deepEqual(findings, []);
    assert.deepEqual(
      checked.bundles.map((each) => each.target),
      ["browser", "worker", "node"],
    );
  });

  it("refuses an app alias", async () => {
    const kinds = await kindsFor(
      packageWith(
        appendTo("src/urls.ts", 'export { x } from "@/lib/storefront/x";'),
      ),
    );
    assert.ok(kinds.has("app-alias"), [...kinds].join());
  });

  it("refuses a relative import out of the package", async () => {
    const kinds = await kindsFor(
      packageWith(
        appendTo("src/urls.ts", 'export { x } from "../../../src/server";'),
      ),
    );
    assert.ok(kinds.has("escapes-package"), [...kinds].join());
  });

  it("refuses an escape to a file that exists, and writes nothing beside it", async () => {
    // An earlier version emitted the compile to disk: a file reached from
    // outside `rootDir` was written next to its own source, into the app.
    const directory = packageWith((dir) => {
      mkdirSync(join(dir, "..", "src"), { recursive: true });
      writeFileSync(
        join(dir, "..", "src", "server.ts"),
        "export const x = 1;\n",
      );
      appendTo("src/urls.ts", 'export { x } from "../../src/server";')(dir);
    });
    const kinds = await kindsFor(directory);
    assert.ok(kinds.has("escapes-package"), [...kinds].join());
    assert.deepEqual(readdirSync(join(directory, "..", "src")), ["server.ts"]);
  });

  it("refuses an undeclared dependency", async () => {
    const kinds = await kindsFor(
      packageWith(appendTo("src/urls.ts", 'export { clsx } from "clsx";')),
    );
    assert.ok(kinds.has("undeclared-dependency"), [...kinds].join());
  });

  it("refuses a build error", async () => {
    const kinds = await kindsFor(
      packageWith(
        appendTo("src/urls.ts", 'export const broken: number = "text";'),
      ),
    );
    assert.deepEqual([...kinds], ["build"]);
  });

  it("refuses a config that borrows the app's paths", async () => {
    const kinds = await kindsFor(
      packageWith((directory) => {
        const path = join(directory, "tsconfig.json");
        writeFileSync(
          path,
          readFileSync(path, "utf8").replace(
            '"types": [],',
            '"types": [],\n    "paths": { "@/*": ["../../src/*"] },',
          ),
        );
      }),
    );
    assert.ok(kinds.has("config"), [...kinds].join());
  });
});
