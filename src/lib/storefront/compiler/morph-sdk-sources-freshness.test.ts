// @vitest-environment node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  GENERATED_MORPH_SDK_SOURCES,
  MORPH_SDK_SOURCE_HASH,
} from "./morph-sdk-sources.generated";

/**
 * The committed `morph-sdk-sources.generated.ts` is what every preview and
 * build injects, so it must be exactly what the generator produces from
 * `packages/morph-sdk/` now. The generator is not a pre-step of typecheck,
 * test or build (it would repair a stale copy before anyone saw it), so this
 * is the check: an SDK change committed without `pnpm generate:morph-sdk`
 * fails here.
 */
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const GENERATED = join(
  ROOT,
  "src/lib/storefront/compiler/morph-sdk-sources.generated.ts",
);

describe("the generated Morph SDK sources", () => {
  it("are byte-identical to what the generator produces from packages/morph-sdk", () => {
    let failure: string | null = null;
    try {
      execFileSync(
        process.execPath,
        ["scripts/generate-morph-sdk-sources.mjs", "--check"],
        { cwd: ROOT, stdio: "pipe", encoding: "utf8" },
      );
    } catch (error) {
      const { stderr, stdout } = error as { stderr?: string; stdout?: string };
      failure = `${stderr ?? ""}${stdout ?? ""}` || String(error);
    }
    expect(failure).toBeNull();
  });

  it("carry MORPH_SDK_SOURCE_HASH over exactly the copied files, in path order", () => {
    const paths = GENERATED_MORPH_SDK_SOURCES.map((file) => file.path);
    expect(paths).toEqual([...paths].sort());
    const recomputed = createHash("sha256")
      .update(
        JSON.stringify(
          GENERATED_MORPH_SDK_SOURCES.map((file) => [file.path, file.content]),
        ),
        "utf8",
      )
      .digest("hex");
    expect(MORPH_SDK_SOURCE_HASH).toBe(recomputed);
  });

  it("say they are generated and must not be edited by hand", () => {
    const head = readFileSync(GENERATED, "utf8").split("\n").slice(0, 5);
    expect(head.join("\n")).toContain("GENERATED FILE. DO NOT EDIT BY HAND.");
    expect(head.join("\n")).toContain("scripts/generate-morph-sdk-sources.mjs");
  });
});
