import path from "node:path";
import { describe, expect, it } from "vitest";

// Imported across the src/scripts boundary on purpose. The logic under test
// lives in the end-to-end runner, which is not TypeScript and is not covered by
// vitest's `src/**/*.test.{ts,tsx}` include — so a test placed beside it would
// never run, and a guard that never runs is the thing this repo keeps removing.
import { containedPath } from "../../../../scripts/verify-published-artifact.mjs";

/**
 * The reconstruction guard, tested because it decides what gets overwritten.
 *
 * A build manifest names the paths the verifier writes. It is written by Morph
 * and read back from Morph's own bucket, so this is not defence against an
 * attacker — it is defence against a manifest that is wrong, which would
 * otherwise write outside the run's temporary directory using the privileges of
 * whoever started the suite. The artifact store already refuses paths that
 * escape the prefix on the way in (`ARTIFACT_CONTAINMENT_BREACH`); this owes the
 * same containment on the way out.
 */
describe("artifact reconstruction containment", () => {
  const root = "/tmp/morph-e2e-artifact";

  it("keeps ordinary nested paths", () => {
    expect(containedPath(root, "server/index.js")).toBe(
      path.resolve(root, "server/index.js"),
    );
    expect(containedPath(root, "client/assets/index-ab12.js")).toBe(
      path.resolve(root, "client/assets/index-ab12.js"),
    );
  });

  it("refuses a path that climbs out of the root", () => {
    expect(() => containedPath(root, "../escaped.js")).toThrow(
      /ARTIFACT_PATH_ESCAPES_ROOT/,
    );
    // Climbing and coming back is still a write outside the root on the way
    // through, and `..` buried mid-path is the form a broken join produces.
    expect(() => containedPath(root, "server/../../escaped.js")).toThrow(
      /ARTIFACT_PATH_ESCAPES_ROOT/,
    );
  });

  it("refuses an absolute path outright", () => {
    expect(() => containedPath(root, "/etc/hosts")).toThrow(
      /ARTIFACT_PATH_ABSOLUTE/,
    );
    expect(() =>
      containedPath(
        root,
        "C:\\\\Windows\\\\System32\\\\drivers\\\\etc\\\\hosts",
      ),
    ).toThrow(/ARTIFACT_PATH_ABSOLUTE/);
    expect(() =>
      containedPath(root, "\\\\server\\\\share\\\\artifact.js"),
    ).toThrow(/ARTIFACT_PATH_ABSOLUTE/);
  });

  it("normalizes Windows separators before checking containment", () => {
    expect(containedPath(root, "server\\\\index.js")).toBe(
      path.resolve(root, "server/index.js"),
    );
    expect(() =>
      containedPath(root, "server\\\\..\\\\..\\\\escaped.js"),
    ).toThrow(/ARTIFACT_PATH_ESCAPES_ROOT/);
  });

  it("refuses a sibling directory that merely shares the root's prefix", () => {
    // `/tmp/morph-e2e-artifact-other` starts with the root's string but is not
    // inside it. Comparing without the trailing separator would accept it.
    expect(() => containedPath(root, "../morph-e2e-artifact-other/x.js")).toThrow(
      /ARTIFACT_PATH_ESCAPES_ROOT/,
    );
  });
});
