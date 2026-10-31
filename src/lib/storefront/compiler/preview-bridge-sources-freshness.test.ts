// @vitest-environment node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  GENERATED_PREVIEW_BRIDGE_SOURCES,
  PREVIEW_BRIDGE_SOURCE_HASH,
} from "./preview-bridge-sources.generated";

/**
 * The committed `preview-bridge-sources.generated.ts` is what a Live Preview
 * workspace is laid out from, and `PREVIEW_BRIDGE_SOURCE_HASH` names the bridge
 * it carries. Both must be exactly what the generator produces from the
 * editor's sources now. `pnpm test` does not run the generator, so a bridge
 * source changed without `pnpm generate:preview-bridge` fails here.
 */
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const GENERATED = join(
  ROOT,
  "src/lib/storefront/compiler/preview-bridge-sources.generated.ts",
);
// Keep in step with ENTRY_INPUTS in scripts/generate-preview-bridge-sources.mjs.
const ENTRY_INPUTS = [
  "src/lib/storefront/compiler/theme-preview-bridge-entry.ts",
  "src/lib/storefront/compiler/theme-preview-diagnostic-script.ts",
];

describe("the generated preview bridge sources", () => {
  it("are byte-identical to what the generator produces from the editor sources", () => {
    let failure: string | null = null;
    try {
      execFileSync(
        process.execPath,
        ["scripts/generate-preview-bridge-sources.mjs", "--check"],
        { cwd: ROOT, stdio: "pipe", encoding: "utf8" },
      );
    } catch (error) {
      const { stderr, stdout } = error as { stderr?: string; stdout?: string };
      failure = `${stderr ?? ""}${stdout ?? ""}` || String(error);
    }
    expect(failure).toBeNull();
  });

  it("carry PREVIEW_BRIDGE_SOURCE_HASH over the copied modules and the entry inputs, in path order", () => {
    const hashed = [
      ...GENERATED_PREVIEW_BRIDGE_SOURCES,
      ...ENTRY_INPUTS.map((path) => ({
        path,
        content: readFileSync(join(ROOT, path), "utf8"),
      })),
    ].sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
    const recomputed = createHash("sha256")
      .update(
        JSON.stringify(hashed.map((file) => [file.path, file.content])),
        "utf8",
      )
      .digest("hex");
    expect(PREVIEW_BRIDGE_SOURCE_HASH).toBe(recomputed);
  });

  it("say they are generated and must not be edited by hand", () => {
    const head = readFileSync(GENERATED, "utf8").split("\n").slice(0, 5);
    expect(head.join("\n")).toContain("Do not edit by hand");
    expect(head.join("\n")).toContain(
      "scripts/generate-preview-bridge-sources.mjs",
    );
  });
});
