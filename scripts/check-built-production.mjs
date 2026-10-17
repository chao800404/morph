#!/usr/bin/env node
/**
 * Fails the build if the built Worker can decide it is not production.
 *
 * See `built-production-check.mjs` for why this runs the emitted predicates
 * instead of reading the source. Usage: `node scripts/check-built-production.mjs
 * [serverDir]`, defaulting to `dist/server`.
 */
import path from "node:path";

import { checkBuiltProduction } from "./built-production-check.mjs";

const serverDir = path.resolve(process.argv[2] ?? "dist/server");

try {
  const { checked, failures } = await checkBuiltProduction(serverDir);
  if (failures.length > 0) {
    console.error(
      `[check-built-production] FAIL — the built Worker can decide it is not production:\n  ${failures.join(
        "\n  ",
      )}\nA deployed Worker has neither CF_PAGES nor ENVIRONMENT, so it is production only because the build replaces process.env.NODE_ENV with "production". Build without NODE_ENV=development / --mode development, or restore the replacement; otherwise local-only paths open in production.`,
    );
    process.exit(1);
  }
  console.log(
    `[check-built-production] OK — answered true for bindings without CF_PAGES/ENVIRONMENT, with NODE_ENV unset or non-production: ${checked.join("; ")}.`,
  );
} catch (error) {
  console.error(`[check-built-production] FAIL — ${error?.message ?? error}`);
  process.exit(1);
}
