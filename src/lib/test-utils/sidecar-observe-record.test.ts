// @vitest-environment node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createSidecarRecorder,
  redactSidecarLine,
} from "../../../scripts/sidecar-observe-record.mjs";

/**
 * What an e2e run keeps of its preview sidecar
 * (`scripts/sidecar-observe-record.mjs`).
 *
 * The last case runs a real child and kills it, the way a sidecar that died
 * in the middle of a run would end, to show the record says so. It tests the
 * record; it does not reproduce any CI failure.
 */

const TOKEN = "a".repeat(64);
const dir = mkdtempSync(path.join(tmpdir(), "morph-sidecar-record-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const readJson = (file: string) =>
  JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

describe("redactSidecarLine", () => {
  it("removes the named secrets wherever they appear", () => {
    expect(redactSidecarLine(`token=${TOKEN} again ${TOKEN}`, [TOKEN])).toBe(
      "token=[REDACTED] again [REDACTED]",
    );
  });

  it("ignores values too short to be secrets", () => {
    expect(redactSidecarLine("abc def", ["abc", "", undefined])).toBe(
      "abc def",
    );
  });

  it("removes cookie header values and auth cookies", () => {
    expect(
      redactSidecarLine("Cookie: better-auth.session_token=xyz; other=1"),
    ).toBe("Cookie: [REDACTED]");
    expect(redactSidecarLine('{"set-cookie":"sid=1; Path=/"}')).toBe(
      '{"set-cookie":[REDACTED]',
    );
    expect(
      redactSidecarLine("sent better-auth.session_token=abc.def to it"),
    ).toBe("sent better-auth.session_token=[REDACTED] to it");
  });

  it("leaves an observation line as it is", () => {
    const line =
      '[sidecar-observe] {"event":"request","socket":3,"seq":2,"idleMs":4980,"operation":"start","requestId":"0f8e-ab12"}';
    expect(redactSidecarLine(line, [TOKEN])).toBe(line);
  });
});

describe("createSidecarRecorder", () => {
  it("keeps each line, redacted, with its time and stream", () => {
    const logFile = path.join(dir, "lines.log");
    const recorder = createSidecarRecorder({
      logFile,
      processFile: path.join(dir, "lines.json"),
      secrets: [TOKEN],
      now: () => new Date("2026-10-28T12:00:00.000Z"),
    });
    recorder.line(`starting with ${TOKEN}`, "stdout");
    recorder.line("boom", "stderr");
    expect(readFileSync(logFile, "utf8")).toBe(
      "2026-10-28T12:00:00.000Z stdout starting with [REDACTED]\n" +
        "2026-10-28T12:00:00.000Z stderr boom\n",
    );
  });

  it("reports a file it cannot write, once each, and carries on", () => {
    const warnings: string[] = [];
    const recorder = createSidecarRecorder({
      logFile: path.join(dir, "missing", "x.log"),
      processFile: path.join(dir, "missing", "x.json"),
      warn: (message) => warnings.push(message),
    });
    recorder.started(1);
    recorder.line("a", "stdout");
    recorder.line("b", "stdout");
    recorder.exited(0, null, true);
    expect(warnings).toHaveLength(2);
  });

  it("records a process killed under it: pid, listening, signal, not stopped by the runner", async () => {
    const processFile = path.join(dir, "killed.json");
    const recorder = createSidecarRecorder({
      logFile: path.join(dir, "killed.log"),
      processFile,
    });
    const child = spawn(
      process.execPath,
      [
        "-e",
        "console.log('morph local preview sidecar listening on http://127.0.0.1:1'); setInterval(() => {}, 1000);",
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    recorder.started(child.pid);
    const exited = once(child, "exit").then(([code, signal]) =>
      recorder.exited(code as number | null, signal as string | null, false),
    );
    child.stdout.setEncoding("utf8");
    const [chunk] = (await once(child.stdout, "data")) as [string];
    for (const line of chunk.split("\n").filter(Boolean)) {
      recorder.line(line, "stdout");
    }

    const listening = readJson(processFile);
    expect(listening).toMatchObject({ pid: child.pid, exitedAt: null });
    expect(listening.listeningAt).toEqual(expect.any(String));

    child.kill("SIGKILL");
    await exited;
    expect(readJson(processFile)).toMatchObject({
      pid: child.pid,
      code: null,
      signal: "SIGKILL",
      stoppedByRunner: false,
      exitedAt: expect.any(String),
    });
  });
});
