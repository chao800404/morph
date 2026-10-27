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

  it("proves attempt recovery terminates setsid lock-holding descendants via unique log dev/ino and write fd, while preserving unrelated writers and readers", () => {
    const otherDir = join(dir, "other");
    const script = `
set -e
other_dir="${otherDir}"
mkdir -p "$other_dir"

target_lock="${join(dir, "target.lock")}"
unrelated_lock="${join(dir, "unrelated.lock")}"

# Attempt unique log and exact dev/ino identity
install_log=$(mktemp "${join(dir, "install-XXXXXX.log")}")
log_dev_ino=$(stat -L -c "%d:%i" "$install_log")

# Counterexample 1: Unrelated process holding unrelated_lock and writing to same-named log in another directory
other_log="$other_dir/$(basename "$install_log")"
touch "$other_log"
setsid bash -c "
  exec 9>'$unrelated_lock'
  flock 9
  exec 1>>'$other_log'
  sleep 15
" > /dev/null 2>&1 &
unrelated_writer_pid=$!

# Counterexample 2: Unrelated process reading this attempt unique log in read-only mode
setsid bash -c "
  sleep 15 < '$install_log'
" > /dev/null 2>&1 &
unrelated_reader_pid=$!

sleep 0.2

# Target attempt: descendant runs in a new session via setsid, holding target_lock and writing to install_log
setsid timeout --kill-after=1s 1 bash -c "
  setsid bash -c '
    exec 8>\"$target_lock\"
    flock 8
    sleep 10
  ' &
  child=\\$!
  echo CHILD=\\$child
  wait
" > "$install_log" 2>&1 &
install_pid=$!

# Wait for timeout to expire and install_pid to exit
wait $install_pid || true

is_attempt_descendant() {
  local p=$1
  [ -d "/proc/$p" ] || return 1
  local pgid
  pgid=$(awk '{print $5}' "/proc/$p/stat" 2>/dev/null || true)
  if [ -n "$pgid" ] && [ "$pgid" = "$install_pid" ]; then
    return 0
  fi
  [ -n "$log_dev_ino" ] || return 1
  for fd_name in $(ls "/proc/$p/fd" 2>/dev/null || true); do
    local fd_dev_ino
    fd_dev_ino=$(stat -L -c "%d:%i" "/proc/$p/fd/$fd_name" 2>/dev/null || true)
    if [ -n "$fd_dev_ino" ] && [ "$fd_dev_ino" = "$log_dev_ino" ]; then
      local flags
      flags=$(awk '/flags:/ {print $2}' "/proc/$p/fdinfo/$fd_name" 2>/dev/null || true)
      if [ -n "$flags" ] && [ $(( flags & 3 )) -ne 0 ]; then
        return 0
      fi
    fi
  done
  return 1
}

# 1. Terminate attempt process group
kill -9 -- -$install_pid 2>/dev/null || true

# 2. Check lock-holding processes
for lock_file in "$target_lock"; do
  [ -f "$lock_file" ] || continue
  for lock_pid in $(fuser "$lock_file" 2>/dev/null || true); do
    if is_attempt_descendant "$lock_pid"; then
      kill -9 "$lock_pid" 2>/dev/null || true
    else
      echo "DIAGNOSTIC: unconfirmed lock holder $lock_pid, skipping termination"
    fi
  done
done

# 3. Check processes holding install_log
for log_pid in $(fuser "$install_log" 2>/dev/null || true); do
  if is_attempt_descendant "$log_pid"; then
    kill -9 "$log_pid" 2>/dev/null || true
  else
    echo "DIAGNOSTIC: reader or unconfirmed process $log_pid holding log, skipping termination"
  fi
done

# 4. Extract descendant child PID
child_pid=$(grep -o "CHILD=[0-9]*" "$install_log" 2>/dev/null | cut -d= -f2 || true)

child_alive=0
if [ -n "$child_pid" ] && ps -p $child_pid > /dev/null 2>&1; then
  child_alive=1
fi

target_lock_released=0
if flock -n "$target_lock" true 2>/dev/null; then
  target_lock_released=1
fi

unrelated_writer_alive=0
if ps -p $unrelated_writer_pid > /dev/null 2>&1; then
  unrelated_writer_alive=1
fi

unrelated_reader_alive=0
if ps -p $unrelated_reader_pid > /dev/null 2>&1; then
  unrelated_reader_alive=1
fi

unrelated_lock_held=0
if ! flock -n "$unrelated_lock" true 2>/dev/null; then
  unrelated_lock_held=1
fi

# Clean up counterexample processes
kill -9 -- -$unrelated_writer_pid 2>/dev/null || true
kill -9 -- -$unrelated_reader_pid 2>/dev/null || true
rm -f "$install_log" "$other_log"

echo "CHILD_ALIVE=$child_alive"
echo "TARGET_LOCK_RELEASED=$target_lock_released"
echo "UNRELATED_WRITER_ALIVE=$unrelated_writer_alive"
echo "UNRELATED_READER_ALIVE=$unrelated_reader_alive"
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
      output.includes("UNRELATED_WRITER_ALIVE=1"),
      `Expected unrelated writer in another directory to survive: ${output}`,
    );
    assert.ok(
      output.includes("UNRELATED_READER_ALIVE=1"),
      `Expected unrelated reader of attempt log to survive: ${output}`,
    );
    assert.ok(
      output.includes("DIAGNOSTIC: reader or unconfirmed process"),
      `Expected diagnostic to be retained for reader: ${output}`,
    );
    assert.ok(
      output.includes("UNRELATED_LOCK_HELD=1"),
      `Expected unrelated process lock to remain held: ${output}`,
    );
  });
});
