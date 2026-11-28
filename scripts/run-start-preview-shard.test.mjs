import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const LAUNCHER = new URL("./run-start-preview-shard.mjs", import.meta.url).pathname;

/** A fake `pnpm` first on PATH; `body` is its shell script. */
function launch(body) {
  const dir = mkdtempSync(path.join(tmpdir(), "start-shard-"));
  const fake = path.join(dir, "pnpm");
  writeFileSync(fake, `#!/bin/sh\n${body}\n`);
  chmodSync(fake, 0o755);
  const child = spawn(process.execPath, [LAUNCHER, "1"], {
    env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, FAKE_DIR: dir },
    stdio: "ignore",
  });
  const exited = new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal })));
  return { dir, child, exited };
}

test("the launcher exits with pnpm's own exit code", async () => {
  const { exited } = launch("exit 3");
  assert.deepEqual(await exited, { code: 3, signal: null });
});

test("SIGINT and SIGTERM sent to the launcher reach pnpm, which then decides the exit", async () => {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const { dir, child, exited } = launch(
      `trap 'echo ${signal} > "$FAKE_DIR/got"; exit 7' INT TERM\n: > "$FAKE_DIR/ready"\nwhile :; do sleep 0.1; done`,
    );
    for (let i = 0; i < 200 && !existsSync(path.join(dir, "ready")); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(existsSync(path.join(dir, "ready")), "the fake pnpm started");
    child.kill(signal);
    assert.deepEqual(await exited, { code: 7, signal: null }, signal);
    assert.equal(readFileSync(path.join(dir, "got"), "utf8").trim(), signal);
  }
});
