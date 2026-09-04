#!/usr/bin/env node
/**
 * Enforces Rule 14.1 in the data-access layer.
 *
 * Compiles with `noUncheckedIndexedAccess` (see tsconfig.strict.json) and fails
 * only on diagnostics inside the DAL, storage and server-function layers. An
 * absent row there is a real failure mode; in UI, AST and test code the same
 * flag is mostly noise, so those diagnostics are ignored rather than suppressed
 * with assertions that would hide genuine absence.
 *
 * Widen ENFORCED_PATHS as other areas are brought up to the flag.
 */
import { spawnSync } from "node:child_process";

const ENFORCED_PATHS = [
  /^src\/lib\/[a-z-]+\/dal\//,
  /^src\/lib\/storefront\/storage\//,
  /^src\/server\//,
];

const isEnforced = (file) =>
  !file.includes(".test.") && ENFORCED_PATHS.some((re) => re.test(file));

const result = spawnSync(
  "node",
  ["node_modules/typescript/bin/tsc", "-p", "tsconfig.strict.json", "--noEmit"],
  { encoding: "utf8" },
);

const diagnostics = `${result.stdout ?? ""}`
  .split("\n")
  .filter((line) => /error TS\d+/.test(line))
  .filter((line) => isEnforced(line.split("(")[0].replaceAll("\\", "/")));

if (diagnostics.length > 0) {
  console.error(
    `[typecheck-data-layer] ${diagnostics.length} unchecked index access(es) in the data layer.\n` +
      "Single-row reads must use firstOrNull()/mapFirstOrNull() so 'not found' stays visible.\n",
  );
  for (const line of diagnostics) console.error(line);
  process.exit(1);
}

console.log("[typecheck-data-layer] OK — data layer is clean under noUncheckedIndexedAccess.");
