/**
 * Refuses a second place that builds the preview's content messages (G1).
 *
 * The rule lives in `preview-message-poster-scan.mjs` and is tested by
 * `preview-message-poster-scan.test.mjs`; this walks `src/` and reports.
 * The findings that are not posters, and how many of each, are listed there
 * too (`UNCLASSIFIED_ALLOWED`), so the fixtures exercise the same list.
 *
 * `src/` only: it is the editor, and the only code that posts to a preview
 * frame. Test files are left out — they play the preview, and a test posting a
 * message to drive a handler is not the editor posting one. `scripts/` holds
 * no poster and is not read; the scanner's own fixtures live there.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { applyAllowList, scanSource } from "./preview-message-poster-scan.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function collectSources(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...collectSources(full));
    else if (/\.(ts|tsx|mjs)$/.test(entry) && !/\.test\.(ts|tsx|mjs)$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

const all = [];
for (const file of collectSources(join(projectRoot, "src"))) {
  const relativePath = relative(projectRoot, file).split(sep).join("/");
  for (const finding of scanSource(readFileSync(file, "utf8"), relativePath)) {
    all.push({ file: relativePath, ...finding });
  }
}
const { unexcused, miscounted } = applyAllowList(all);

if (unexcused.length > 0) {
  console.error(
    `\n[check-preview-message-posters] ${unexcused.length} place(s) build a preview content message outside its one poster:\n`,
  );
  for (const { file, line, message, kind, owner } of unexcused) {
    console.error(
      `  ${file}:${line}\n    → ${message} (${kind}${owner ? ` in ${owner}` : ""})`,
    );
  }
  console.error(
    "\nPost section content through postPreviewSectionProps and selection-field" +
      " text through previewSelectionField (visual-editor-shell.tsx). Both decide" +
      " there whether the section is hidden, and a hidden section's values must" +
      " not reach the preview page.\n",
  );
}
if (miscounted.length > 0) {
  console.error(
    `\n[check-preview-message-posters] ${miscounted.length} allow-list entr(ies) do not match what they expect:\n`,
  );
  for (const { file, message, kind, owner, text, count, found } of miscounted) {
    console.error(
      `  ${file} — ${message} (${kind}${owner ? ` in ${owner}` : ""}${text ? `, "${text}"` : ""}): expected ${count}, found ${found}`,
    );
  }
  console.error(
    "\nAn entry that matches nothing is stale and is removed; one that matches" +
      " more than it expects is excusing a new use, which is reviewed rather than" +
      " counted in.\n",
  );
}
if (unexcused.length > 0 || miscounted.length > 0) process.exit(1);

console.log(
  "[check-preview-message-posters] OK — each preview content message is built in its one poster.",
);
