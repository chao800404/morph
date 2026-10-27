/**
 * Verifies that CI package installation timeout mechanics reliably terminate
 * sub-processes, close output streams, and avoid pipe hangs.
 *
 * Background:
 * In CI, `timeout 240 pnpm exec playwright install --with-deps chromium 2>&1 | tee install.log`
 * hung for the full 15-minute GitHub Actions step limit. Because `playwright install`
 * spawns sub-processes (such as `sudo apt-get install` and its download workers) that
 * inherit stdout, piping directly to `tee` prevents the bash pipeline from completing
 * until all processes holding the pipe have exited — even if `timeout 240` has expired.
 *
 * This test guards the fix:
 * 1. Demonstrates the pipe hang failure mode with `| tee`.
 * 2. Proves that file redirection without piping to `tee` plus `--kill-after` enforces
 *    strict timeout termination and releases the process immediately.
 * 3. Proves that SIGKILL is delivered to stubborn processes that ignore SIGTERM.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "apt-timeout-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

describe("CI apt installation timeout and process termination", () => {
  it("demonstrates the pipeline hang when stdout is held by an unkilled background child", () => {
    const logFile = join(dir, "hang.log");
    const start = Date.now();
    let status = 0;
    try {
      // timeout is 1s, but child sleeps for 3s in background holding stdout
      execSync(
        `bash -c 'status=0; timeout 1 bash -c "(sleep 3 &)" 2>&1 | tee "${logFile}" || status=$?; exit $status'`,
        { stdio: "pipe" },
      );
    } catch (err) {
      status = err.status;
    }
    const elapsed = Date.now() - start;
    // Because tee waited for the background child to close the stdout pipe,
    // total time was ~3s rather than 1s!
    assert.ok(
      elapsed >= 2500,
      `Expected pipeline to hang on tee until background child finished (took ${elapsed}ms)`,
    );
  });

  it("proves that redirecting to file without pipe releases execution strictly at timeout", () => {
    const logFile = join(dir, "fixed.log");
    const start = Date.now();
    let status = 0;
    try {
      execSync(
        `bash -c 'status=0; timeout --kill-after=1s 1 bash -c "sleep 5" > "${logFile}" 2>&1 || status=$?; exit $status'`,
        { stdio: "pipe" },
      );
    } catch (err) {
      status = err.status;
    }
    const elapsed = Date.now() - start;
    // Must terminate within ~1.5s (strictly enforcing the 1s timeout)
    assert.ok(
      elapsed >= 900 && elapsed < 2000,
      `Expected termination close to 1s timeout, took ${elapsed}ms`,
    );
    // Exit status 124 is GNU timeout's exit code for timed-out commands
    assert.equal(status, 124, `Expected exit status 124 from timeout, got ${status}`);
  });

  it("proves that --kill-after forcibly terminates a process tree ignoring SIGTERM", () => {
    const logFile = join(dir, "stubborn.log");
    const start = Date.now();
    let status = 0;
    try {
      execSync(
        `bash -c 'status=0; timeout --kill-after=1s 1 bash -c "trap \\"\\" TERM; sleep 5" > "${logFile}" 2>&1 || status=$?; exit $status'`,
        { stdio: "pipe" },
      );
    } catch (err) {
      status = err.status;
    }
    const elapsed = Date.now() - start;
    // With 1s timeout + 1s kill-after grace period, must terminate around 2s
    assert.ok(
      elapsed >= 1800 && elapsed < 3000,
      `Expected termination after kill-after grace period (~2s), took ${elapsed}ms`,
    );
    // 124 (timeout) or 137 (SIGKILL = 128 + 9)
    assert.ok(
      status === 124 || status === 137,
      `Expected exit status 124 or 137, got ${status}`,
    );
  });
});
