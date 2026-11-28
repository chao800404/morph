import path from "node:path";
import type { DeployTarget } from "./deploy-target";
import { platformManifest } from "./platform-manifest";

/**
 * The effective-config guard for a Core deploy (design 2, option B).
 *
 * Under option B, Core's deploy config never binds a hostname: no `route` or
 * `routes` key anywhere, in any form. The pinned Wrangler (4.146.0) sends no
 * request to the Custom Domain or Workers Route write endpoints when the
 * effective route list is empty, so a deploy cannot remove a storefront's
 * Custom Domain. A non-empty Custom Domain list is sent as a replace-state
 * changeset, which removes every Custom Domain the list does not name — the
 * staging incident — and a wildcard-only list replaces the Worker's Routes.
 *
 * `[]` is refused too. It is harmless in this Wrangler, but it is a key that
 * a later edit turns into a list, and "the key is absent" is a rule a reviewer
 * can check at a glance. Inheritance is the other reason to check every
 * environment section: a named environment without `routes` inherits the
 * top-level list.
 *
 * Both `workers_dev` and `preview_urls` must be an explicit `false`: with no
 * routes, Wrangler turns `workers_dev` on by default.
 *
 * What Wrangler deploys is the built artifact, found through the
 * `.wrangler/deploy/config.json` redirect, not `wrangler.jsonc`; the guard
 * checks both and the redirect between them.
 */

export const ROUTE_KEYS = ["route", "routes"] as const;

/** The redirect Wrangler follows when it finds no `--config`. */
export const DEPLOY_REDIRECT_PATH = path.join(".wrangler", "deploy", "config.json");
/** Where the Cloudflare Vite plugin writes the Worker's deploy config. */
export const ARTIFACT_CONFIG_PATH = path.join("dist", "server", "wrangler.json");

type Config = Record<string, unknown>;

function isObject(value: unknown): value is Config {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sections(config: Config): Array<{ label: string; section: Config }> {
  const out = [{ label: "top level", section: config }];
  const env = config.env;
  if (env !== undefined) {
    if (isObject(env)) {
      for (const [name, section] of Object.entries(env)) {
        if (isObject(section)) out.push({ label: `env.${name}`, section });
      }
    }
  }
  return out;
}

/**
 * Keys that `JSON.parse` keeps as plain own properties but the pinned
 * Wrangler's parser assigns, so that `"__proto__": {"routes": [...]}` becomes
 * an inherited Custom Domain list Wrangler deploys while an own-key check sees
 * nothing. Refused anywhere in the document.
 */
const PROTOTYPE_KEYS = ["__proto__", "constructor", "prototype"];

function prototypeKeys(value: unknown, at: string, found: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => prototypeKeys(item, `${at}[${index}]`, found));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (PROTOTYPE_KEYS.includes(key)) found.push(`${at}.${key}`);
    prototypeKeys((value as Record<string, unknown>)[key], `${at}.${key}`, found);
  }
}

/** Route keys, `unsafe`, prototype keys and exposure flags, in every section. */
function checkBindingPolicy(config: Config, label: string): string[] {
  const problems: string[] = [];
  const found: string[] = [];
  prototypeKeys(config, "$", found);
  for (const where of found) {
    problems.push(`${label}: ${where} is a prototype key; Wrangler's parser would turn it into inherited config (routes among them). Refused anywhere.`);
  }
  for (const { label: where, section } of sections(config)) {
    // `in`, not an own-key check: Wrangler's normalizer reads inherited
    // properties, so an inherited route list is a route list.
    for (const key of ROUTE_KEYS) {
      if (key in section) {
        problems.push(
          `${label}: ${where} has "${key}" (${JSON.stringify(section[key])}). Core's deploy config must not contain route or routes in any form, including []; platform hostnames are bound by platform:ensure and storefront domains by Settings.`,
        );
      }
    }
    if ("unsafe" in section) {
      problems.push(
        `${label}: ${where} has "unsafe" (${JSON.stringify(section.unsafe)}). Its metadata is applied after the upload metadata is built and can rewrite any binding, the D1 database among them; Core's deploy config must not contain it.`,
      );
    }
    if (where !== "top level") {
      for (const flag of ["workers_dev", "preview_urls"]) {
        if (section[flag] !== undefined && section[flag] !== false) {
          problems.push(`${label}: ${where} sets ${flag} to ${JSON.stringify(section[flag])}; only false is allowed.`);
        }
      }
    }
  }
  for (const flag of ["workers_dev", "preview_urls"]) {
    if (config[flag] !== false) {
      problems.push(
        `${label}: ${flag} must be explicitly false (found ${JSON.stringify(config[flag])}). With no routes Wrangler enables workers.dev by default.`,
      );
    }
  }
  if (config.env !== undefined && !isObject(config.env)) {
    problems.push(`${label}: env must be an object.`);
  }
  return problems;
}

function bindingMap(
  value: unknown,
  idField: string,
): Record<string, string> | null {
  if (value === undefined) return {};
  if (!Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const entry of value) {
    if (!isObject(entry) || typeof entry.binding !== "string") return null;
    const id = entry[idField];
    if (typeof id !== "string") return null;
    if (out[entry.binding] !== undefined) return null;
    out[entry.binding] = id;
  }
  return out;
}

function sameMap(a: Record<string, string>, b: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/** Worker name, account and resource ids, at the top level (what is deployed). */
function checkIdentity(config: Config, target: DeployTarget, label: string): string[] {
  const problems: string[] = [];
  if (config.name !== target.workerName) {
    problems.push(`${label}: name is ${JSON.stringify(config.name)}, the target is "${target.workerName}".`);
  }
  if (config.account_id !== undefined && config.account_id !== target.accountId) {
    problems.push(`${label}: account_id ${JSON.stringify(config.account_id)} is not the target account.`);
  }
  const resources: Array<[string, string, Readonly<Record<string, string>>]> = [
    ["d1_databases", "database_id", target.d1Databases],
    ["kv_namespaces", "id", target.kvNamespaces],
    ["r2_buckets", "bucket_name", target.r2Buckets],
  ];
  for (const [key, idField, expected] of resources) {
    const actual = bindingMap(config[key], idField);
    if (!actual) {
      problems.push(`${label}: ${key} is not a list of bindings with ${idField}.`);
    } else if (!sameMap(actual, expected)) {
      problems.push(
        `${label}: ${key} binds ${JSON.stringify(actual)}, the target is ${JSON.stringify(expected)}.`,
      );
    }
  }
  const vars = isObject(config.vars) ? config.vars : {};
  if (vars.CLOUDFLARE_WORKER_SERVICE !== undefined && vars.CLOUDFLARE_WORKER_SERVICE !== target.workerName) {
    problems.push(
      `${label}: vars.CLOUDFLARE_WORKER_SERVICE is ${JSON.stringify(vars.CLOUDFLARE_WORKER_SERVICE)}; the storefront domain provider would bind domains to another Worker.`,
    );
  }
  return problems;
}

/**
 * `wrangler.jsonc` as written: binding policy in every section, identities at
 * the top level, and a platform manifest the vars can produce.
 */
export function checkSourceConfig(config: unknown, target: DeployTarget): string[] {
  if (!isObject(config)) return ["wrangler.jsonc: not a JSON object."];
  const problems = [
    ...checkBindingPolicy(config, "wrangler.jsonc"),
    ...checkIdentity(config, target, "wrangler.jsonc"),
  ];
  const manifest = platformManifest(isObject(config.vars) ? config.vars : undefined);
  if (!manifest.ok) {
    problems.push(...manifest.problems.map((problem) => `wrangler.jsonc vars: ${problem}`));
  }
  return problems;
}

/**
 * The redirect must point at the artifact this build wrote, and nothing else:
 * a redirect left by another build, or one naming auxiliary Workers, deploys
 * something the guard did not read.
 */
export function checkDeployRedirect(
  redirect: unknown,
  rootDir: string,
): { ok: true; artifactPath: string } | { ok: false; problems: string[] } {
  if (!isObject(redirect) || typeof redirect.configPath !== "string") {
    return { ok: false, problems: [`${DEPLOY_REDIRECT_PATH}: no configPath.`] };
  }
  const resolved = path.resolve(rootDir, path.dirname(DEPLOY_REDIRECT_PATH), redirect.configPath);
  const expected = path.resolve(rootDir, ARTIFACT_CONFIG_PATH);
  const problems: string[] = [];
  if (resolved !== expected) {
    problems.push(`${DEPLOY_REDIRECT_PATH} points at ${resolved}, not the build's ${expected}.`);
  }
  const auxiliary = redirect.auxiliaryWorkers;
  if (auxiliary !== undefined && (!Array.isArray(auxiliary) || auxiliary.length > 0)) {
    problems.push(`${DEPLOY_REDIRECT_PATH} names auxiliary Workers; Core deploys one Worker.`);
  }
  for (const key of Object.keys(redirect)) {
    if (key !== "configPath" && key !== "auxiliaryWorkers") {
      problems.push(`${DEPLOY_REDIRECT_PATH} has an unknown field "${key}".`);
    }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, artifactPath: expected };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * The built `dist/server/wrangler.json` — what Wrangler uploads. Same policy
 * and identities as the source, and the same vars, so the platform manifest
 * checked on the source is the one the deployed Worker reserves.
 */
export function checkArtifactConfig(
  artifact: unknown,
  source: unknown,
  target: DeployTarget,
  sourceConfigPath: string,
): string[] {
  if (!isObject(artifact)) return [`${ARTIFACT_CONFIG_PATH}: not a JSON object.`];
  const problems = [
    ...checkBindingPolicy(artifact, ARTIFACT_CONFIG_PATH),
    ...checkIdentity(artifact, target, ARTIFACT_CONFIG_PATH),
  ];
  // The Vite plugin records the config it built from. Another file there means
  // the artifact did not come from the config this guard read.
  if (artifact.userConfigPath !== undefined && artifact.userConfigPath !== sourceConfigPath) {
    problems.push(
      `${ARTIFACT_CONFIG_PATH}: built from ${JSON.stringify(artifact.userConfigPath)}, not ${sourceConfigPath}.`,
    );
  }
  if (artifact.topLevelName !== undefined && artifact.topLevelName !== target.workerName) {
    problems.push(`${ARTIFACT_CONFIG_PATH}: topLevelName is ${JSON.stringify(artifact.topLevelName)}.`);
  }
  const sourceVars = isObject(source) && isObject(source.vars) ? source.vars : {};
  const artifactVars = isObject(artifact.vars) ? artifact.vars : {};
  if (stableJson(sourceVars) !== stableJson(artifactVars)) {
    problems.push(`${ARTIFACT_CONFIG_PATH}: vars differ from wrangler.jsonc; the build used another config or environment.`);
  }
  return problems;
}

/**
 * The pinned Wrangler's own normalized config for the verified snapshot
 * (`unstable_readConfig`), checked with the same policy: what Wrangler will
 * deploy, after its own parsing, inheritance and defaults.
 */
export function checkNormalizedConfig(normalized: unknown, target: DeployTarget): string[] {
  const label = "Wrangler's reader";
  if (!isObject(normalized)) return [`${label}: no config.`];
  const problems: string[] = [];
  const routes = normalized.routes;
  if (routes !== undefined) {
    problems.push(`${label}: routes is ${JSON.stringify(routes)}; Core deploys none, not even [].`);
  }
  if (normalized.route !== undefined) {
    problems.push(`${label}: route is ${JSON.stringify(normalized.route)}.`);
  }
  for (const flag of ["workers_dev", "preview_urls"]) {
    if (normalized[flag] !== false) problems.push(`${label}: ${flag} is ${JSON.stringify(normalized[flag])}, not false.`);
  }
  if (normalized.name !== target.workerName) {
    problems.push(`${label}: name is ${JSON.stringify(normalized.name)}, the target is "${target.workerName}".`);
  }
  const unsafe = normalized.unsafe;
  if (unsafe !== undefined && !(isObject(unsafe) && Object.keys(unsafe).length === 0)) {
    problems.push(`${label}: unsafe is ${JSON.stringify(unsafe)}.`);
  }
  const d1 = bindingMap(normalized.d1_databases, "database_id");
  if (!d1 || !sameMap(d1, target.d1Databases)) {
    problems.push(
      `${label}: d1_databases binds ${JSON.stringify(d1)}, the target (and the migration check) is ${JSON.stringify(target.d1Databases)}.`,
    );
  }
  return problems;
}
