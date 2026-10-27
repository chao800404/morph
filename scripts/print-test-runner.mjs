// @ts-check
/**
 * What machine `Validation tests` ran on, and what Vitest knows about its files
 * before it starts. Observation only: it prints and always exits 0.
 *
 * The same suite has taken 606 to 1166 s in that job, with every Vitest phase
 * scaling together, and nothing in the job's log said what it ran on. These
 * lines are what lets a slow run be compared with a fast one.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";

const line = (label, value) => console.log(`[test-runner] ${label}: ${value}`);
const read = (run) => {
  try {
    return run();
  } catch {
    return "unavailable";
  }
};

line(
  "cpu model",
  read(() =>
    (
      execFileSync("lscpu", { encoding: "utf8" })
        .split("\n")
        .find((entry) => entry.startsWith("Model name:")) ?? "unknown"
    )
      .replace("Model name:", "")
      .trim(),
  ),
);
line("cpus (os.cpus)", os.cpus().length);
line("available parallelism", os.availableParallelism());
line(
  "cgroup cpu.max",
  read(() => readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim()),
);
line("memory total MiB", Math.round(os.totalmem() / 2 ** 20));
line("memory free MiB", Math.round(os.freemem() / 2 ** 20));
line(
  "load average",
  os
    .loadavg()
    .map((value) => value.toFixed(2))
    .join(" "),
);

// Vitest's own timings file: present only when an earlier run's was restored.
// Without it Vitest orders the files by size; with it, longest first.
const timings =
  "node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json";
if (existsSync(timings)) {
  const parsed = read(() => JSON.parse(readFileSync(timings, "utf8")));
  line(
    "file timings",
    typeof parsed === "object" && Array.isArray(parsed.results)
      ? `restored, ${parsed.results.length} files, vitest ${parsed.version}`
      : "restored but unreadable",
  );
} else {
  line("file timings", "none (files run largest first)");
}
