import type { DeployTarget } from "./deploy-target";

/**
 * How a Core deploy runs Wrangler: one pinned binary, one fixed argv, one
 * controlled environment.
 *
 * The no-hostname guarantee (design 2) was read from the source of these two
 * versions. An upgrade of either is a re-read of that source and a re-run of
 * the request-recording harness (`wrangler-trigger-writes.test.ts`), not a
 * lockfile bump.
 */
export const PINNED_WRANGLER_VERSION = "4.146.0";
export const PINNED_VITE_PLUGIN_VERSION = "1.62.4";

/** The official API. Nothing a Core deploy reads may move it. */
export const CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4";

/**
 * The argv, with nothing from the caller in it.
 *
 * - no `--config`: Wrangler follows `.wrangler/deploy/config.json` to the
 *   artifact the guard checked, and an explicit config would bypass that;
 * - no `--route(s)` or `--domain(s)`: those are added to the config's list;
 * - `--no-autoconfig`: framework detection may rewrite the config it deploys;
 * - `--env-file /dev/null`: no `.env` in the checkout can set Wrangler's own
 *   settings (the API address among them).
 */
export function wranglerDeployArgv(wranglerBin: string): readonly string[] {
  return [wranglerBin, "deploy", "--no-autoconfig", "--env-file", "/dev/null"];
}

export type CoreDeployCommand = "deploy" | "ensure-platform-bindings" | "verify";

export type RunnerOptions = Readonly<{
  targetPath: string | null;
  bootstrap: boolean;
}>;

/** Flags Wrangler would honour, named so the refusal says what they would do. */
const WRANGLER_FLAG_REASONS: ReadonlyArray<[RegExp, string]> = [
  [/^--(routes?|domains?)(=|$)/, "adds hostnames to the deploy; Core's deploy binds none"],
  [/^(--config|-c)(=|$)/, "bypasses the checked artifact"],
  [/^(--env|-e)(=|$)/, "selects another environment than the checked one"],
  [/^--name(=|$)/, "renames the Worker being deployed"],
  [/^--(script|assets|dispatch-namespace|compatibility-date|triggers?|schedules?)(=|$)/, "changes what is deployed"],
];

/**
 * The runner's own flags; nothing is forwarded to Wrangler. `pnpm run deploy
 * -- --route x` must be refused, not passed on.
 */
export function parseRunnerArgs(
  command: CoreDeployCommand,
  args: readonly string[],
): { ok: true; options: RunnerOptions } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  let targetPath: string | null = null;
  let bootstrap = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--target") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        problems.push("--target needs a path.");
      } else {
        targetPath = value;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--target=")) {
      targetPath = arg.slice("--target=".length) || null;
      if (!targetPath) problems.push("--target needs a path.");
      continue;
    }
    if (arg === "--bootstrap" && command === "deploy") {
      bootstrap = true;
      continue;
    }
    if (arg === "--") continue;
    const reason = WRANGLER_FLAG_REASONS.find(([pattern]) => pattern.test(arg));
    problems.push(
      reason
        ? `Refused ${arg}: it ${reason[1]}. Core deploy arguments are fixed and are never passed to Wrangler.`
        : `Unknown argument ${arg}. Core deploy arguments are fixed and are never passed to Wrangler.`,
    );
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, options: { targetPath, bootstrap } };
}

/**
 * Environment variables that change what Wrangler deploys or where it sends
 * the credential. Refused rather than removed: an operator who set one meant
 * something by it, and silently deploying something else is the failure this
 * guard exists to prevent.
 */
const REFUSED_ENV: ReadonlyArray<[string, string]> = [
  ["WRANGLER_CI_OVERRIDE_NAME", "renames the Worker Wrangler deploys"],
  ["WRANGLER_CI_MATCH_TAG", "is a Workers CI setting"],
  ["WRANGLER_CI_GENERATE_PREVIEW_ALIAS", "is a Workers CI setting"],
  ["CLOUDFLARE_ENV", "selects a Wrangler environment at build and deploy time"],
  ["CLOUDFLARE_API_KEY", "is a global API key, which Wrangler prefers to the token"],
  ["CLOUDFLARE_EMAIL", "goes with a global API key"],
];

export function checkDeployEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  target: DeployTarget,
  needs: Readonly<{ deployToken: boolean }>,
): string[] {
  const problems: string[] = [];
  for (const [name, reason] of REFUSED_ENV) {
    if (env[name] !== undefined && env[name] !== "") {
      problems.push(`${name} is set; it ${reason}. Unset it.`);
    }
  }
  if (env.CLOUDFLARE_API_BASE_URL && env.CLOUDFLARE_API_BASE_URL !== CLOUDFLARE_API_BASE_URL) {
    problems.push(`CLOUDFLARE_API_BASE_URL is ${env.CLOUDFLARE_API_BASE_URL}; a Core deploy uses the official API only.`);
  }
  if (env.WRANGLER_API_ENVIRONMENT && env.WRANGLER_API_ENVIRONMENT !== "production") {
    problems.push(`WRANGLER_API_ENVIRONMENT is ${env.WRANGLER_API_ENVIRONMENT}; a Core deploy uses the production API.`);
  }
  if (needs.deployToken) {
    if (!env.CLOUDFLARE_API_TOKEN) problems.push("CLOUDFLARE_API_TOKEN (the deploy credential) is not set.");
    if (env.CLOUDFLARE_ACCOUNT_ID !== target.accountId) {
      problems.push(
        "CLOUDFLARE_ACCOUNT_ID must be set to the target account; Wrangler otherwise picks one from its login cache.",
      );
    }
  } else if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_ACCOUNT_ID !== target.accountId) {
    problems.push("CLOUDFLARE_ACCOUNT_ID names another account than the target.");
  }
  if (!env.MORPH_INVENTORY_API_TOKEN) {
    problems.push("MORPH_INVENTORY_API_TOKEN (the read-only inventory credential) is not set.");
  }
  return problems;
}

/** Credentials that belong to the inventory and bootstrap steps, never to Wrangler. */
const NON_WRANGLER_CREDENTIALS = ["MORPH_INVENTORY_API_TOKEN", "MORPH_BOOTSTRAP_API_TOKEN"];

/**
 * The environment the migration check, the build and Wrangler run with: this
 * process's, without the other steps' credentials, with Wrangler's
 * destination settings pinned (a non-empty value is not replaced by a `.env`
 * file) and its prompts off.
 */
export function deployChildEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (NON_WRANGLER_CREDENTIALS.includes(key)) continue;
    out[key] = value;
  }
  out.CLOUDFLARE_API_BASE_URL = CLOUDFLARE_API_BASE_URL;
  out.WRANGLER_API_ENVIRONMENT = "production";
  out.CLOUDFLARE_COMPLIANCE_REGION = "public";
  out.CI = "true";
  return out;
}

/**
 * The installed tools must be the pinned ones, and `package.json` must pin
 * Wrangler exactly so that an install cannot float past the checked version.
 */
export function checkPinnedTools(input: {
  packageJson: unknown;
  installedWranglerVersion: unknown;
  installedVitePluginVersion: unknown;
}): string[] {
  const problems: string[] = [];
  const pkg = input.packageJson as
    | { devDependencies?: Record<string, string>; dependencies?: Record<string, string> }
    | undefined;
  const declared = pkg?.devDependencies?.wrangler ?? pkg?.dependencies?.wrangler;
  if (declared !== PINNED_WRANGLER_VERSION) {
    problems.push(`package.json declares wrangler ${JSON.stringify(declared)}; Core deploy requires exactly ${PINNED_WRANGLER_VERSION}.`);
  }
  if (input.installedWranglerVersion !== PINNED_WRANGLER_VERSION) {
    problems.push(
      `Installed wrangler is ${JSON.stringify(input.installedWranglerVersion)}; Core deploy requires exactly ${PINNED_WRANGLER_VERSION}. An upgrade needs the source check and the harness re-run first.`,
    );
  }
  if (input.installedVitePluginVersion !== PINNED_VITE_PLUGIN_VERSION) {
    problems.push(
      `Installed @cloudflare/vite-plugin is ${JSON.stringify(input.installedVitePluginVersion)}; the artifact guard was checked against ${PINNED_VITE_PLUGIN_VERSION}.`,
    );
  }
  return problems;
}
