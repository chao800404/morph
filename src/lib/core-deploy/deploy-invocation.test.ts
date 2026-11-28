// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLOUDFLARE_API_BASE_URL,
  PINNED_VITE_PLUGIN_VERSION,
  PINNED_WRANGLER_VERSION,
  checkDeployEnvironment,
  checkPinnedTools,
  deployChildEnv,
  parseRunnerArgs,
  wranglerDeployArgv,
} from "./deploy-invocation";
import type { DeployTarget } from "./deploy-target";
import { ACCOUNT, D1_ID, WORKER } from "./test-support/mock-cloudflare-api";

const TARGET: DeployTarget = {
  accountId: ACCOUNT,
  workerName: WORKER,
  environment: "production",
  d1Databases: { DATABASE: D1_ID },
  kvNamespaces: {},
  r2Buckets: {},
};

const DEPLOY_ENV = {
  CLOUDFLARE_API_TOKEN: "deploy-token",
  CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
  MORPH_INVENTORY_API_TOKEN: "inventory-token",
};

describe("the runner's arguments", () => {
  it("accepts only --target and, for deploy, --bootstrap", () => {
    expect(parseRunnerArgs("deploy", ["--target", "t.json", "--bootstrap"])).toEqual({
      ok: true,
      options: { targetPath: "t.json", bootstrap: true },
    });
    expect(parseRunnerArgs("verify", ["--bootstrap"]).ok).toBe(false);
  });

  it.each([
    ["--route", "admin.example.com"],
    ["--routes", "admin.example.com/*"],
    ["--route=admin.example.com"],
    ["--domain", "admin.example.com"],
    ["--domains", "admin.example.com"],
    ["--config", "wrangler.stg.jsonc"],
    ["-c", "wrangler.stg.jsonc"],
    ["--env", "staging"],
    ["-e", "staging"],
    ["--name", "other"],
    ["--containers-rollout", "none"],
  ])("refuses %s (never forwarded to Wrangler)", (...args) => {
    const parsed = parseRunnerArgs("deploy", args);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.problems[0]).toMatch(/never passed to Wrangler/);
  });

  it("names why a hostname alias is refused", () => {
    const parsed = parseRunnerArgs("deploy", ["--", "--domain", "x.example.com"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.problems[0]).toMatch(/adds hostnames/);
  });
});

describe("the Wrangler invocation", () => {
  it("is a fixed argv with no config, route or domain override, autoconfig off and no .env", () => {
    const argv = wranglerDeployArgv("/repo/node_modules/wrangler/bin/wrangler.js");
    expect(argv).toEqual([
      "/repo/node_modules/wrangler/bin/wrangler.js",
      "deploy",
      "--no-autoconfig",
      "--env-file",
      "/dev/null",
    ]);
    expect(argv.join(" ")).not.toMatch(/--config|-c |--route|--domain|--env /);
  });

  it("keeps the inventory and bootstrap credentials away from Wrangler and pins its destination", () => {
    const env = deployChildEnv({
      ...DEPLOY_ENV,
      MORPH_BOOTSTRAP_API_TOKEN: "bootstrap-token",
      PATH: "/usr/bin",
    });
    expect(env.MORPH_INVENTORY_API_TOKEN).toBeUndefined();
    expect(env.MORPH_BOOTSTRAP_API_TOKEN).toBeUndefined();
    expect(env).toMatchObject({
      CLOUDFLARE_API_TOKEN: "deploy-token",
      CLOUDFLARE_API_BASE_URL: CLOUDFLARE_API_BASE_URL,
      WRANGLER_API_ENVIRONMENT: "production",
      CLOUDFLARE_COMPLIANCE_REGION: "public",
      CI: "true",
      PATH: "/usr/bin",
    });
  });
});

describe("the deploy environment", () => {
  it("passes the deploy credential, the target account and the inventory credential", () => {
    expect(checkDeployEnvironment(DEPLOY_ENV, TARGET, { deployToken: true })).toEqual([]);
  });

  it.each([
    ["WRANGLER_CI_OVERRIDE_NAME", "morph"],
    ["CLOUDFLARE_ENV", "staging"],
    ["CLOUDFLARE_API_KEY", "global"],
    ["CLOUDFLARE_EMAIL", "a@example.com"],
    ["CLOUDFLARE_API_BASE_URL", "http://127.0.0.1:9/client/v4"],
    ["WRANGLER_API_ENVIRONMENT", "staging"],
  ])("refuses %s", (name, value) => {
    const problems = checkDeployEnvironment({ ...DEPLOY_ENV, [name]: value }, TARGET, { deployToken: true });
    expect(problems).toEqual([expect.stringContaining(name)]);
  });

  it("refuses a missing or foreign account and a missing inventory credential", () => {
    expect(checkDeployEnvironment({ ...DEPLOY_ENV, CLOUDFLARE_ACCOUNT_ID: undefined }, TARGET, { deployToken: true })).toHaveLength(1);
    expect(
      checkDeployEnvironment({ ...DEPLOY_ENV, CLOUDFLARE_ACCOUNT_ID: "ffffffffffffffffffffffffffffffff" }, TARGET, { deployToken: true }),
    ).toHaveLength(1);
    expect(checkDeployEnvironment({ ...DEPLOY_ENV, MORPH_INVENTORY_API_TOKEN: "" }, TARGET, { deployToken: true })).toHaveLength(1);
  });
});

describe("the pinned tools", () => {
  const root = process.cwd();
  const read = (file: string) => JSON.parse(readFileSync(path.join(root, file), "utf8"));

  it("are what this checkout declares and installs", () => {
    expect(
      checkPinnedTools({
        packageJson: read("package.json"),
        installedWranglerVersion: read("node_modules/wrangler/package.json").version,
        installedVitePluginVersion: read("node_modules/@cloudflare/vite-plugin/package.json").version,
      }),
    ).toEqual([]);
  });

  it("refuses a range, another installed Wrangler and another Vite plugin", () => {
    const problems = checkPinnedTools({
      packageJson: { devDependencies: { wrangler: `^${PINNED_WRANGLER_VERSION}` } },
      installedWranglerVersion: "4.147.0",
      installedVitePluginVersion: `${PINNED_VITE_PLUGIN_VERSION}-next`,
    });
    expect(problems).toHaveLength(3);
  });
});
