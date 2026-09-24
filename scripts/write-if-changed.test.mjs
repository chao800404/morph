/**
 * `node --test`, like the other script tests: vitest collects only
 * `src/**\/*.test.{ts,tsx}`, so a test beside this script would never run.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { writeFileIfChanged } from "./write-if-changed.mjs";

const dir = mkdtempSync(join(tmpdir(), "write-if-changed-"));
after(() => rmSync(dir, { recursive: true, force: true }));

describe("writeFileIfChanged", () => {
  it("creates a missing file, directories included", () => {
    const path = join(dir, "nested", "a.ts");
    assert.equal(writeFileIfChanged(path, "one"), true);
    assert.equal(readFileSync(path, "utf8"), "one");
  });

  it("leaves an identical file untouched, so nothing watching it wakes", () => {
    const path = join(dir, "same.ts");
    writeFileIfChanged(path, "same");
    const past = new Date("2020-01-01T00:00:00Z");
    utimesSync(path, past, past);

    assert.equal(writeFileIfChanged(path, "same"), false);
    assert.equal(statSync(path).mtimeMs, past.getTime());
  });

  it("writes when the content differs", () => {
    const path = join(dir, "changed.ts");
    writeFileIfChanged(path, "before");
    assert.equal(writeFileIfChanged(path, "after"), true);
    assert.equal(readFileSync(path, "utf8"), "after");
  });
});
