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
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  RECORD_MODE_SPECS,
  previewRuntimeRefusal,
  previewedThemeRefusal,
  readRecordedPreviewRuntime,
  readSpecPreviewRuntime,
  readWorkerPreviewRuntime,
  recordModeSelectionRefusal,
  recordedThemeRefusal,
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

/** @param {string | undefined} value */
const workerReading = (value) => ({
  value,
  runtime: deploymentThemePreviewRuntime(value),
  source: value === undefined ? "not set in anything Wrangler loads" : ".dev.vars.local_preview_e2e",
});

describe("record mode before the run starts", () => {
  const recordStart = readRecordedPreviewRuntime({ MORPH_E2E_RECORD_PREVIEW_RUNTIME: "start" });

  it("is off when the record variable is unset or empty, leaving the plain check as it was", () => {
    assert.equal(readRecordedPreviewRuntime({}), undefined);
    assert.equal(readRecordedPreviewRuntime({ MORPH_E2E_RECORD_PREVIEW_RUNTIME: "" }), undefined);
    const spec = readSpecPreviewRuntime({ MORPH_E2E_PREVIEW_RUNTIME: "start" });
    assert.match(
      previewRuntimeRefusal(workerReading(undefined), spec, undefined) ?? "",
      /^PREVIEW_RUNTIME_MISMATCH: the Worker will serve the client-only preview/,
    );
  });

  it("accepts a client Worker default with start specs only because Themes declare start", () => {
    const spec = readSpecPreviewRuntime({ MORPH_E2E_PREVIEW_RUNTIME: "start" });
    assert.equal(previewRuntimeRefusal(workerReading(undefined), spec, recordStart), null);
    assert.ok(previewRuntimeRefusal(workerReading(undefined), spec));
  });

  it("accepts a declared client record over a start Worker default for client specs", () => {
    const record = readRecordedPreviewRuntime({ MORPH_E2E_RECORD_PREVIEW_RUNTIME: "client" });
    assert.equal(previewRuntimeRefusal(workerReading("start"), readSpecPreviewRuntime({}), record), null);
  });

  it("refuses a declared record the specs do not expect, even when the Worker's default matches them", () => {
    const refusal = previewRuntimeRefusal(workerReading(undefined), readSpecPreviewRuntime({}), recordStart);
    assert.match(refusal ?? "", /^PREVIEW_RUNTIME_MISMATCH: the run's Themes will record "start"/);
    assert.match(refusal ?? "", /MORPH_E2E_RECORD_PREVIEW_RUNTIME="start"/);
    assert.match(refusal ?? "", /client-only branches/);
  });

  it("refuses a record value that names no runtime", () => {
    const record = readRecordedPreviewRuntime({ MORPH_E2E_RECORD_PREVIEW_RUNTIME: "Start" });
    assert.match(
      previewRuntimeRefusal(workerReading(undefined), readSpecPreviewRuntime({}), record) ?? "",
      /^PREVIEW_RUNTIME_UNKNOWN: MORPH_E2E_RECORD_PREVIEW_RUNTIME="Start"/,
    );
  });

  it("accepts only record-mode spec files, named explicitly", () => {
    assert.equal(recordModeSelectionRefusal(["e2e/native-compat-preview.spec.ts"]), null);
    assert.equal(
      recordModeSelectionRefusal(["native-compat-preview.spec.ts:42", "-g", "server routes", "--workers=1"]),
      null,
    );
    assert.equal(recordModeSelectionRefusal(["/home/x/morph/e2e/loader-data-binding.spec.ts"]), null);
    assert.match(
      recordModeSelectionRefusal(["e2e/native-compat-preview.spec.ts", "e2e/catalog.spec.ts"]) ?? "",
      /^RECORD_MODE_SELECTION: .*"e2e\/catalog\.spec\.ts"/,
    );
    assert.match(recordModeSelectionRefusal([]) ?? "", /whole suite/);
    assert.match(recordModeSelectionRefusal(["-g", "native-compat-preview.spec.ts"]) ?? "", /whole suite/);
    assert.match(recordModeSelectionRefusal(["--shard=1/6"]) ?? "", /selects a shard/);
    // A file name that only contains a listed one is not it.
    assert.ok(recordModeSelectionRefusal(["e2e/old-native-compat-preview.spec.ts"]));
  });
});

describe("record mode once a Theme exists", () => {
  const THEME = "11111111-2222-4333-8444-555555555555";
  /** @param {Partial<Parameters<typeof recordedThemeRefusal>[0]>} input */
  const verify = (input) =>
    recordedThemeRefusal({
      themeId: THEME,
      rows: [{ preview_runtime: "start" }],
      declared: "start",
      workerDefault: "",
      specValue: "start",
      ...input,
    });

  it("passes a Theme that stores the declared record and resolves from it to the specs' runtime", () => {
    assert.equal(verify({}), null);
    assert.equal(verify({ workerDefault: "start" }), null);
    assert.equal(
      verify({
        rows: [{ preview_runtime: "client" }],
        declared: "client",
        workerDefault: "start",
        specValue: undefined,
      }),
      null,
    );
  });

  it("fails a Theme that records nothing, without falling back to the Worker's default", () => {
    assert.match(
      verify({ rows: [{ preview_runtime: null }] }) ?? "",
      /^RECORDED_RUNTIME_UNVERIFIED: .*stored record null, which the Worker resolves to the client-only preview from its own default/,
    );
    // Even when the default would have served the specs' runtime.
    assert.match(
      verify({ rows: [{ preview_runtime: null }], workerDefault: "start" }) ?? "",
      /from its own default \(MORPH_THEME_PREVIEW_RUNTIME="start"\)/,
    );
  });

  it("fails a Theme that records another runtime, or one that is not a runtime", () => {
    assert.match(
      verify({ rows: [{ preview_runtime: "client" }] }) ?? "",
      /stored record "client", which the Worker resolves to the client-only preview from the Theme's record/,
    );
    assert.ok(verify({ rows: [{ preview_runtime: "Start" }] }));
  });

  it("fails when the specs expect another runtime than the record resolves to", () => {
    assert.match(verify({ specValue: undefined }) ?? "", /the specs expect the client-only preview/);
  });

  it("fails a missing Theme, and a run that did not go through the runner", () => {
    assert.match(verify({ rows: [] }) ?? "", /0 rows in storefront_themes/);
    assert.match(verify({ workerDefault: undefined }) ?? "", /MORPH_E2E_WORKER_PREVIEW_RUNTIME is not set/);
  });

  it("lets a preview be read only for a verified Theme named by the editor page", () => {
    const url = `http://localhost:3100/store/00000000-0000-4000-8000-000000000002/themes/${THEME}/editor?templateId=x`;
    assert.equal(previewedThemeRefusal(url, [THEME]), null);
    assert.match(
      previewedThemeRefusal(url, []) ?? "",
      new RegExp(`preview of Theme ${THEME} is about to be read, but its stored record was never verified`),
    );
    assert.match(previewedThemeRefusal("about:blank", [THEME]) ?? "", /names no Theme/);
  });
});

describe("the record-mode spec list", () => {
  const E2E = fileURLToPath(new URL("../e2e/", import.meta.url));

  it("names spec files that go through the record helper and read the preview only through previewFrame", async () => {
    const binding = await readFile(path.join(E2E, "binding-acceptance-helpers.ts"), "utf8");
    for (const spec of RECORD_MODE_SPECS) {
      const source = await readFile(path.join(E2E, spec), "utf8");
      const through = source.includes("binding-acceptance-helpers") ? binding : source;
      assert.match(
        through,
        /verifyRecordedThemePreviewRuntime|recordThemePreviewRuntime\(/,
        `${spec} creates or records its Themes through the record helper`,
      );
      for (const text of [source, through]) {
        assert.doesNotMatch(
          text,
          /frameLocator\(|\.frame\(|contentFrame\(/,
          `${spec} reads the preview only through previewFrame`,
        );
      }
    }
  });
});
