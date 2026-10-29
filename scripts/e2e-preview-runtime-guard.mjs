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
} from "../src/lib/storefront/theme-preview-runtime-default.mjs";

/** The variable the specs choose their runtime branch from. */
export const SPEC_PREVIEW_RUNTIME_VAR = "MORPH_E2E_PREVIEW_RUNTIME";

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

/** @param {string} name @param {RuntimeReading} reading */
function describeSetting(name, reading) {
  return reading.value === undefined
    ? `${name} unset (${reading.source})`
    : `${name}=${JSON.stringify(reading.value)} from ${reading.source}`;
}

/**
 * Null when the two agree, else the refusal.
 *
 * @param {RuntimeReading} worker
 * @param {RuntimeReading} spec
 * @returns {string | null}
 */
export function previewRuntimeRefusal(worker, spec) {
  const workerSetting = describeSetting(THEME_PREVIEW_RUNTIME_VAR, worker);
  const specSetting = describeSetting(SPEC_PREVIEW_RUNTIME_VAR, spec);
  const unknown = [
    isUnknown(worker.value) ? workerSetting : null,
    isUnknown(spec.value) ? specSetting : null,
  ].filter((setting) => setting !== null);
  if (unknown.length > 0) {
    return `PREVIEW_RUNTIME_UNKNOWN: ${unknown.join("; ")}. The runtimes are ${THEME_PREVIEW_RUNTIMES.join(" and ")}; anything else is read as client-only, which is not what a value set to something else meant. Set it to one of them or remove it. Nothing was changed.`;
  }
  if (worker.runtime !== spec.runtime) {
    return `PREVIEW_RUNTIME_MISMATCH: the Worker will serve ${describeRuntime(worker.runtime)} (${workerSetting}), but the specs will take their ${spec.runtime === "start" ? "full Start" : "client-only"} branches (${specSetting}). A run like that is evidence for neither runtime. Set both to the same runtime; nothing was changed.`;
  }
  return null;
}
