/**
 * Refuses a `LIKE` spelled outside `src/lib/db/like-query.ts`.
 *
 * The rules live in `like-token-scan.mjs` and are tested by
 * `like-token-scan.test.mjs`; this walks the trees and reports. Keeping the
 * three apart is deliberate: the scanner is a pure function, its tests are an
 * independent witness, and this file only decides what to read and what to say.
 *
 * Two trees. `src/**` is the application. `scripts/**` is included because
 * several scripts there write raw SQL against the same database, and excluding a
 * tree that costs nothing to scan would need a reason of its own — today it
 * contributes no findings, which is exactly what including it is for.
 *
 * `drizzle/` is out of scope, named rather than silently skipped: those
 * migrations are applied history, so a finding there is not actionable. 0054
 * contains a GLOB that cannot be edited now. A guard that quietly narrows its
 * own scope is a selector narrower than its stated intent, which is the same
 * class of mistake as one that is wider.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { scanSource } from "./like-token-scan.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * One entry: the module the rule exists to concentrate everything into.
 *
 * It is one entry because the scan is parsed rather than matched. A
 * pattern-based version needed three more — the generated preview bridge, a file
 * whose `return `...`` read as a tagged template, and the scanner itself, whose
 * regexes contain backticks — and every one of those was an exception bought to
 * cover an unsound rule. `like-token-scan.test.mjs` holds each forbidden shape as
 * a fixture and needs no entry either: the fixtures are string literals, and a
 * parser sees a string where a pattern saw an import.
 *
 * An entry here needs a reason beside it. A list that accepts bare additions
 * becomes the place where care is no longer required, which is the shape this
 * guard exists to remove.
 */
const ALLOWED_FILES = new Set(["src/lib/db/like-query.ts"]);

function collectSources(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...collectSources(full));
    else if (/\.(ts|tsx|mjs)$/.test(entry)) found.push(full);
  }
  return found;
}

const findings = [];
for (const tree of ["src", "scripts"]) {
  for (const file of collectSources(join(projectRoot, tree))) {
    const relativePath = relative(projectRoot, file);
    if (ALLOWED_FILES.has(relativePath)) continue;
    for (const finding of scanSource(readFileSync(file, "utf8"))) {
      findings.push({ file: relativePath, ...finding });
    }
  }
}

if (findings.length > 0) {
  console.error(
    `\n[check-like-tokens] ${findings.length} place(s) spell LIKE outside src/lib/db/like-query.ts:\n`,
  );
  for (const { file, line, found } of findings) {
    console.error(`  ${file}:${line}\n    → ${found}`);
  }
  console.error(
    "\nRoute them through the builders in src/lib/db/like-query.ts:" +
      "\n  likeContains(column, term)  a contains-search, term fitted to the 50-byte cap" +
      "\n  likePrefix(column, prefix)  a namespaced prefix; throws rather than truncate" +
      "\n  sqlContains(column, term)   for an array column, which like() cannot match inside" +
      "\nA hierarchical path wants none of these — use a half-open range, as in" +
      " startsWithPrefix (src/lib/asset/dal/asset-folder.dal.ts).\n",
  );
  process.exit(1);
}

console.log(
  "[check-like-tokens] OK — LIKE is spelled only in src/lib/db/like-query.ts.",
);
