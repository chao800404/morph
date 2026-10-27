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
 * 4. Proves process group isolation: terminating the installation process group ensures
 *    descendants exit while completely preserving unrelated processes.
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

  it("proves attempt recovery terminates setsid lock-holding descendants while preserving unrelated process holding lock file", () => {
    const logFile = join(dir, "group-isolation.log");
    const unrelatedLock = join(dir, "unrelated.lock");
    const unrelatedLog = join(dir, "unrelated.log");
    const targetLock = join(dir, "target.lock");
    const script = `
# 1. Start an unrelated background process holding an unrelated temporary lock file
setsid bash -c '
  exec 9>"${unrelatedLock}"
  flock 9
  sleep 15
' > "${unrelatedLog}" 2>&1 &
unrelated_pid=$!
sleep 0.2

# 2. Run target where descendant opens a new session via setsid holding target lock
setsid timeout --kill-after=1s 1 bash -c '
  setsid bash -c "
    exec 8>\\"${targetLock}\\"
    flock 8
    sleep 10
  " &
  child=$!
  echo CHILD=$child
  wait
' > "${logFile}" 2>&1 &
install_pid=$!

# 3. Wait for timeout to complete and install_pid to exit
wait $install_pid || status=$?

# 4. Enforce attempt-scoped recovery logic matching CI:
# A. Terminate attempt process group
kill -9 -- -$install_pid 2>/dev/null || true

# B. Identify and terminate lock-holding descendants holding targetLock
for lock_file in "${targetLock}"; do
  [ -f "$lock_file" ] || continue
  for lock_pid in $(fuser "$lock_file" 2>/dev/null || true); do
    is_attempt_descendant=0
    if [ -d "/proc/$lock_pid" ]; then
      if [ "$(cat "/proc/$lock_pid/stat" 2>/dev/null | awk '{print $5}')" = "$install_pid" ]; then
        is_attempt_descendant=1
      elif ls -l "/proc/$lock_pid/fd" 2>/dev/null | grep -q "$(basename "${logFile}")"; then
        is_attempt_descendant=1
      fi
    fi
    if [ "$is_attempt_descendant" -eq 1 ]; then
      kill -9 "$lock_pid" 2>/dev/null || true
    fi
  done
done

# C. Terminate any remaining process holding this attempt log
for log_pid in $(fuser "${logFile}" 2>/dev/null || true); do
  kill -9 "$log_pid" 2>/dev/null || true
done

# 5. Extract descendant child PID
child_pid=$(grep -o "CHILD=[0-9]*" "${logFile}" | cut -d= -f2)

child_alive=0
if [ -n "$child_pid" ] && ps -p $child_pid > /dev/null 2>&1; then
  child_alive=1
fi

target_lock_released=0
if flock -n "${targetLock}" true 2>/dev/null; then
  target_lock_released=1
fi

unrelated_alive=0
if ps -p $unrelated_pid > /dev/null 2>&1; then
  unrelated_alive=1
fi

unrelated_lock_held=0
if ! flock -n "${unrelatedLock}" true 2>/dev/null; then
  unrelated_lock_held=1
fi

# Clean up unrelated process group
kill -9 -- -$unrelated_pid 2>/dev/null || true

echo "CHILD_ALIVE=$child_alive"
echo "TARGET_LOCK_RELEASED=$target_lock_released"
echo "UNRELATED_ALIVE=$unrelated_alive"
echo "UNRELATED_LOCK_HELD=$unrelated_lock_held"
`;
    const output = execSync(script, {
      shell: "/bin/bash",
      encoding: "utf8",
    });
    assert.ok(
      output.includes("CHILD_ALIVE=0"),
      `Expected descendant child to be terminated: ${output}`,
    );
    assert.ok(
      output.includes("TARGET_LOCK_RELEASED=1"),
      `Expected target lock to be released: ${output}`,
    );
    assert.ok(
      output.includes("UNRELATED_ALIVE=1"),
      `Expected unrelated process to survive: ${output}`,
    );
    assert.ok(
      output.includes("UNRELATED_LOCK_HELD=1"),
      `Expected unrelated process lock to remain held: ${output}`,
    );
  });
});
