#!/usr/bin/env node
/**
 * Fails the build if the local preview sidecar is in the deploy artifact.
 *
 * The sidecar is a remote-code-execution primitive by design: it takes a file
 * layout and runs a dev server over it. It belongs on a developer's machine and
 * nowhere else, and "nowhere else" has to be enforced rather than intended —
 * one import added to a Worker-reachable module would put it there, and nothing
 * about the resulting build would look wrong.
 *
 * The markers are string literals from
 * `src/lib/storefront/service/local-preview-sidecar.ts`. That file is read first
 * and the markers are asserted to still be in it, so deleting or renaming them
 * makes this guard fail loudly instead of passing vacuously. The client half
 * (`local-preview-sidecar-client.ts`) is *expected* in the artifact: it only
 * makes fetch calls, and it is how the Worker reaches an operator-started
 * sidecar at all.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sidecarPath = path.join(
  root,
  "src/lib/storefront/service/local-preview-sidecar.ts",
);
const distPath = path.join(root, "dist");

const MARKERS = [
  "LOCAL_PREVIEW_SIDECAR_REFUSED",
  "LOCAL_PREVIEW_SIDECAR_UNAUTHORIZED",
  "LOCAL_PREVIEW_SIDECAR_METHOD",
  "LOCAL_PREVIEW_SIDECAR_BAD_JSON",
  "LOCAL_PREVIEW_SIDECAR_NOT_FOUND",
  "LOCAL_PREVIEW_SIDECAR_FAILED",
];

const source = fs.readFileSync(sidecarPath, "utf8");
const missing = MARKERS.filter((marker) => !source.includes(marker));
if (missing.length > 0) {
  console.error(
    `[check-local-preview-sidecar] FAIL — the guard can no longer see ${missing.join(", ")} in ${path.relative(root, sidecarPath)}. The sidecar's markers moved or were renamed; update this guard rather than letting it pass without checking anything.`,
  );
  process.exit(1);
}

/** Every file under a directory, for a scan that is not fooled by nesting. */
function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

if (!fs.existsSync(distPath)) {
  console.error(
    "[check-local-preview-sidecar] FAIL — dist/ does not exist. Run this after `vite build`.",
  );
  process.exit(1);
}

const offenders = [];
let scanned = 0;
for (const file of walk(distPath)) {
  if (!/\.(js|mjs|cjs|json|map)$/.test(file)) continue;
  scanned += 1;
  const content = fs.readFileSync(file, "utf8");
  for (const marker of MARKERS) {
    if (content.includes(marker)) {
      offenders.push(`${path.relative(root, file)} (${marker})`);
      break;
    }
  }
}

if (offenders.length > 0) {
  console.error(
    `[check-local-preview-sidecar] FAIL — the local preview sidecar is reachable from the deploy artifact:\n  ${offenders.join("\n  ")}\nIt executes Theme code on the machine it runs on, and must not ship.`,
  );
  process.exit(1);
}

console.log(
  `[check-local-preview-sidecar] OK — scanned ${scanned} files, the sidecar is not in the deploy artifact.`,
);
