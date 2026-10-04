import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { editorShardArguments } from "./editor-e2e-shards.mjs";

export function records(report) {
  const found = [];
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        found.push({
          id: spec.id,
          project: test.projectName,
          results: test.results ?? [],
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of report.suites ?? []) visit(suite);
  return found;
}

// Dependency projects intentionally repeat; editor tests must appear exactly
// once across all shards. Count IDs, not just totals: missing + duplicate tests
// can otherwise cancel each other out.
export function verifyCoverage(expected, shards, executed = false) {
  assert.equal(shards.length, 3, "All three shard reports are required");
  const wanted = expected
    .filter((r) => r.project === "editor")
    .map((r) => r.id);
  assert.ok(wanted.length > 0, "The full suite must not be empty");
  const actual = [];
  let ran = 0;
  for (const shard of shards) {
    const editor = shard.filter((r) => r.project === "editor");
    assert.ok(editor.length > 0, "Every shard must contain editor tests");
    for (const project of ["setup", "preview-transport"]) {
      const dependencies = shard.filter((r) => r.project === project);
      assert.ok(dependencies.length > 0, `Missing ${project} precondition`);
      if (executed) {
        assert.ok(
          dependencies.every(
            (r) =>
              r.results.length > 0 &&
              r.results.every((v) => v.status === "passed"),
          ),
          `${project} must actually pass`,
        );
      }
    }
    actual.push(...editor.map((r) => r.id));
    if (executed) {
      const passed = editor.filter((r) =>
        r.results.some((v) => v.status === "passed"),
      );
      assert.ok(passed.length > 0, "An all-skipped shard is not acceptance");
      assert.ok(
        editor.every(
          (r) =>
            r.results.length > 0 &&
            r.results.every((v) => ["passed", "skipped"].includes(v.status)),
        ),
        "Failed or unfinished editor test",
      );
      ran += passed.length;
    }
  }
  assert.equal(
    new Set(actual).size,
    actual.length,
    "Duplicate editor test across shards",
  );
  assert.deepEqual(
    actual.sort(),
    wanted.sort(),
    "Shard coverage differs from the complete suite",
  );
  if (executed)
    assert.ok(
      ran >= 20,
      "The original suite execution minimum remains required",
    );
  return shards.map((s) => s.filter((r) => r.project === "editor").length);
}

function list(extra = []) {
  return records(
    JSON.parse(
      execFileSync(
        "npx",
        [
          "playwright",
          "test",
          "--project=editor",
          "--list",
          "--reporter=json",
          ...editorShardArguments(extra),
        ],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      ),
    ),
  );
}

function reportFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? reportFiles(target) : [target];
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const expected = list();
  const directory = process.argv[2];
  const shards = directory
    ? [1, 2, 3].map((index) => {
        const matches = reportFiles(directory).filter(
          (file) => path.basename(file) === `shard-${index}.json`,
        );
        assert.equal(
          matches.length,
          1,
          `Exactly one report for shard ${index} is required`,
        );
        return records(JSON.parse(readFileSync(matches[0], "utf8")));
      })
    : [1, 2, 3].map((index) => list([`--shard=${index}/3`]));
  console.log(
    `E2E shard coverage verified: ${verifyCoverage(expected, shards, Boolean(directory)).join(" / ")} editor tests`,
  );
}
