#!/usr/bin/env node
/**
 * `pnpm test:sandbox-prerender`: the platform Start runtime build in the real
 * Sandbox image, prerendering an SSG page from a frozen content snapshot
 * (src/lib/storefront/compiler/sandbox-prerender-smoke.test.ts).
 *
 * 1. Builds the image from Dockerfile.sandbox, as the Cloudflare Vite plugin
 *    and a deploy do, under a tag of its own named by the inputs the image is
 *    built from (the Dockerfile and the toolchain lockfiles it copies). A tag
 *    already present is reused; Docker's layer cache serves the rest.
 * 2. Runs the test file with that image. Each build in it starts one
 *    container, named with this run's prefix, and removes it when done.
 * 3. Removes any container with this run's prefix that is left (a crashed
 *    run), and nothing else. The image is kept for the next run.
 *
 * Every step has a timeout. Needs a Docker daemon and Docker Hub access for
 * the pinned base image on a first build.
 *
 * Environment (optional):
 *   MORPH_SANDBOX_SMOKE_IMAGE        use this image; skip the build
 *   MORPH_SANDBOX_SMOKE_BUILD_S      image build timeout, seconds (default 1200)
 *   MORPH_SANDBOX_SMOKE_TEST_S       test run timeout, seconds (default 600)
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_FILE = "src/lib/storefront/compiler/sandbox-prerender-smoke.test.ts";
const BUILD_S = Number(process.env.MORPH_SANDBOX_SMOKE_BUILD_S ?? 1200);
const TEST_S = Number(process.env.MORPH_SANDBOX_SMOKE_TEST_S ?? 600);
const PREFIX = `morph-sbx-smoke-${process.pid}-${Date.now().toString(36)}`;
const REPORT = path.join(os.tmpdir(), `${PREFIX}-vitest.json`);

function log(message) {
  console.log(`[sandbox-prerender-smoke] ${message}`);
}

/** What the image is built from: the Dockerfile and every file it COPYs. */
export function imageInputs(root = ROOT) {
  const dockerfile = fs.readFileSync(path.join(root, "Dockerfile.sandbox"), "utf8");
  const sources = [];
  for (const line of dockerfile.split("\n")) {
    const copy = line.trim().match(/^COPY\s+(.+)$/);
    if (!copy) continue;
    const parts = copy[1].split(/\s+/).filter((part) => !part.startsWith("--"));
    sources.push(...parts.slice(0, -1));
  }
  return ["Dockerfile.sandbox", ...sources.sort()];
}

export function imageTag(root = ROOT) {
  const hash = createHash("sha256");
  for (const file of imageInputs(root)) {
    hash.update(`${file}\0`);
    hash.update(fs.readFileSync(path.join(root, file)));
    hash.update("\0");
  }
  return `morph-sandbox-smoke:${hash.digest("hex").slice(0, 16)}`;
}

function run(command, args, { timeoutS, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      log(`${command} ${args[0]} exceeded ${timeoutS} s; stopping it`);
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    }, timeoutS * 1000);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve(timedOut ? 124 : (code ?? (signal ? 128 : 1)));
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      log(`${command}: ${error.message}`);
      resolve(127);
    });
  });
}

/** Vitest's JSON report, counted; a missing or unreadable one counts nothing. */
export function countReport(file) {
  try {
    const report = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      passed: Number(report.numPassedTests ?? 0),
      failed: Number(report.numFailedTests ?? 0),
      skipped:
        Number(report.numPendingTests ?? 0) + Number(report.numTodoTests ?? 0),
    };
  } catch {
    return { passed: 0, failed: 0, skipped: 0 };
  }
}

function removeOwnContainers() {
  const listed = spawnSync(
    "docker",
    ["ps", "--all", "--quiet", "--filter", `name=^${PREFIX}-`],
    { encoding: "utf8", timeout: 30_000 },
  );
  const ids = (listed.stdout ?? "").split("\n").filter(Boolean);
  if (ids.length === 0) return;
  log(`removing ${ids.length} container(s) this run left: ${ids.join(" ")}`);
  spawnSync("docker", ["rm", "--force", ...ids], { stdio: "inherit", timeout: 60_000 });
}

async function main() {
  const started = Date.now();
  const info = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (info.status !== 0) {
    log(`no Docker daemon answers: ${(info.stderr || info.error?.message || "").trim()}`);
    return 2;
  }
  log(`Docker ${info.stdout.trim()}`);

  let image = process.env.MORPH_SANDBOX_SMOKE_IMAGE;
  if (image) {
    log(`using the given image ${image}`);
  } else {
    image = imageTag();
    const present =
      spawnSync("docker", ["image", "inspect", "--format", "{{.Id}}", image], {
        encoding: "utf8",
        timeout: 30_000,
      }).status === 0;
    if (present) {
      log(`image ${image} is present; not rebuilding`);
    } else {
      log(`building ${image} from Dockerfile.sandbox`);
      const buildStarted = Date.now();
      const code = await run(
        "docker",
        ["build", "--file", "Dockerfile.sandbox", "--tag", image, "."],
        { timeoutS: BUILD_S },
      );
      if (code !== 0) {
        log(`image build failed (exit ${code})`);
        return code;
      }
      log(`image built in ${Math.round((Date.now() - buildStarted) / 1000)} s`);
    }
  }

  const testStarted = Date.now();
  let code;
  try {
    code = await run(
      "pnpm",
      [
        "exec",
        "vitest",
        "run",
        TEST_FILE,
        "--reporter=default",
        "--reporter=json",
        `--outputFile.json=${REPORT}`,
      ],
      {
        timeoutS: TEST_S,
        env: {
          MORPH_SANDBOX_SMOKE_IMAGE: image,
          MORPH_SANDBOX_SMOKE_PREFIX: PREFIX,
        },
      },
    );
  } finally {
    removeOwnContainers();
  }
  // A green run that ran nothing (the image not reaching the test) is not a
  // pass.
  if (code === 0) {
    const counted = countReport(REPORT);
    log(`${counted.passed} passed, ${counted.failed} failed, ${counted.skipped} skipped`);
    if (counted.passed === 0 || counted.skipped > 0 || counted.failed > 0) {
      log("SMOKE_NOT_RUN: every selected test must run and pass; none may be skipped");
      code = 1;
    }
  }
  log(
    `tests ${code === 0 ? "passed" : `failed (exit ${code})`} in ${Math.round((Date.now() - testStarted) / 1000)} s; total ${Math.round((Date.now() - started) / 1000)} s`,
  );
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      removeOwnContainers();
      process.exit(130);
    });
  }
  process.exitCode = await main();
}
