/**
 * Refuses a second place that builds the preview's content messages (G1).
 *
 * The rule lives in `preview-message-poster-scan.mjs` and is tested by
 * `preview-message-poster-scan.test.mjs`; this walks `src/` and reports.
 *
 * `src/` only: it is the editor, and the only code that posts to a preview
 * frame. Test files are left out — they play the preview, and a test posting a
 * message to drive a handler is not the editor posting one. `scripts/` holds
 * no poster and is not read; the scanner's own fixtures live there.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { scanSource } from "./preview-message-poster-scan.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Uses of a guarded type the scanner cannot classify, each with its reason.
 * Keyed by file, message and kind, so an entry cannot excuse a message built
 * in the same file.
 */
const UNCLASSIFIED_ALLOWED = [
  {
    file: "src/routes/_editor/store/$storefrontId/themes/$themeId/preview.tsx",
    message: "morph:storefront-preview-update-section-props",
    kind: "other",
    // Morph's own preview route lists the messages after which it measures
    // again. It receives them; it posts none.
    reason: "receive-side set of messages that change the page's geometry",
  },
  // A fragment entry names its exact text too, so it excuses that one piece
  // and not any other piece of a guarded type in the same file.
  ...[
    "morph:storefront-preview-update-section-props",
    "morph:storefront-preview-update-selection-field",
  ].map((message) => ({
    file: "src/routes/_editor/-components/visual-editor-shell.tsx",
    message,
    kind: "fragment",
    text: "morph:storefront-preview-",
    // The development warning for a message the parser rejected checks the
    // received type's namespace. It reads a message; it builds none.
    reason: "receive-side namespace test on a rejected preview message",
  })),
];

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

const findings = [];
for (const file of collectSources(join(projectRoot, "src"))) {
  const relativePath = relative(projectRoot, file).split(sep).join("/");
  for (const finding of scanSource(readFileSync(file, "utf8"), relativePath)) {
    const allowed = UNCLASSIFIED_ALLOWED.some(
      (entry) =>
        entry.file === relativePath &&
        entry.message === finding.message &&
        entry.kind === finding.kind &&
        (entry.text === undefined || entry.text === finding.text),
    );
    if (!allowed) findings.push({ file: relativePath, ...finding });
  }
}

if (findings.length > 0) {
  console.error(
    `\n[check-preview-message-posters] ${findings.length} place(s) build a preview content message outside its one poster:\n`,
  );
  for (const { file, line, message, kind, owner } of findings) {
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
  process.exit(1);
}

console.log(
  "[check-preview-message-posters] OK — each preview content message is built in its one poster.",
);
