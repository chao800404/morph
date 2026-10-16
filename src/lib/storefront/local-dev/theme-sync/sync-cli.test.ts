import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleThemeSyncRequest } from "@/server/storefront/theme-sync-api";
import type { SyncState } from "./sync-session";
import { createFakeCapabilities, createFakeWorkspace, TEST_TOKEN } from "./sync-test-harness";

vi.mock("cloudflare:workers", () => ({ env: {} }));

/**
 * The real `scripts/morph-sync.ts`, run as a process against the real sync
 * handler over HTTP, to see what a developer sees when sync stops.
 */

let home: string;
let dir: string;
let server: Server | null = null;

/**
 * The CLI finds its credentials under `os.homedir()`: HOME on Linux and
 * macOS, USERPROFILE on Windows. Both point at the temporary home.
 */
const cliEnv = () => ({ ...process.env, HOME: home, USERPROFILE: home });

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "morph-sync-cli-home-"));
  dir = await mkdtemp(join(tmpdir(), "morph-sync-cli-dir-"));
  // Stop before the CLI runs if a child would still see the real home and
  // read the developer's own credentials.
  const childHome = spawnSync(process.execPath, ["-e", "process.stdout.write(require('node:os').homedir())"], {
    env: cliEnv(),
    encoding: "utf8",
  }).stdout;
  if (childHome !== home) {
    throw new Error(`The CLI would run with home ${childHome}, not the test's ${home}.`);
  }
});

afterEach(async () => {
  await new Promise((done) => (server ? server.close(done) : done(undefined)));
  server = null;
  await rm(home, { recursive: true, force: true });
  await rm(dir, { recursive: true, force: true });
});

/** A Morph serving the sync API from an in-memory workspace. */
async function serveMorph(): Promise<string> {
  const workspace = createFakeWorkspace({ "a.tsx": "a" });
  const deps = { dal: createFakeCapabilities(), ...workspace.deps };
  server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk as Buffer);
    const request = new Request(`http://127.0.0.1${incoming.url}`, {
      method: incoming.method,
      headers: incoming.headers as Record<string, string>,
      body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
    });
    const response = await handleThemeSyncRequest(request, deps);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

/** An address where nothing answers. */
async function deadOrigin(): Promise<string> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const { port } = probe.address() as AddressInfo;
  await new Promise((done) => probe.close(done));
  return `http://127.0.0.1:${port}`;
}

/** A folder linked to theme-a at `origin`, whose `.morphignore` cannot be read. */
async function linkFolder(
  origin: string,
  options: { unreadableIgnore: boolean; ignoreHistory?: string },
) {
  const state: SyncState = {
    protocol: 1,
    origin,
    storefrontId: "store-a",
    themeId: "theme-a",
    sourceGeneration: null,
    files: {},
    ...(options.ignoreHistory === undefined ? {} : { ignoreHistory: { text: options.ignoreHistory } }),
  };
  await mkdir(join(dir, ".morph"), { recursive: true });
  await writeFile(join(dir, ".morph", "sync-state.json"), JSON.stringify(state));
  await mkdir(join(home, ".config", "morph"), { recursive: true });
  await writeFile(
    join(home, ".config", "morph", "sync-credentials.json"),
    JSON.stringify({ [`${origin}|theme-a`]: { token: TEST_TOKEN, expiresAt: "2999-01-01T00:00:00.000Z" } }),
  );
  // A directory where the file should be: EISDIR, whoever runs the test.
  if (options.unreadableIgnore) await mkdir(join(dir, ".morphignore"));
}

function runCli(args: string[], until?: RegExp) {
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/morph-sync.ts", ...args, "--dir", dir], {
    cwd: process.cwd(),
    env: cliEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done) => {
    const check = () => {
      if (until?.test(stdout)) child.kill("SIGINT");
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      check();
    });
    child.stderr.on("data", (chunk) => (stderr += chunk));
    // `start` runs until stopped: never leave it behind a failed test.
    const timer = setTimeout(() => child.kill("SIGKILL"), 25_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    });
  });
}

const STACK_FRAME = /^\s+at /m;

describe("morph-sync when the local folder stops a cycle", () => {
  it("status prints one line naming the local folder and exits non-zero", async () => {
    await linkFolder(await serveMorph(), { unreadableIgnore: true });
    const { code, stdout, stderr } = await runCli(["status"]);
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr.trim().split("\n")).toEqual([
      expect.stringMatching(
        /^\[morph-sync\] Local folder problem, not Morph: \.morphignore could not be read, so nothing was synced: EISDIR/,
      ),
    ]);
    expect(stderr).not.toMatch(STACK_FRAME);
  }, 30_000);

  it("start says the problem is local, not Morph, and keeps running", async () => {
    await linkFolder(await serveMorph(), { unreadableIgnore: true });
    const { stdout, stderr } = await runCli(["start", "--yes"], /Local folder problem/);
    expect(stdout).toMatch(
      /\[morph-sync\] Local folder problem, not Morph; trying again: \.morphignore could not be read/,
    );
    expect(stdout).not.toMatch(/reading Morph again/);
    expect(stderr).not.toMatch(STACK_FRAME);
  }, 30_000);

  it("status says the last sync's rules still hold when .morphignore is missing", async () => {
    await linkFolder(await serveMorph(), { unreadableIgnore: false, ignoreHistory: "notes/\n" });
    await mkdir(join(dir, "notes"));
    await writeFile(join(dir, "notes", "mine.md"), "private");
    const { code, stdout } = await runCli(["status"]);
    expect(code).toBe(0);
    expect(stdout).toContain(
      "[morph-sync] .morphignore is missing; still leaving out what it listed at the last sync. Write an empty .morphignore to sync those paths.",
    );
    expect(stdout).not.toContain("notes/mine.md");
  }, 30_000);

  it("start still blames Morph when Morph cannot be reached", async () => {
    await linkFolder(await deadOrigin(), { unreadableIgnore: false });
    const { stdout } = await runCli(["start", "--yes"], /Sync failed/);
    expect(stdout).toMatch(/\[morph-sync\] Sync failed; reading Morph again before anything else: /);
    expect(stdout).not.toMatch(/Local folder problem/);
  }, 30_000);
});
