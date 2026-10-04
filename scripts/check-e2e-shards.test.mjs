import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyCoverage } from "./check-e2e-shards.mjs";

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
