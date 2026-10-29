/**
 * The E2E runner's preview runtime guard.
 *
 * `node --test`, beside the script, for the reason `ship.test.mjs` gives: vitest
 * collects `src/` only. Run by `pnpm check:e2e-runner`, which CI's Architecture
 * guards job runs.
 *
 * The Worker's side is read through Wrangler's real `unstable_readConfig` and
 * `unstable_getVarsForDev` against a scratch project, so these cases pin
 * Wrangler's precedence as installed, not a description of it: a Wrangler
 * upgrade that changed which file wins fails here.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  previewRuntimeRefusal,
  readSpecPreviewRuntime,
  readWorkerPreviewRuntime,
} from "./e2e-preview-runtime-guard.mjs";
import { deploymentThemePreviewRuntime } from "../src/lib/storefront/theme-preview-runtime-default.mjs";

const ENV = "local_preview_e2e";
const ORIGINAL_CWD = process.cwd();
/** Wrangler reads these from the process; each case starts without them. */
const AMBIENT = [
  "MORPH_THEME_PREVIEW_RUNTIME",
  "CLOUDFLARE_INCLUDE_PROCESS_ENV",
  "CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV",
];
const savedAmbient = Object.fromEntries(AMBIENT.map((key) => [key, process.env[key]]));
/** @type {string[]} */
const scratches = [];

/**
 * A scratch project with a minimal Wrangler config and the given files, made
 * the working directory, as the runner's is the project root.
 *
 * @param {Record<string, string>} files
 * @param {Record<string, unknown>} [envVars] `vars` of the `local_preview_e2e` environment.
 */
async function project(files, envVars) {
  const dir = await mkdtemp(path.join(tmpdir(), "morph-runtime-guard-"));
  scratches.push(dir);
  await writeFile(
    path.join(dir, "wrangler.jsonc"),
    JSON.stringify({
      name: "runtime-guard-test",
      main: "worker.js",
      compatibility_date: "2025-01-01",
      env: { [ENV]: envVars ? { vars: envVars } : {} },
    }),
  );
  await writeFile(path.join(dir, "worker.js"), "export default {};\n");
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(path.join(dir, name), contents);
  }
  for (const key of AMBIENT) delete process.env[key];
  process.chdir(dir);
  return dir;
}

afterEach(async () => {
  process.chdir(ORIGINAL_CWD);
  for (const [key, value] of Object.entries(savedAmbient)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await Promise.all(scratches.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const SIDECAR = "MORPH_LOCAL_THEME_PREVIEW_ORIGIN=http://127.0.0.1:5199\n";

/** @param {Record<string, string>} specEnv */
async function check(specEnv, cloudflareEnv = ENV) {
  const worker = await readWorkerPreviewRuntime({ cloudflareEnv });
  const spec = readSpecPreviewRuntime(specEnv);
  return { worker, spec, refusal: previewRuntimeRefusal(worker, spec) };
}

describe("the preview runtime guard", () => {
  it("passes a client-only run: no runtime on either side", async () => {
    await project({ [`.dev.vars.${ENV}`]: SIDECAR });
    const { worker, spec, refusal } = await check({});
    assert.equal(worker.runtime, "client");
    assert.equal(worker.value, undefined);
    assert.equal(spec.runtime, "client");
    assert.equal(refusal, null);
  });

  it("passes a full Start run: start on both sides", async () => {
    await project({ [`.dev.vars.${ENV}`]: `${SIDECAR}MORPH_THEME_PREVIEW_RUNTIME=start\n` });
    const { worker, refusal } = await check({ MORPH_E2E_PREVIEW_RUNTIME: "start" });
    assert.equal(worker.runtime, "start");
    assert.match(worker.source, new RegExp(`\\.dev\\.vars\\.${ENV}`));
    assert.equal(refusal, null);
  });

  it("refuses a Worker on start with specs on client, naming both values and their sources", async () => {
    await project({ [`.dev.vars.${ENV}`]: `${SIDECAR}MORPH_THEME_PREVIEW_RUNTIME=start\n` });
    const { refusal } = await check({});
    assert.ok(refusal);
    assert.match(refusal, /^PREVIEW_RUNTIME_MISMATCH:/);
    assert.match(refusal, /MORPH_THEME_PREVIEW_RUNTIME="start" from \.dev\.vars\.local_preview_e2e/);
    assert.match(refusal, /MORPH_E2E_PREVIEW_RUNTIME unset \(unset in the runner's environment\)/);
    assert.match(refusal, /client-only branches/);
  });

  it("refuses a Worker on client with specs on start", async () => {
    await project({ [`.dev.vars.${ENV}`]: SIDECAR });
    const { refusal } = await check({ MORPH_E2E_PREVIEW_RUNTIME: "start" });
    assert.ok(refusal);
    assert.match(refusal, /^PREVIEW_RUNTIME_MISMATCH:/);
    assert.match(refusal, /MORPH_THEME_PREVIEW_RUNTIME unset \(not set in anything Wrangler loads/);
    assert.match(refusal, /MORPH_E2E_PREVIEW_RUNTIME="start" from the runner's environment/);
  });

  it("reads .dev.vars.<env> instead of .dev.vars, as Wrangler does: the files are not merged", async () => {
    await project({
      ".dev.vars": "MORPH_THEME_PREVIEW_RUNTIME=start\n",
      [`.dev.vars.${ENV}`]: SIDECAR,
    });
    assert.equal((await check({})).worker.runtime, "client");
    // The default environment, which the container transport uses, reads .dev.vars.
    const fallback = await check({}, "");
    assert.equal(fallback.worker.runtime, "start");
    assert.match(fallback.worker.source, /^\.dev\.vars, as Wrangler loads them for the default environment/);
  });

  it("ignores .dev.vars.local, which Wrangler never loads, so a start there is refused against start specs", async () => {
    await project({
      ".dev.vars.local": "MORPH_THEME_PREVIEW_RUNTIME=start\n",
      [`.dev.vars.${ENV}`]: SIDECAR,
    });
    const { worker, refusal } = await check({ MORPH_E2E_PREVIEW_RUNTIME: "start" });
    assert.equal(worker.runtime, "client");
    assert.match(refusal ?? "", /^PREVIEW_RUNTIME_MISMATCH:/);
  });

  it("lets a .dev.vars file override the config's vars, and reads the config's vars when no file sets it", async () => {
    await project(
      { [`.dev.vars.${ENV}`]: `${SIDECAR}MORPH_THEME_PREVIEW_RUNTIME=client\n` },
      { MORPH_THEME_PREVIEW_RUNTIME: "start" },
    );
    assert.equal((await check({})).worker.runtime, "client");
    process.chdir(ORIGINAL_CWD);

    await project({ [`.dev.vars.${ENV}`]: SIDECAR }, { MORPH_THEME_PREVIEW_RUNTIME: "start" });
    const fromConfig = await check({ MORPH_E2E_PREVIEW_RUNTIME: "start" });
    assert.equal(fromConfig.worker.runtime, "start");
    assert.match(fromConfig.worker.source, /^"vars" in wrangler\.jsonc for environment "local_preview_e2e"/);
    assert.equal(fromConfig.refusal, null);
  });

  it("does not take the shell's MORPH_THEME_PREVIEW_RUNTIME while a .dev.vars file exists", async () => {
    await project({ [`.dev.vars.${ENV}`]: SIDECAR });
    process.env.MORPH_THEME_PREVIEW_RUNTIME = "start";
    process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = "true";
    assert.equal((await check({})).worker.runtime, "client");
  });

  it("takes the shell's value only where Wrangler does: no .dev.vars file and CLOUDFLARE_INCLUDE_PROCESS_ENV", async () => {
    await project({});
    process.env.MORPH_THEME_PREVIEW_RUNTIME = "start";
    assert.equal((await check({})).worker.runtime, "client");
    process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = "true";
    const included = await check({ MORPH_E2E_PREVIEW_RUNTIME: "start" });
    assert.equal(included.worker.runtime, "start");
    assert.equal(included.refusal, null);
  });

  it("refuses a value that names no runtime, on either side", async () => {
    await project({ [`.dev.vars.${ENV}`]: `${SIDECAR}MORPH_THEME_PREVIEW_RUNTIME=Start\n` });
    const worker = await check({});
    // The Worker's own rule reads it as client-only, so the sides "agree"; the
    // value was still meant as something.
    assert.equal(worker.worker.runtime, "client");
    assert.match(worker.refusal ?? "", /^PREVIEW_RUNTIME_UNKNOWN: MORPH_THEME_PREVIEW_RUNTIME="Start"/);

    const spec = readSpecPreviewRuntime({ MORPH_E2E_PREVIEW_RUNTIME: "full-start" });
    assert.match(
      previewRuntimeRefusal(worker.worker, spec) ?? "",
      /MORPH_E2E_PREVIEW_RUNTIME="full-start"/,
    );
  });

  it("reads an empty value as unset, as the Worker and the specs both do", async () => {
    await project({ [`.dev.vars.${ENV}`]: `${SIDECAR}MORPH_THEME_PREVIEW_RUNTIME=\n` });
    const { worker, refusal } = await check({ MORPH_E2E_PREVIEW_RUNTIME: "" });
    assert.equal(worker.runtime, "client");
    assert.equal(refusal, null);
  });

  it("reads both sides with the Worker's own rule", () => {
    for (const value of [undefined, "", "client", "start", "Start", "1"]) {
      assert.equal(
        readSpecPreviewRuntime({ MORPH_E2E_PREVIEW_RUNTIME: value }).runtime,
        deploymentThemePreviewRuntime(value),
      );
    }
  });
});
