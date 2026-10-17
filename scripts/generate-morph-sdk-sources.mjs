#!/usr/bin/env node
/**
 * Copies the Morph SDK and its Start thin entry into the source set a Theme
 * build workspace is laid out from (SPIKE, M1b/M1c).
 *
 * A Theme's build runs where no Morph code is installed: the container holds
 * the pinned toolchain only. So the SDK travels with the workspace, as the
 * preview bridge does (generate-preview-bridge-sources.mjs), and the build's
 * config resolves `@morph/sdk` and `@morph/sdk/start` to this copy. One
 * source of truth: the files are `packages/morph-sdk/` as tested, never a
 * second version restated for the container, and never part of the Theme's
 * own source.
 *
 * This script is the only way the generated module is produced. It is run by
 * hand (`pnpm generate:morph-sdk`) and its output is committed; it is not a
 * pre-step of typecheck, test or build, so a stale committed copy cannot be
 * repaired silently before the check below sees it.
 *
 *   node scripts/generate-morph-sdk-sources.mjs          writes the module
 *   node scripts/generate-morph-sdk-sources.mjs --check  writes nothing; exits
 *     1 when the committed module differs from what would be written
 *
 * `--check` is what morph-sdk-sources-freshness.test.ts runs.
 *
 * The module also carries `MORPH_SDK_SOURCE_HASH`: SHA-256 over the copied
 * files, which is how a build names the SDK it was built with
 * (theme-morph-sdk.ts).
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileIfChanged } from "./write-if-changed.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGE = "packages/morph-sdk";
/** Directories copied, each by its name under the workspace's SDK root. */
const DIRECTORIES = ["src", "start"];
/** Where the copy lives in a workspace. Platform-owned, see theme-morph-sdk.ts. */
const WORKSPACE_ROOT = ".morph/sdk";
/** Bare imports the copy may make: the Start runtime the thin entry wraps. */
const ALLOWED_PACKAGES = new Set([
  "@tanstack/react-start",
  "@tanstack/react-start/server",
]);
const OUT_RELATIVE = "src/lib/storefront/compiler/morph-sdk-sources.generated.ts";
const OUT = join(ROOT, OUT_RELATIVE);

const check = process.argv.includes("--check");

const files = DIRECTORIES.flatMap((directory) =>
  readdirSync(join(ROOT, PACKAGE, directory))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => ({
      path: `${WORKSPACE_ROOT}/${directory}/${name}`,
      content: readFileSync(join(ROOT, PACKAGE, directory, name), "utf8"),
    })),
)
  // By UTF-16 code unit, not locale: the order, and so the hash, must not
  // depend on the machine that runs this.
  .sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );

// Every import must land inside the copy or on an allowed package; anything
// else would fail in the container, where nothing else of Morph exists.
const copied = new Set(files.map((file) => file.path));
const unresolved = files.flatMap((file) =>
  [...file.content.matchAll(/\bfrom\s+"([^"]+)"/g)]
    .map((match) => match[1])
    .filter((specifier) => {
      if (!specifier.startsWith(".")) return !ALLOWED_PACKAGES.has(specifier);
      const target = posix.normalize(
        posix.join(posix.dirname(file.path), specifier),
      );
      return !copied.has(target) && !copied.has(`${target}.ts`);
    })
    .map((specifier) => `${file.path} -> ${specifier}`),
);
if (unresolved.length > 0) {
  throw new Error(
    `generate-morph-sdk-sources: these would not resolve inside a Theme workspace:\n  ${unresolved.join("\n  ")}`,
  );
}

/**
 * SHA-256 (hex) of the UTF-8 JSON of `[[path, content], ...]` in the order
 * above. Any change to a copied file's bytes, name, or the set of files
 * changes it.
 */
const sourceHash = createHash("sha256")
  .update(
    JSON.stringify(files.map((file) => [file.path, file.content])),
    "utf8",
  )
  .digest("hex");

const output = `/* eslint-disable */
// GENERATED FILE. DO NOT EDIT BY HAND.
// Produced by scripts/generate-morph-sdk-sources.mjs from packages/morph-sdk/{src,start}.
// After changing the SDK, run: pnpm generate:morph-sdk
// morph-sdk-sources-freshness.test.ts fails while this file is stale.
// prettier-ignore
export const MORPH_SDK_SOURCE_HASH = ${JSON.stringify(sourceHash)};
// prettier-ignore
export const GENERATED_MORPH_SDK_SOURCES: ReadonlyArray<{ path: string; content: string }> = ${JSON.stringify(files, null, 2)};
`;

if (check) {
  let current = null;
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    current = null;
  }
  if (current !== output) {
    console.error(
      `${OUT_RELATIVE} is stale: it is not what scripts/generate-morph-sdk-sources.mjs produces from packages/morph-sdk. Run pnpm generate:morph-sdk and commit the result.`,
    );
    process.exit(1);
  }
  console.log(
    `${OUT_RELATIVE} is current (MORPH_SDK_SOURCE_HASH ${sourceHash}).`,
  );
} else {
  const written = writeFileIfChanged(OUT, output);
  console.log(
    `Copied ${files.length} Morph SDK modules into the Theme workspace source set${written ? "" : " (unchanged)"}; MORPH_SDK_SOURCE_HASH ${sourceHash}.`,
  );
}
