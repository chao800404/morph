// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * The Start preview child on its own: what it does with the instance it is
 * handed. It names that instance on its responses and confirms it back only
 * when the value has the exact shape a parent mints; anything else is not
 * put on a response and not confirmed.
 */

const CHILD = fileURLToPath(
  new URL("./local-vite-preview-child.mjs", import.meta.url),
);
const VALID = 'morph-instance;desc="0b7c3f52-2c1d-4e8f-9a6b-1c2d3e4f5a6b.3"';

let root = "";
const children: ChildProcess[] = [];

beforeAll(async () => {
  // A plain Vite root: the child's own behaviour is under test, not a Theme.
  root = await fs.mkdtemp(path.join(os.tmpdir(), "morph-preview-child-"));
  await fs.writeFile(path.join(root, "vite.config.ts"), "export default {};\n");
  await fs.writeFile(
    path.join(root, "index.html"),
    "<!doctype html><html><body>child</body></html>\n",
  );
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    await new Promise<void>((done) => {
      child.once("exit", () => done());
      child.kill("SIGTERM");
    });
  }
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function startChild(...extra: string[]) {
  const child = fork(CHILD, [root, "127.0.0.1", "0", ...extra], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.push(child);
  return new Promise<{ port: number; servedTiming: unknown }>(
    (resolve, reject) => {
      child.once("message", (message: Record<string, unknown>) => {
        if (message?.type === "ready" && typeof message.port === "number") {
          resolve({
            port: message.port,
            servedTiming: "servedTiming" in message ? message.servedTiming : undefined,
          });
        } else {
          reject(new Error(String(message?.message ?? "child failed")));
        }
      });
      child.once("exit", () => reject(new Error("child exited early")));
    },
  );
}

describe("the Start preview child", { timeout: 60_000 }, () => {
  it("names the instance it was handed on its responses, and confirms it", async () => {
    const ready = await startChild(VALID);
    expect(ready.servedTiming).toBe(VALID);
    const response = await fetch(`http://127.0.0.1:${ready.port}/`);
    await response.text();
    expect(response.headers.get("server-timing")).toBe(VALID);
  });

  it.each([
    ["no instance", []],
    ["a value of another shape", ['morph-instance;desc="short.1"']],
    ["an injected header", [`${VALID}, other;desc="x"`]],
    ["a zero serial", ['morph-instance;desc="0b7c3f52-2c1d-4e8f-9a6b-1c2d3e4f5a6b.0"']],
  ])("names nothing and confirms nothing for %s", async (_label, extra) => {
    const ready = await startChild(...(extra as string[]));
    expect(ready.servedTiming).toBeNull();
    const response = await fetch(`http://127.0.0.1:${ready.port}/`);
    await response.text();
    expect(response.headers.get("server-timing")).toBeNull();
  });
});
