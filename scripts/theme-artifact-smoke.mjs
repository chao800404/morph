#!/usr/bin/env node
/**
 * Theme artifact smoke run.
 *
 * Proves that an immutable build artifact is a genuinely runnable Cloudflare
 * Worker before anything tries to deploy it: boots `runtime/server/index.js`
 * with its client assets under wrangler, then checks that a page renders on the
 * server and that a declared asset is served.
 *
 * The generated config MUST declare module `rules`. With `no_bundle` the entry
 * only imports its chunks by path, so without the rules workerd fails with
 * `No such module "assets/worker-entry-*.js"`. Direct Cloudflare API uploads do
 * not need this — there every module is an explicit multipart part — but the
 * wrangler-driven harness does.
 *
 * Usage:
 *   node scripts/theme-artifact-smoke.mjs --artifact <dir> [--port 8799] [--keep]
 *
 * <dir> is the materialized artifact root containing runtime/server and
 * runtime/client.
 *
 * `--keep` leaves the Worker serving after the checks pass, so Morph Core can
 * forward storefront requests to it during local development. Without it the
 * process verifies and exits, which is what CI wants.
 */
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const artifactRoot = resolve(arg("artifact", ""));
const port = Number(arg("port", "8799"));
const keepServing = process.argv.includes("--keep");

if (!artifactRoot || !existsSync(artifactRoot)) {
  console.error("[smoke] --artifact <dir> is required and must exist");
  process.exit(2);
}

const serverDir = join(artifactRoot, "runtime", "server");
const clientDir = join(artifactRoot, "runtime", "client");
for (const [label, dir] of [["server", serverDir], ["client", clientDir]]) {
  if (!existsSync(dir)) {
    console.error(`[smoke] missing runtime/${label} in ${artifactRoot}`);
    process.exit(2);
  }
}

const configPath = join(serverDir, "wrangler.smoke.json");
writeFileSync(
  configPath,
  JSON.stringify(
    {
      name: "morph-theme-smoke",
      main: "index.js",
      compatibility_date: "2025-09-02",
      compatibility_flags: ["nodejs_compat"],
      assets: { directory: "../client" },
      no_bundle: true,
      rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
    },
    null,
    2,
  ),
);

// Own process group: wrangler spawns workerd as a separate child, and killing
// only the wrangler process leaves that grandchild holding the port. Signalling
// the whole group tears the Worker down with it.
const wrangler = spawn(
  resolve(process.cwd(), "node_modules/.bin/wrangler"),
  ["dev", "-c", configPath, "--port", String(port), "--ip", "127.0.0.1"],
  { stdio: ["ignore", "pipe", "pipe"], detached: true },
);

let log = "";
wrangler.stdout.on("data", (chunk) => (log += chunk.toString()));
wrangler.stderr.on("data", (chunk) => (log += chunk.toString()));

let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  try {
    // Negative pid signals the group, reaching workerd as well.
    process.kill(-wrangler.pid, "SIGTERM");
  } catch {
    try {
      wrangler.kill("SIGTERM");
    } catch {}
  }
};
process.on("exit", stop);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    stop();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

async function waitForReady(deadlineMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    if (/ERROR|failed to start/i.test(log)) return false;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok || res.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const checks = [];
function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
}

try {
  if (!(await waitForReady())) {
    console.error("[smoke] the Theme Worker did not start");
    console.error(log.slice(-2000));
    process.exit(1);
  }

  const page = await fetch(`http://127.0.0.1:${port}/`);
  const html = await page.text();
  record("root route responds", page.status === 200, `status=${page.status}`);
  record(
    "response is server-rendered HTML",
    (page.headers.get("content-type") ?? "").includes("text/html") &&
      /<html[\s>]/i.test(html),
    `${html.length} bytes`,
  );

  const assetMatch = html.match(/\/assets\/[A-Za-z0-9._-]+\.(?:css|js)/);
  if (assetMatch) {
    const asset = await fetch(`http://127.0.0.1:${port}${assetMatch[0]}`);
    record(
      "declared client asset is served",
      asset.status === 200,
      `${assetMatch[0]} status=${asset.status}`,
    );
  } else {
    record("declared client asset is served", false, "no asset referenced in HTML");
  }

  const missing = await fetch(`http://127.0.0.1:${port}/__morph_smoke_missing__`);
  record(
    "unknown route is routed, not swallowed",
    missing.status === 404,
    `status=${missing.status}`,
  );
} finally {
  if (!keepServing) stop();
}

const failed = checks.filter((check) => !check.ok);
console.log(
  failed.length === 0
    ? `\n[smoke] PASS — ${checks.length} checks`
    : `\n[smoke] FAIL — ${failed.length}/${checks.length} checks failed`,
);

if (keepServing && failed.length === 0) {
  console.log(`\n[smoke] serving on http://127.0.0.1:${port} — press Ctrl+C to stop`);
  // Keep the event loop alive by holding stdin open rather than awaiting a
  // promise that never settles, which Node reports as an unsettled top-level
  // await. Exiting is driven by SIGINT, which tears the Worker down.
  process.stdin.resume();
  wrangler.on("exit", (code) => {
    console.log(`\n[smoke] the Theme Worker exited (code ${code ?? "null"})`);
    process.exit(code ?? 1);
  });
} else {
  process.exit(failed.length === 0 ? 0 : 1);
}
