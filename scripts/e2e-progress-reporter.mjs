// @ts-check
/**
 * A Playwright reporter that appends one JSON line per test boundary to the
 * file `MORPH_E2E_PROGRESS_FILE` names, as each one happens.
 *
 * Why: the `json` reporter writes only when the run ends, so a run stopped
 * before that (a hang that reaches the step's time limit) leaves a log and no
 * report. This file is in the artifact either way and says which spec and
 * test were running, and when anything last happened.
 *
 * It runs beside `line` and `json`, never instead of them, and decides
 * nothing: it prints nothing and returns no status. It never signals,
 * inspects or stops a process.
 *
 * Only a fixed set of fields is written: event name, time, the spec's path,
 * the test's title (authored code), the status and the duration. Never an
 * error message, a step, an environment value or an argument list. Every
 * append is synchronous and by path (so it is in the file before the next
 * event and survives the process being stopped, and a directory emptied
 * under it is recreated); one that fails is dropped without failing the run.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const CONTROL = /[\u0000-\u001f\u007f]/g;
const clean = (/** @type {unknown} */ text) =>
  String(text ?? "")
    .replace(CONTROL, " ")
    .slice(0, 300);

export default class ProgressReporter {
  constructor() {
    this.file = process.env.MORPH_E2E_PROGRESS_FILE || "";
    this.root = process.cwd();
  }

  printsToStdio() {
    return false;
  }

  /** @param {Record<string, unknown>} event */
  write(event) {
    if (!this.file) return;
    const line = `${JSON.stringify({ t: new Date().toISOString(), ...event })}\n`;
    try {
      appendFileSync(this.file, line);
      return;
    } catch {
      /* Retried once below, after recreating the directory. */
    }
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      appendFileSync(this.file, line);
    } catch {
      /* Evidence only: a lost line never changes the run. */
    }
  }

  /** @param {any} test */
  where(test) {
    const file = String(test.location?.file ?? "");
    return {
      file: clean(path.relative(this.root, file) || path.basename(file)),
      title: clean(test.titlePath().slice(3).join(" › ") || test.title),
    };
  }

  /** @param {any} config @param {any} suite */
  onBegin(config, suite) {
    this.write({
      e: "run-begin",
      tests: suite.allTests().length,
      workers: Number(config.workers) || null,
    });
  }

  /** @param {any} test @param {any} result */
  onTestBegin(test, result) {
    this.write({
      e: "test-begin",
      ...this.where(test),
      retry: Number(result.retry) || 0,
    });
  }

  /** @param {any} test @param {any} result */
  onTestEnd(test, result) {
    this.write({
      e: "test-end",
      ...this.where(test),
      status: clean(result.status),
      retry: Number(result.retry) || 0,
      durationMs: Number(result.duration) || 0,
    });
  }

  /** @param {any} result */
  onEnd(result) {
    this.write({
      e: "run-end",
      status: clean(result.status),
      durationMs: Number(result.duration) || 0,
    });
    // No return value: the run's status is Playwright's own.
  }
}
