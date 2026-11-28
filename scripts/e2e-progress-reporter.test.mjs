import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const { default: ProgressReporter } = await import("./e2e-progress-reporter.mjs");

function reporterWriting(file) {
  const previous = process.env.MORPH_E2E_PROGRESS_FILE;
  process.env.MORPH_E2E_PROGRESS_FILE = file;
  try {
    return new ProgressReporter();
  } finally {
    if (previous === undefined) delete process.env.MORPH_E2E_PROGRESS_FILE;
    else process.env.MORPH_E2E_PROGRESS_FILE = previous;
  }
}

const fakeTest = {
  title: "hide the Header",
  location: { file: path.join(process.cwd(), "e2e", "x.spec.ts") },
  titlePath: () => ["", "editor", "x.spec.ts", "a suite", "hide the Header"],
};

test("appends a line per test boundary, as it happens, with fixed fields only", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "progress-reporter-"));
  const file = path.join(dir, "missing-dir", "shard-1.json.progress.jsonl");
  const reporter = reporterWriting(file);
  reporter.onBegin({ workers: 1 }, { allTests: () => [fakeTest] });
  reporter.onTestBegin(fakeTest, { retry: 0 });
  assert.equal(readFileSync(file, "utf8").trim().split("\n").length, 2);
  reporter.onTestEnd(fakeTest, {
    status: "timedOut",
    retry: 0,
    duration: 1234,
    error: { message: "launched with --token=hunter2" },
  });
  reporter.onEnd({ status: "failed", duration: 5000 });
  const lines = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(
    lines.map((line) => line.e),
    ["run-begin", "test-begin", "test-end", "run-end"],
  );
  assert.deepEqual(
    { file: lines[2].file, title: lines[2].title, status: lines[2].status, durationMs: lines[2].durationMs },
    { file: "e2e/x.spec.ts", title: "a suite › hide the Header", status: "timedOut", durationMs: 1234 },
  );
  assert.doesNotMatch(readFileSync(file, "utf8"), /hunter2|token/);
});

test("prints nothing, returns no status, and a lost append never throws", () => {
  // A path below a regular file: neither the append nor the mkdir can work.
  const blocker = path.join(mkdtempSync(path.join(tmpdir(), "progress-reporter-")), "file");
  writeFileSync(blocker, "");
  const reporter = reporterWriting(path.join(blocker, "sub", "progress.jsonl"));
  assert.equal(reporter.printsToStdio(), false);
  assert.doesNotThrow(() => reporter.onTestBegin(fakeTest, { retry: 0 }));
  assert.equal(reporter.onEnd({ status: "passed", duration: 1 }), undefined);
  assert.equal(new ProgressReporter().onEnd({ status: "passed", duration: 1 }), undefined);
});
