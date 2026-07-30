import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findCycles, findServerReach, formatChain } from "./module-graph";

/**
 * The guard for the two module-graph properties.
 *
 * This is here because the failure it prevents is invisible until it is
 * expensive: `Cannot access 'listProducts' before initialization`, thrown from a
 * file that did nothing wrong, fixed only by restarting the dev server. `tsc`
 * and the build both pass with the cycle in place.
 */

const ROOT = process.cwd();

const serverFunctionFiles = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((entry) => {
    const relative = `${dir}/${entry}`;
    if (statSync(join(ROOT, relative)).isDirectory()) {
      return serverFunctionFiles(relative);
    }
    return entry.endsWith(".serverFn.ts") ? [relative] : [];
  });

describe("module graph", () => {
  it("has no import cycles", () => {
    // Every real entry point: the config, the route tree, and each server
    // function, since a request enters through one of those.
    const entries = [
      "src/cms.config.ts",
      "src/routeTree.gen.ts",
      ...serverFunctionFiles("src/server"),
    ];

    const cycles = findCycles(ROOT, entries).map(formatChain);

    expect(cycles).toEqual([]);
  });

  it("keeps cms.config out of the server graph", () => {
    // Config is evaluated on both sides. A static edge to a server function
    // pulls the DAL, the D1 binding and the auth middleware in with it, and is
    // what closed the cycles this suite exists to catch.
    const chains = findServerReach(ROOT, "src/cms.config.ts").map(formatChain);

    expect(chains).toEqual([]);
  });
});
