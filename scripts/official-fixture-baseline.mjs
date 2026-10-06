/**
 * The local baseline for an official TanStack Start fixture: what the project
 * does when its owner builds it, with its own lockfile and toolchain.
 *
 *   node scripts/official-fixture-baseline.mjs [fixture]
 *
 * Step 0 of docs/start-native-import-plan.md compares Morph's result with
 * this. It copies `fixtures/tanstack/<fixture>` to a temporary directory,
 * installs from its lockfile (`--frozen-lockfile --ignore-scripts`: lifecycle
 * scripts are not run, see the plan's dependency policy), runs the project's
 * own `vite build` and serves the result with `vite preview`, in which the
 * Cloudflare plugin runs the Worker in workerd. Then it makes real requests.
 *
 * Not a CI job: installing takes network and minutes. Run it by hand or on a
 * schedule; the cheap preflight is official-start-import.test.ts.
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const name = process.argv[2] ?? "start-basic-cloudflare";
const PNPM = ["-y", "pnpm@10.34.5"];
const PORT = 4317;
const origin = `http://127.0.0.1:${PORT}`;

const checks = {
  "start-basic-cloudflare": [
    {
      name: "server function reads a wrangler var during SSR",
      path: "/",
      expect: (r) =>
        r.status === 200 &&
        r.body.includes("Welcome Home!!!") &&
        r.body.includes("Hello from Cloudflare"),
    },
    {
      name: "server route answers with its own content type",
      path: "/customScript.js",
      expect: (r) =>
        r.status === 200 &&
        r.type.startsWith("application/javascript") &&
        r.body.includes("Hello from customScript.js!"),
    },
    {
      name: "beforeLoad redirect during SSR",
      path: "/redirect",
      expect: (r) =>
        r.status >= 300 && r.status < 400 && r.location.endsWith("/posts"),
    },
    {
      name: "API route fetching an external service (needs egress)",
      path: "/api/users",
      egress: true,
      expect: (r) => r.status === 200 && r.type.startsWith("application/json"),
    },
  ],
}[name];
if (!checks) throw new Error(`No baseline checks for fixture "${name}"`);

const dir = mkdtempSync(join(tmpdir(), `official-${name}-`));
const log = (message) => console.log(`[baseline] ${message}`);

function run(command, args) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    maxBuffer: 64 * 1024 * 1024,
  });
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  if (result.status !== 0) {
    console.error(result.stdout?.slice(-4000));
    console.error(result.stderr?.slice(-4000));
    throw new Error(`${command} ${args.join(" ")} failed (${seconds}s)`);
  }
  return seconds;
}

let preview;
try {
  cpSync(join(process.cwd(), "fixtures", "tanstack", name), dir, {
    recursive: true,
  });
  log(`fixture copied to ${dir}`);
  log(
    `install: ${run("npx", [...PNPM, "install", "--frozen-lockfile", "--ignore-scripts"])}s`,
  );
  log(
    `vite build: ${run("node", ["node_modules/vite/bin/vite.js", "build"])}s`,
  );
  const version = spawnSync(
    "node",
    ["node_modules/vite/bin/vite.js", "--version"],
    {
      cwd: dir,
      encoding: "utf8",
    },
  ).stdout.trim();
  log(`toolchain: ${version}, node ${process.version}`);

  preview = spawn(
    "node",
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--port",
      String(PORT),
      "--strictPort",
      "--host",
      "127.0.0.1",
    ],
    { cwd: dir, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  preview.stdout.on("data", (chunk) => (output += chunk));
  preview.stderr.on("data", (chunk) => (output += chunk));
  let ready = false;
  for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
    await delay(500);
    ready = await fetch(origin, { redirect: "manual" }).then(
      () => true,
      () => false,
    );
  }
  if (!ready)
    throw new Error(`vite preview did not start:\n${output.slice(-3000)}`);

  const results = [];
  for (const check of checks) {
    const response = await fetch(origin + check.path, { redirect: "manual" });
    const outcome = {
      status: response.status,
      type: response.headers.get("content-type") ?? "",
      location: response.headers.get("location") ?? "",
      body: await response.text(),
    };
    const passed = check.expect(outcome);
    results.push({
      name: check.name,
      path: check.path,
      egress: Boolean(check.egress),
      passed,
      status: outcome.status,
    });
    log(
      `${passed ? "PASS" : "FAIL"} ${check.path} (${outcome.status}) ${check.name}`,
    );
  }
  const failed = results.filter((result) => !result.passed);
  console.log(
    JSON.stringify({
      fixture: name,
      toolchain: version,
      node: process.version,
      results,
    }),
  );
  if (failed.length > 0) process.exitCode = 1;
} finally {
  preview?.kill();
  rmSync(dir, { recursive: true, force: true });
}
