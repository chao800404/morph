// @vitest-environment node
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  wranglerDeployConfig,
  wranglerDeployInvocation,
} from "./sandbox-wrangler-theme-worker-deployer";

/**
 * Runs the real wrangler, the version the deploy container pins, the way the
 * deployer runs it — against a local fake API, with a fake token — and checks
 * that `.env` files placed wherever a deployment's files can be do not change
 * where the token is sent.
 *
 * Nothing here talks to Cloudflare: the fake API is the only destination the
 * invocation names, and a second local server stands in for wherever a
 * hostile `.env` would send it. The control case runs wrangler the way it was
 * run before, to show that the hostile files do move it when nothing stops them.
 */

const FAKE_TOKEN = "fake-deploy-token-0123456789";
const FAKE_ACCOUNT = "fake-account-0123456789";

const PLAN = {
  scriptName: "morph-theme-destination-test",
  mainModule: "index.js",
  compatibilityDate: "2025-09-02",
  compatibilityFlags: [],
  modules: [],
  assets: [],
};

const WRANGLER_DIR = path.join(process.cwd(), "node_modules", "wrangler");
const WRANGLER_BIN = path.join(WRANGLER_DIR, "bin", "wrangler.js");

type Seen = Readonly<{
  kind: "request" | "connect";
  url: string;
  authorization: string | null;
  authKey: string | null;
}>;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A server that records what reaches it and refuses it the way the API does. */
async function recordingServer(): Promise<{ origin: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server: Server = createServer((request, response) => {
    seen.push({
      kind: "request",
      url: request.url ?? "",
      authorization: request.headers.authorization ?? null,
      authKey: (request.headers["x-auth-key"] as string | undefined) ?? null,
    });
    request.resume();
    response.writeHead(400, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        success: false,
        errors: [{ code: 10000, message: "fake API" }],
        messages: [],
        result: null,
      }),
    );
  });
  // A proxy is asked with CONNECT for an https destination.
  server.on("connect", (request, socket) => {
    seen.push({
      kind: "connect",
      url: request.url ?? "",
      authorization: null,
      authKey: null,
    });
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, seen };
}

/** A deployment's directories, with `hostileEnv` as `.env` and `.env.local` in each. */
async function deploymentLayout(hostileEnv: string) {
  const root = await mkdtemp(path.join(tmpdir(), "morph-deploy-destination-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const dirs = {
    server: path.join(root, "server"),
    client: path.join(root, "client"),
    run: path.join(root, "run"),
    home: path.join(root, "home"),
  };
  for (const dir of Object.values(dirs)) await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dirs.server, "index.js"),
    "export default { fetch() { return new Response('ok'); } };\n",
  );
  await writeFile(path.join(dirs.client, "index.html"), "<p>ok</p>\n");
  await writeFile(
    path.join(dirs.server, "wrangler.json"),
    JSON.stringify(wranglerDeployConfig(PLAN), null, 2),
  );
  for (const dir of [dirs.server, dirs.client, dirs.run]) {
    await writeFile(path.join(dir, ".env"), hostileEnv);
    await writeFile(path.join(dir, ".env.local"), hostileEnv);
  }
  return dirs;
}

function runWrangler(
  argv: readonly string[],
  cwd: string,
  env: Record<string, string>,
): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WRANGLER_BIN, ...argv.slice(1)], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
    child.on("close", () => {
      clearTimeout(timer);
      resolve(output);
    });
  });
}

/** What the child is given besides the invocation: nothing of this process. */
function baseEnv(home: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    WRANGLER_HIDE_BANNER: "true",
  };
}

describe("where a deployment sends its token", () => {
  it("runs the wrangler version the platform tools pin", async () => {
    const pinned = JSON.parse(
      await readFile(path.join(process.cwd(), "sandbox/platform/package.json"), "utf8"),
    ).dependencies.wrangler;
    const installed = JSON.parse(
      await readFile(path.join(WRANGLER_DIR, "package.json"), "utf8"),
    ).version;
    expect(installed).toBe(pinned);
  });

  it("is the pinned API, whatever .env files a deployment's directories hold", async () => {
    const api = await recordingServer();
    const hostile = await recordingServer();
    const dirs = await deploymentLayout(
      [
        `CLOUDFLARE_API_BASE_URL=${hostile.origin}/client/v4`,
        "WRANGLER_API_ENVIRONMENT=staging",
        "CLOUDFLARE_COMPLIANCE_REGION=fedramp_high",
        "CLOUDFLARE_API_TOKEN=hostile-token",
        "CLOUDFLARE_ACCOUNT_ID=hostile-account",
        // Preferred by wrangler to a token, and not pinnable to an empty value.
        "CLOUDFLARE_API_KEY=hostile-key",
        "CLOUDFLARE_EMAIL=hostile@example.com",
        `HTTPS_PROXY=${hostile.origin}`,
        `https_proxy=${hostile.origin}`,
        `HTTP_PROXY=${hostile.origin}`,
        `http_proxy=${hostile.origin}`,
        "",
      ].join("\n"),
    );
    const invocation = wranglerDeployInvocation({
      apiToken: FAKE_TOKEN,
      accountId: FAKE_ACCOUNT,
      wranglerBin: WRANGLER_BIN,
      configPath: path.join(dirs.server, "wrangler.json"),
      workingDir: dirs.run,
      apiBaseUrl: `${api.origin}/client/v4`,
    });

    const output = await runWrangler(invocation.argv, invocation.cwd, {
      ...baseEnv(dirs.home),
      ...invocation.env,
    });

    expect(hostile.seen, output).toEqual([]);
    expect(api.seen.length, output).toBeGreaterThan(0);
    for (const seen of api.seen) {
      expect(seen.authorization).toBe(`Bearer ${FAKE_TOKEN}`);
      expect(seen.authKey).toBeNull();
      expect(seen.url).not.toContain("hostile-account");
    }
  }, 120_000);

  it("control: the same .env does move the token when nothing stops it", async () => {
    // Wrangler run as the deployer ran it before: from the directory holding
    // the files, reading the default `.env`, with only the credential set.
    const hostile = await recordingServer();
    const dirs = await deploymentLayout(
      `CLOUDFLARE_API_BASE_URL=${hostile.origin}/client/v4\n`,
    );

    const output = await runWrangler(
      [
        WRANGLER_BIN,
        "deploy",
        "-c",
        path.join(dirs.server, "wrangler.json"),
      ],
      dirs.run,
      {
        ...baseEnv(dirs.home),
        CLOUDFLARE_API_TOKEN: FAKE_TOKEN,
        CLOUDFLARE_ACCOUNT_ID: FAKE_ACCOUNT,
        WRANGLER_SEND_METRICS: "false",
        CI: "true",
      },
    );

    expect(hostile.seen.length, output).toBeGreaterThan(0);
    expect(hostile.seen[0]?.authorization).toBe(`Bearer ${FAKE_TOKEN}`);
  }, 120_000);
});
