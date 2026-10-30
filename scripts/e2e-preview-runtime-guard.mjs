// @ts-check
/**
 * Refuses an editor E2E run whose Worker and specs expect different Live
 * Preview runtimes.
 *
 * Two settings decide a run's runtime, read by two different processes:
 *
 * - the Worker reads `MORPH_THEME_PREVIEW_RUNTIME` from its bindings, which the
 *   Cloudflare Vite plugin builds with Wrangler's own `getVarsForDev`;
 * - the specs read `MORPH_E2E_PREVIEW_RUNTIME` from the environment Playwright
 *   inherits from the runner, and pick their full Start or client-only branch
 *   from it.
 *
 * Nothing compared them, and a local wrapper ran for days with the Worker on
 * the full Start preview while the specs took their client-only branches. A
 * mismatched run is evidence for neither runtime, so it is refused before
 * anything starts. Neither setting is rewritten to make them agree: which one
 * is wrong is the caller's to decide.
 *
 * The Worker's value is read with Wrangler's exported `unstable_readConfig` and
 * `unstable_getVarsForDev`, the calls the Vite plugin makes for the dev server
 * (`unstable_getMiniflareWorkerOptions` → `getVarsForDev(userConfigPath,
 * undefined, config.vars, env, …, config.secrets)`), so the precedence is
 * Wrangler's and not a copy of it: the config's `vars` for the environment,
 * overridden by exactly one of `.dev.vars.<env>` or `.dev.vars` (the first that
 * exists; they are not merged), or — only when neither exists — the `.env`
 * files, plus the shell when `CLOUDFLARE_INCLUDE_PROCESS_ENV` is set. A shell
 * variable is otherwise not a binding, and `.dev.vars.local` is never loaded.
 *
 * Both values are then read with `deploymentThemePreviewRuntime`, the Worker's
 * own rule ("exactly `start` is the full Start preview, anything else the
 * client-only one"), which the specs' `=== "start"` checks match. A value set
 * to something that is not a runtime is refused outright: the Worker and the
 * specs would both read it as client-only, but it was plainly meant as
 * something, and a run that guesses what is not evidence either.
 */

import path from "node:path";
import {
  THEME_PREVIEW_RUNTIMES,
  THEME_PREVIEW_RUNTIME_VAR,
  deploymentThemePreviewRuntime,
  resolveThemePreviewRuntime,
} from "../src/lib/storefront/theme-preview-runtime-default.mjs";

/** The variable the specs choose their runtime branch from. */
export const SPEC_PREVIEW_RUNTIME_VAR = "MORPH_E2E_PREVIEW_RUNTIME";

/**
 * Record mode: the runtime the run's Themes record (R1), read by
 * `e2e/helpers/recorded-preview-runtime.ts`. A Theme's record is served ahead
 * of the Worker's default, so a run may show that the record alone selects a
 * runtime the Worker's default does not. Never set in CI.
 */
export const RECORD_PREVIEW_RUNTIME_VAR = "MORPH_E2E_RECORD_PREVIEW_RUNTIME";

/**
 * The Worker's own `MORPH_THEME_PREVIEW_RUNTIME` as the runner read it, passed
 * to Playwright in record mode only, so the record helper resolves each
 * Theme's runtime with the Worker's rule and the Worker's value rather than
 * assuming either. Empty when the Worker has none.
 */
export const WORKER_PREVIEW_RUNTIME_FOR_SPECS_VAR = "MORPH_E2E_WORKER_PREVIEW_RUNTIME";

/**
 * The spec files (relative to `e2e/`) that may run in record mode: each
 * creates or records every Theme it previews through the record helper, which
 * verifies the stored record and its resolved runtime before the preview is
 * read, and reads the preview only through `previewFrame`, which refuses a
 * Theme that was not verified. Any other spec would be previewed as the
 * Worker's default while it expects the record, so a record-mode run that
 * selects anything else, or nothing (the whole suite), is refused. Pinned by
 * `e2e-preview-runtime-guard.test.mjs`.
 */
export const RECORD_MODE_SPECS = /** @type {const} */ ([
  "native-compat-preview.spec.ts",
  "loader-data-binding.spec.ts",
  "code-controlled-field.spec.ts",
  "spread-override-binding.spec.ts",
  "binding-acceptance-c.spec.ts",
  "binding-acceptance-p.spec.ts",
]);

/**
 * @typedef {{
 *   value: string | undefined,
 *   runtime: "client" | "start",
 *   source: string,
 * }} RuntimeReading
 */

/** @param {"client" | "start"} runtime */
function describeRuntime(runtime) {
  return runtime === "start" ? "the full Start preview" : "the client-only preview";
}

/** @param {string | undefined} value */
function isUnknown(value) {
  return (
    value !== undefined &&
    value !== "" &&
    !(/** @type {readonly string[]} */ (THEME_PREVIEW_RUNTIMES).includes(value))
  );
}

/**
 * Runs `fn` with Wrangler's console output captured instead of printed.
 * Wrangler logs through `console[level]`; the config warnings it prints here
 * are printed again by the dev server, and the "Using secrets defined in …"
 * lines are what name the file a value came from.
 *
 * @template T
 * @param {() => T} fn
 * @returns {{ result: T, lines: string[] }}
 */
function captureConsole(fn) {
  /** @type {string[]} */
  const lines = [];
  const methods = /** @type {const} */ (["log", "info", "warn", "error", "debug"]);
  const saved = methods.map((method) => console[method]);
  for (const method of methods) {
    console[method] = (...args) => {
      lines.push(args.map(String).join(" "));
    };
  }
  try {
    return { result: fn(), lines };
  } catch (error) {
    const detail = lines.join("\n").trim();
    throw new Error(
      `PREVIEW_RUNTIME_UNREADABLE: Wrangler could not read the Worker's configuration, so the runtime it would serve is unknown.${detail ? `\n${detail}` : ""}`,
      { cause: error },
    );
  } finally {
    methods.forEach((method, index) => {
      console[method] = /** @type {any} */ (saved[index]);
    });
  }
}

/**
 * The runtime the Worker will serve a Theme that records none, from the
 * bindings Wrangler would give it in `process.cwd()`.
 *
 * @param {{ cloudflareEnv: string | undefined }} options `undefined` is
 *   Wrangler's default environment, as the runner leaves `CLOUDFLARE_ENV` unset.
 * @returns {Promise<RuntimeReading>}
 */
export async function readWorkerPreviewRuntime({ cloudflareEnv }) {
  const wrangler = await import("wrangler");
  const env = cloudflareEnv || undefined;
  const { result: bindings, lines } = captureConsole(() => {
    const config = wrangler.unstable_readConfig({ env });
    return {
      config,
      vars: wrangler.unstable_getVarsForDev(
        config.userConfigPath,
        undefined,
        config.vars,
        env,
        false,
        config.secrets,
      ),
    };
  });
  const binding = bindings.vars[THEME_PREVIEW_RUNTIME_VAR];
  const value =
    binding && (binding.type === "plain_text" || binding.type === "secret_text")
      ? String(binding.value)
      : binding
        ? JSON.stringify(binding.value)
        : undefined;
  const environment = env ? `environment "${env}"` : "the default environment";
  let source;
  if (!binding) {
    source = `not set in anything Wrangler loads for the Worker (${environment})`;
  } else if (binding.type === "secret_text") {
    const files = lines
      .map((line) => /Using secrets defined in (.+)$/.exec(line.trim())?.[1])
      .filter((file) => file !== undefined);
    source = `${files.length > 0 ? files.join(" + ") : "the local dev variables"}, as Wrangler loads them for ${environment}`;
  } else {
    const configFile = bindings.config.userConfigPath
      ? path.relative(process.cwd(), bindings.config.userConfigPath)
      : "the Wrangler config";
    source = `"vars" in ${configFile} for ${environment}`;
  }
  return { value, runtime: deploymentThemePreviewRuntime(value), source };
}

/**
 * The runtime the specs will take their branches for.
 *
 * @param {NodeJS.ProcessEnv} env The environment Playwright inherits.
 * @returns {RuntimeReading}
 */
export function readSpecPreviewRuntime(env) {
  const value = env[SPEC_PREVIEW_RUNTIME_VAR];
  return {
    value,
    runtime: deploymentThemePreviewRuntime(value),
    source:
      value === undefined
        ? "unset in the runner's environment"
        : "the runner's environment (shell or .env.e2e)",
  };
}

/**
 * The runtime the run's Themes are declared to record, or undefined when the
 * run is not in record mode (unset or empty, as the record helper reads it).
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ value: string, source: string } | undefined}
 */
export function readRecordedPreviewRuntime(env) {
  const value = env[RECORD_PREVIEW_RUNTIME_VAR];
  return value === undefined || value === ""
    ? undefined
    : { value, source: "the runner's environment (shell or .env.e2e)" };
}

/** Playwright flags whose value is the next argument. */
const VALUE_FLAGS = new Set([
  "-g",
  "--grep",
  "-G",
  "--grep-invert",
  "--project",
  "-j",
  "--workers",
  "--repeat-each",
  "--retries",
  "--timeout",
  "--reporter",
  "--max-failures",
  "--config",
  "-c",
]);

/** @param {string} arg */
function isRecordModeSpec(arg) {
  const name = arg.replace(/:\d+(?::\d+)?$/, "").replaceAll("\\", "/");
  return RECORD_MODE_SPECS.some(
    (spec) => name === spec || name === `e2e/${spec}` || name.endsWith(`/e2e/${spec}`),
  );
}

/**
 * Null when every file a record-mode run selects is in `RECORD_MODE_SPECS`,
 * else the refusal.
 *
 * @param {readonly string[]} args The Playwright arguments the run was given.
 * @returns {string | null}
 */
export function recordModeSelectionRefusal(args) {
  const listed = RECORD_MODE_SPECS.join(", ");
  /** @type {string[]} */
  const files = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--shard")) {
      return `RECORD_MODE_SELECTION: ${RECORD_PREVIEW_RUNTIME_VAR} is set and the run selects a shard, which holds specs that do not record their Themes. Select record-mode spec files by name: ${listed}.`;
    }
    if (VALUE_FLAGS.has(arg)) {
      i += 1;
      continue;
    }
    if (arg.startsWith("-")) continue;
    files.push(arg);
  }
  if (files.length === 0) {
    return `RECORD_MODE_SELECTION: ${RECORD_PREVIEW_RUNTIME_VAR} is set and the run selects the whole suite, most of which previews Themes that record nothing. Select record-mode spec files by name: ${listed}.`;
  }
  const outside = files.filter((file) => !isRecordModeSpec(file));
  return outside.length === 0
    ? null
    : `RECORD_MODE_SELECTION: ${RECORD_PREVIEW_RUNTIME_VAR} is set and the run selects ${outside.map((file) => JSON.stringify(file)).join(", ")}, not a record-mode spec file. Only these record every Theme they preview through the record helper: ${listed}.`;
}

/** @param {string} name @param {RuntimeReading} reading */
function describeSetting(name, reading) {
  return reading.value === undefined
    ? `${name} unset (${reading.source})`
    : `${name}=${JSON.stringify(reading.value)} from ${reading.source}`;
}

/**
 * Null when the run's settings agree, else the refusal.
 *
 * Without record mode the Worker's default is what every Theme is served
 * with, and it must equal the specs' runtime. In record mode the run's Themes
 * record a runtime, and the Worker serves a Theme's record ahead of its
 * default (`resolveThemePreviewRuntime`, the Worker's own rule), so it is that
 * resolution that must equal the specs' runtime. That is a claim about Themes
 * that do not exist yet: the record helper checks each one's stored record
 * and resolution once it does, before its preview is read.
 *
 * @param {RuntimeReading} worker
 * @param {RuntimeReading} spec
 * @param {{ value: string, source: string }} [record] From `readRecordedPreviewRuntime`.
 * @returns {string | null}
 */
export function previewRuntimeRefusal(worker, spec, record) {
  const workerSetting = describeSetting(THEME_PREVIEW_RUNTIME_VAR, worker);
  const specSetting = describeSetting(SPEC_PREVIEW_RUNTIME_VAR, spec);
  const recordSetting = record
    ? `${RECORD_PREVIEW_RUNTIME_VAR}=${JSON.stringify(record.value)} from ${record.source}`
    : null;
  const unknown = [
    isUnknown(worker.value) ? workerSetting : null,
    isUnknown(spec.value) ? specSetting : null,
    record && isUnknown(record.value) ? recordSetting : null,
  ].filter((setting) => setting !== null);
  if (unknown.length > 0) {
    return `PREVIEW_RUNTIME_UNKNOWN: ${unknown.join("; ")}. The runtimes are ${THEME_PREVIEW_RUNTIMES.join(" and ")}; anything else is read as client-only, which is not what a value set to something else meant. Set it to one of them or remove it. Nothing was changed.`;
  }
  if (record) {
    const resolved = resolveThemePreviewRuntime({
      recorded: record.value,
      deploymentEnvValue: worker.value,
    });
    if (resolved.runtime !== spec.runtime) {
      return `PREVIEW_RUNTIME_MISMATCH: the run's Themes will record ${JSON.stringify(record.value)} (${recordSetting}), which the Worker serves ahead of its default (${workerSetting}), so they get ${describeRuntime(resolved.runtime)}; but the specs will take their ${spec.runtime === "start" ? "full Start" : "client-only"} branches (${specSetting}). A run like that is evidence for neither runtime. Set them to the same runtime; nothing was changed.`;
    }
    return null;
  }
  if (worker.runtime !== spec.runtime) {
    return `PREVIEW_RUNTIME_MISMATCH: the Worker will serve ${describeRuntime(worker.runtime)} (${workerSetting}), but the specs will take their ${spec.runtime === "start" ? "full Start" : "client-only"} branches (${specSetting}). A run like that is evidence for neither runtime. Set both to the same runtime; nothing was changed.`;
  }
  return null;
}

/**
 * Where the record helper lists the Themes it verified, in the run's state
 * directory: a file rather than memory, so a worker Playwright restarts after a
 * failure still knows a fixture Theme it reuses was verified.
 */
export const RECORD_VERIFIED_FILE = "recorded-preview-runtime-verified.json";

/** The precondition projects in playwright.config.ts; see `previewedThemeRefusal`. */
export const RECORD_GATE_EXEMPT_PROJECTS = /** @type {readonly string[]} */ ([
  "setup",
  "preview-transport",
]);

/**
 * Null when a record-mode Theme, as stored, is served the runtime the specs
 * expect because of its own record; else why not. Read by the record helper
 * once the Theme exists and before its preview is read.
 *
 * Its stored record must be exactly the declared one, and the Worker's rule
 * (`resolveThemePreviewRuntime`) applied to that record and the Worker's
 * actual default must resolve from the Theme's record (`source: "theme"`) to
 * the specs' runtime. A Theme that records nothing fails even when the
 * Worker's default happens to match: that would be the default being
 * exercised, not the record.
 *
 * @param {{
 *   themeId: string,
 *   rows: ReadonlyArray<Record<string, unknown>>,
 *   declared: "client" | "start",
 *   workerDefault: string | undefined,
 *   specValue: string | undefined,
 * }} input `rows`: the Theme's `preview_runtime` rows, as read back.
 *   `workerDefault`: `MORPH_E2E_WORKER_PREVIEW_RUNTIME`, set by the runner.
 * @returns {string | null}
 */
export function recordedThemeRefusal({ themeId, rows, declared, workerDefault, specValue }) {
  const prefix = `RECORDED_RUNTIME_UNVERIFIED: ${RECORD_PREVIEW_RUNTIME_VAR}=${JSON.stringify(declared)}, Theme ${themeId}`;
  if (workerDefault === undefined) {
    return `${prefix}: ${WORKER_PREVIEW_RUNTIME_FOR_SPECS_VAR} is not set, so the Worker's default is unknown here. Run through scripts/run-editor-e2e.mjs, which sets it after checking the run's settings.`;
  }
  if (rows.length !== 1) {
    return `${prefix}: ${rows.length} rows in storefront_themes, not one.`;
  }
  const stored = rows[0]?.preview_runtime ?? null;
  const resolved = resolveThemePreviewRuntime({
    recorded: typeof stored === "string" ? stored : null,
    deploymentEnvValue: workerDefault,
  });
  const expected = deploymentThemePreviewRuntime(specValue);
  if (stored === declared && resolved.source === "theme" && resolved.runtime === expected) {
    return null;
  }
  return `${prefix}: stored record ${JSON.stringify(stored)}, which the Worker resolves to ${describeRuntime(resolved.runtime)} from ${resolved.source === "theme" ? "the Theme's record" : `its own default (${THEME_PREVIEW_RUNTIME_VAR}=${JSON.stringify(workerDefault)})`}; the run declared ${JSON.stringify(declared)} and the specs expect ${describeRuntime(expected)} (${SPEC_PREVIEW_RUNTIME_VAR}=${JSON.stringify(specValue ?? null)}). Create or record the Theme through e2e/helpers/recorded-preview-runtime.ts; nothing was changed.`;
}

/**
 * Null when the editor page whose preview is about to be read names a Theme
 * the record helper verified; else why not. Read by `previewFrame` in record
 * mode, which every record-mode spec reads its preview through.
 *
 * The Playwright projects that run before the specs as preconditions are not
 * gated: `setup` signs in, and `preview-transport` checks which transport
 * serves the seeded Theme, whichever runtime that Theme is served. Neither is
 * preview acceptance for a runtime, and neither previews a Theme the specs
 * create. Every other project is gated, so a spec run in record mode outside
 * the runner, or outside `RECORD_MODE_SPECS`, still cannot read an unverified
 * Theme's preview.
 *
 * @param {string} pageUrl
 * @param {readonly string[]} verifiedThemeIds
 * @param {string} projectName The Playwright project of the calling test.
 * @returns {string | null}
 */
export function previewedThemeRefusal(pageUrl, verifiedThemeIds, projectName) {
  if (RECORD_GATE_EXEMPT_PROJECTS.includes(projectName)) return null;
  let pathname = "";
  try {
    pathname = new URL(pageUrl).pathname;
  } catch {
    pathname = "";
  }
  const match = /\/themes\/([0-9a-f-]{36})(?=\/|$)/.exec(pathname);
  if (!match) {
    return `RECORDED_RUNTIME_UNVERIFIED: ${RECORD_PREVIEW_RUNTIME_VAR} is set, and a preview is about to be read from a page that names no Theme (${pathname || pageUrl}), so whether its Theme's record was verified is unknown.`;
  }
  return verifiedThemeIds.includes(match[1])
    ? null
    : `RECORDED_RUNTIME_UNVERIFIED: ${RECORD_PREVIEW_RUNTIME_VAR} is set, and the preview of Theme ${match[1]} is about to be read, but its stored record was never verified. Unverified, it may be served the Worker's default instead of the record. Create or record the Theme through e2e/helpers/recorded-preview-runtime.ts.`;
}
