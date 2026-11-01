#!/usr/bin/env node
/**
 * Copies the editor's preview protocol into the Theme workspace a Live
 * Preview server is served from.
 *
 * The bridge that talks to the editor runs inside a container that holds no
 * Morph code, so these modules have to travel with the Theme. Copying them at
 * build time — rather than restating them for the container — keeps one
 * source of truth for a security boundary: origin, message source, session
 * nonce and schema are all decided by the same code the editor was tested
 * against, and a change to it cannot leave a second copy behind.
 *
 * Cross-module types are erased rather than followed. Every one of them is
 * already `import type`, so nothing survives transpilation anyway, and
 * chasing them would drag Morph's database schema into a Theme.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFileIfChanged } from "./write-if-changed.mjs";
import { join } from "node:path";

const ROOT = process.cwd();
const EDITOR = "src/lib/storefront/editor";

/**
 * Modules the bridge needs from outside the editor directory.
 *
 * Copied flat into the same folder, so a relative import between copies
 * resolves whatever the module's own home is.
 */
const ELSEWHERE = {
  "source-location-key": "src/lib/storefront/ast/source-location-key.ts",
};
const OUT_RELATIVE =
  "src/lib/storefront/compiler/preview-bridge-sources.generated.ts";
const OUT = join(ROOT, OUT_RELATIVE);

const check = process.argv.includes("--check");

/**
 * The bridge's entry script is not a copied module: it is a TypeScript
 * function that returns the script as a string (theme-preview-bridge-entry.ts),
 * and it imports from Morph by alias, so this script cannot run it. Its
 * source file is hashed instead, together with the one file whose constants it
 * interpolates into that string (the other interpolated constant lives in
 * preview-empty-text-layout, which is already in MODULES). A change to either
 * file changes the hash even though neither is written into the output.
 */
const ENTRY_INPUTS = [
  "src/lib/storefront/compiler/theme-preview-bridge-entry.ts",
  "src/lib/storefront/compiler/theme-preview-diagnostic-script.ts",
];

/** Modules the bridge needs, in the order they are written. */
const MODULES = [
  "spacing-overlay",
  "selection-taxonomy",
  "preview-protocol",
  "preview-sizing-css",
  "preview-height-reporter",
  "preview-dom",
  "preview-empty-text-layout",
  "selection-overlay-geometry",
  "preview-selection-overlays",
  "selection-style-preview",
  "inline-text-edit",
  "inline-text-editor",
  "array-item-field-path",
  "source-location-key",
  "preview-reorder-identity",
];

/**
 * Type-only imports that point outside this set, and what to put in their
 * place so the copied module still reads as valid TypeScript.
 */
const ERASED_TYPES = {
  "@/db/storefront.schema": { StorefrontPageDocument: "any" },
  "@/db/json": { JsonValue: "unknown" },
  "./inspector-modules": { InspectorOverride: "unknown" },
};

/** Aliased imports that are values, and therefore have to be copied too. */
const REWRITTEN_IMPORTS = {
  "@/lib/storefront/ast/source-location-key": "./source-location-key",
};

const TYPE_IMPORT = /^import type \{([^}]*)\} from "([^"]+)";$/gm;

function eraseExternalTypes(source, modulePath) {
  return source.replace(TYPE_IMPORT, (match, names, from) => {
    const replacements = ERASED_TYPES[from];
    if (!replacements) return match;
    const aliases = names
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => {
        const replacement = replacements[name];
        if (!replacement) {
          throw new Error(
            `generate-preview-bridge-sources: ${modulePath} imports the type "${name}" from "${from}", which has no stand-in. Add one rather than letting the copied module reference a type the container cannot resolve.`,
          );
        }
        return `type ${name} = ${replacement};`;
      });
    return `// Erased: "${from}" is Morph's own, and these are types only.\n${aliases.join("\n")}`;
  });
}

const files = MODULES.map((name) => {
  const path = ELSEWHERE[name] ?? `${EDITOR}/${name}.ts`;
  const source = readFileSync(join(ROOT, path), "utf8");
  let content = eraseExternalTypes(source, path);
  for (const [from, to] of Object.entries(REWRITTEN_IMPORTS)) {
    content = content.replaceAll(`from "${from}"`, `from "${to}"`);
  }
  return { path: `src/morph/preview/${name}.ts`, content };
});

// Every import that survives has to resolve inside the copied set, whether it
// points at Morph by alias or at a sibling this list happens not to carry.
// Checking only the aliased ones let a new relative dependency through, and
// the container was the first thing to notice.
const copied = new Set(MODULES);
const unresolved = files.flatMap((file) =>
  [...file.content.matchAll(/from "([^"]+)"/g)]
    .map((match) => match[1])
    .filter(
      (specifier) =>
        specifier.startsWith("@/") ||
        // Any relative import, not just a sibling: a "../" one slipped past
        // an earlier version of this check and the container found it.
        (specifier.startsWith(".") &&
          !copied.has(specifier.replace(/^\.\/?/, ""))),
    )
    .map((specifier) => `${file.path} -> ${specifier}`),
);
if (unresolved.length > 0) {
  throw new Error(
    `generate-preview-bridge-sources: these would not resolve inside a Theme workspace:\n  ${unresolved.join("\n  ")}\nAdd the module to MODULES, or erase the type if it is only a type.`,
  );
}

/**
 * SHA-256 (hex) of the UTF-8 JSON of `[[path, content], ...]` over the copied
 * modules (as written into a Theme workspace) and the entry inputs above,
 * sorted by path. Same construction as MORPH_SDK_SOURCE_HASH. Any change to a
 * covered file's bytes, name, or the set of files changes it.
 */
const hashed = [
  ...files,
  ...ENTRY_INPUTS.map((path) => ({
    path,
    content: readFileSync(join(ROOT, path), "utf8"),
  })),
]
  // By UTF-16 code unit, not locale, so the hash does not depend on the machine.
  .sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
const sourceHash = createHash("sha256")
  .update(
    JSON.stringify(hashed.map((file) => [file.path, file.content])),
    "utf8",
  )
  .digest("hex");

const output = `/* eslint-disable */
// Generated by scripts/generate-preview-bridge-sources.mjs. Do not edit by hand.
// prettier-ignore
export const PREVIEW_BRIDGE_SOURCE_HASH = ${JSON.stringify(sourceHash)};
// prettier-ignore
export const GENERATED_PREVIEW_BRIDGE_SOURCES: ReadonlyArray<{ path: string; content: string }> = ${JSON.stringify(files, null, 2)};
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
      `${OUT_RELATIVE} is stale: it is not what scripts/generate-preview-bridge-sources.mjs produces from the preview bridge sources. Run pnpm generate:preview-bridge and commit the result.`,
    );
    process.exit(1);
  }
  console.log(
    `${OUT_RELATIVE} is current (PREVIEW_BRIDGE_SOURCE_HASH ${sourceHash}).`,
  );
} else {
  const written = writeFileIfChanged(OUT, output);
  console.log(
    `Copied ${files.length} preview bridge modules into the Theme workspace source set${written ? "" : " (unchanged)"}; PREVIEW_BRIDGE_SOURCE_HASH ${sourceHash}.`,
  );
}
