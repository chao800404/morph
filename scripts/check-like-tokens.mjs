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
 * Exceptions, scoped to the root each one is needed for.
 *
 * Two sets rather than one list of exempt files, so an exception cannot reach
 * further than its reason. `like-pattern.test.ts` has to import the arithmetic —
 * pinning the byte cap is what it exists for — but that is no reason to stop
 * checking it for queries, and a whole-file exemption would have done exactly
 * that. Selector no wider than the intent, applied to this guard's own escapes.
 *
 * Each entry needs a reason beside it. A list that accepts bare additions
 * becomes the place where care is no longer required, which is the shape this
 * guard exists to remove.
 */
const MAY_SPELL_LIKE = new Set([
  // The module the rule exists to concentrate every spelling into.
  "src/lib/db/like-query.ts",
]);

const MAY_HOLD_A_PATTERN = new Set([
  // Builds them, so it must be able to call them.
  "src/lib/db/like-query.ts",
  // Pins the 50-byte arithmetic itself, including the boundary and the refusal.
  "src/lib/db/like-pattern.test.ts",
]);

/** Which findings this file is excused from, by root. */
function isAllowed(relativePath, root) {
  return root === "pattern-import"
    ? MAY_HOLD_A_PATTERN.has(relativePath)
    : MAY_SPELL_LIKE.has(relativePath);
}

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
    for (const finding of scanSource(readFileSync(file, "utf8"), relativePath)) {
      if (isAllowed(relativePath, finding.root)) continue;
      findings.push({ file: relativePath, ...finding });
    }
  }
}

if (findings.length > 0) {
  console.error(
    `\n[check-like-tokens] ${findings.length} place(s) reach past src/lib/db/like-query.ts:\n`,
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
      " startsWithPrefix (src/lib/asset/dal/asset-folder.dal.ts)." +
      "\n\nThe builders take a term, never a pattern, and an `imports" +
      " containsPattern` finding is why that distinction is enforced instead of" +
      " remembered: likeContains(column, containsPattern(term)) type-checks —" +
      " both are strings — and wraps the term twice. SQL collapses the doubled" +
      " `%`, so nothing looks wrong, while the extra characters sit inside the" +
      " 50-byte budget: at the cap a single wrap keeps 16 Chinese characters and a" +
      " double wrap keeps 15, and it does not error. Delete the local" +
      " `const pattern = …` binding and pass the term.\n",
  );
  process.exit(1);
}

console.log(
  "[check-like-tokens] OK — LIKE is spelled only in src/lib/db/like-query.ts.",
);
