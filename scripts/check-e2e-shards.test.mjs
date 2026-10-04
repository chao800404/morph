import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyCoverage } from "./check-e2e-shards.mjs";
import { EDITOR_SHARDS, editorShardArguments } from "./editor-e2e-shards.mjs";

test("balanced whole-file plan contains each file once and matches exact paths", () => {
  const files = EDITOR_SHARDS.flat();
  assert.equal(files.length, 24);
  assert.equal(new Set(files).size, files.length);
  for (const [index, shard] of EDITOR_SHARDS.entries()) {
    const args = editorShardArguments([`--shard=${index + 1}/3`]);
    assert.equal(args.length, shard.length);
    assert.ok(!args.some((arg) => arg.startsWith("--shard")));
    for (const [i, file] of shard.entries()) {
      const pattern = new RegExp(args[i]);
      assert.ok(pattern.test(`/repo/e2e/${file}`));
      assert.ok(pattern.test(`C:\\repo\\e2e\\${file}`));
      assert.ok(!pattern.test(`/repo/e2e/${file}.backup`));
      assert.ok(!pattern.test(`/repo/not-e2e/${file}`));
    }
  }
});
test("full and focused invocations are not narrowed", () => {
  assert.deepEqual(editorShardArguments([]), []);
  assert.deepEqual(editorShardArguments(["editor.spec.ts", "--grep=save"]), [
    "editor.spec.ts",
    "--grep=save",
  ]);
});
test("invalid and duplicate shard flags fail rather than silently losing coverage", () => {
  for (const args of [
    ["--shard=0/3"],
    ["--shard=4/3"],
    ["--shard=1/4"],
    ["--shard=1/3", "--shard=2/3"],
  ]) {
    assert.throws(() => editorShardArguments(args), /EDITOR_SHARD_INVALID/);
  }
});

const record = (id, project = "editor", status = "passed") => ({
  id,
  project,
  results: [{ status }],
});
const expected = Array.from({ length: 21 }, (_, i) => record(`test-${i}`));
const shards = () =>
  [0, 1, 2].map((n) => [
    record("auth", "setup"),
    record("transport", "preview-transport"),
    ...expected.slice(n * 7, n * 7 + 7),
  ]);

test("complete isolated shards retain exact coverage and both preconditions", () => {
  assert.deepEqual(verifyCoverage(expected, shards(), true), [7, 7, 7]);
});
test("missing report fails", () =>
  assert.throws(() => verifyCoverage(expected, shards().slice(1), true)));
test("a new collected test absent from the allocation fails", () => {
  assert.throws(
    () =>
      verifyCoverage([...expected, record("new-file-test")], shards(), true),
    /coverage differs/,
  );
});
test("a missing test fails even without a duplicate and with enough tests run", () => {
  const reports = shards();
  reports[2].pop();
  assert.throws(
    () => verifyCoverage(expected, reports, true),
    /coverage differs/,
  );
});
test("a missing test replaced by a duplicate cannot preserve acceptance", () => {
  const reports = shards();
  reports[2][2] = reports[0][2];
  assert.throws(() => verifyCoverage(expected, reports, true), /Duplicate/);
});
test("missing transport precondition fails", () => {
  const reports = shards();
  reports[1].splice(1, 1);
  assert.throws(
    () => verifyCoverage(expected, reports, true),
    /preview-transport/,
  );
});
test("skipped authentication is not a passing precondition", () => {
  const reports = shards();
  reports[0][0] = record("auth", "setup", "skipped");
  assert.throws(() => verifyCoverage(expected, reports, true), /actually pass/);
});
test("all-skipped shard fails", () => {
  const reports = shards();
  reports[0] = reports[0].map((r) =>
    r.project === "editor" ? record(r.id, r.project, "skipped") : r,
  );
  assert.throws(() => verifyCoverage(expected, reports, true), /all-skipped/);
});
test("failed test fails even when other shards pass", () => {
  const reports = shards();
  reports[0][2] = record("test-0", "editor", "failed");
  assert.throws(() => verifyCoverage(expected, reports, true), /Failed/);
});
test("empty expected suite fails", () =>
  assert.throws(() => verifyCoverage([], shards()), /empty/));
