// @vitest-environment node
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkArtifactConfig,
  checkDeployRedirect,
  checkSourceConfig,
} from "./deploy-config-guard";
import { parseDeployTarget, type DeployTarget } from "./deploy-target";
import { ACCOUNT, D1_ID, WORKER, ZONE } from "./test-support/mock-cloudflare-api";

const TARGET: DeployTarget = {
  accountId: ACCOUNT,
  workerName: WORKER,
  environment: "production",
  d1Databases: { DATABASE: D1_ID },
  kvNamespaces: { KV: "kv-id" },
  r2Buckets: { R2_BUCKET: "bucket" },
};

function config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: WORKER,
    main: "src/server.ts",
    workers_dev: false,
    preview_urls: false,
    d1_databases: [{ binding: "DATABASE", database_name: "db", database_id: D1_ID, migrations_dir: "drizzle" }],
    kv_namespaces: [{ binding: "KV", id: "kv-id" }],
    r2_buckets: [{ binding: "R2_BUCKET", bucket_name: "bucket" }],
    vars: {
      PUBLIC_URL: "https://admin.example.com",
      MORPH_CMS_HOSTNAME: "admin.example.com",
      CLOUDFLARE_ZONE_ID: ZONE,
      CLOUDFLARE_WORKER_SERVICE: WORKER,
      THEME_PREVIEW_HOSTNAME: "preview.localhost",
    },
    ...overrides,
  };
}

const routeProblem = (problems: string[]) => problems.filter((p) => /route or routes/.test(p));

describe("the source config guard", () => {
  it("passes a config with no route keys, both flags false and the target identities", () => {
    expect(checkSourceConfig(config(), TARGET)).toEqual([]);
  });

  it.each([
    ["routes: []", { routes: [] }],
    ["a custom_domain list", { routes: [{ pattern: "admin.example.com", custom_domain: true }] }],
    ["a wildcard-only list", { routes: ["*.preview.example.com/*"] }],
    ["a singular route", { route: "admin.example.com/*" }],
    ["route: null", { route: null }],
  ])("refuses %s at the top level", (_label, overrides) => {
    expect(routeProblem(checkSourceConfig(config(overrides), TARGET))).toHaveLength(1);
  });

  it("refuses routes in an environment section, including [] that only blocks inheritance", () => {
    const problems = checkSourceConfig(
      config({ env: { staging: { routes: [] }, other: { route: "x.example.com/*" } } }),
      TARGET,
    );
    expect(routeProblem(problems).map((p) => p.split(" has ")[0])).toEqual([
      "wrangler.jsonc: env.staging",
      "wrangler.jsonc: env.other",
    ]);
  });

  it("refuses top-level routes an environment section would inherit", () => {
    const problems = checkSourceConfig(
      config({ routes: [{ pattern: "a.example.com", custom_domain: true }], env: { staging: {} } }),
      TARGET,
    );
    expect(routeProblem(problems)).toHaveLength(1);
  });

  it.each([
    ["absent workers_dev", { workers_dev: undefined }],
    ["workers_dev true", { workers_dev: true }],
    ["absent preview_urls", { preview_urls: undefined }],
    ["preview_urls true", { preview_urls: true }],
  ])("refuses %s", (_label, overrides) => {
    const problems = checkSourceConfig(config(overrides), TARGET);
    expect(problems.some((p) => /must be explicitly false/.test(p))).toBe(true);
  });

  it("refuses an environment section that turns an exposure flag on", () => {
    const problems = checkSourceConfig(config({ env: { e2e: { workers_dev: true } } }), TARGET);
    expect(problems).toEqual([expect.stringContaining("env.e2e sets workers_dev")]);
  });

  it.each([
    ["the Worker name", { name: "morph" }],
    ["the account", { account_id: "ffffffffffffffffffffffffffffffff" }],
    ["the D1 id", { d1_databases: [{ binding: "DATABASE", database_id: "other" }] }],
    ["an extra D1 binding", { d1_databases: [{ binding: "DATABASE", database_id: D1_ID }, { binding: "B", database_id: "x" }] }],
    ["the KV id", { kv_namespaces: [{ binding: "KV", id: "other" }] }],
    ["the R2 bucket", { r2_buckets: [{ binding: "R2_BUCKET", bucket_name: "morph-r2-global" }] }],
  ])("refuses a config whose %s is not the target's", (_label, overrides) => {
    expect(checkSourceConfig(config(overrides), TARGET)).toHaveLength(1);
  });

  it("refuses a provider service var that names another Worker", () => {
    const problems = checkSourceConfig(
      config({ vars: { ...(config().vars as object), CLOUDFLARE_WORKER_SERVICE: "morph" } }),
      TARGET,
    );
    expect(problems).toEqual([expect.stringContaining("CLOUDFLARE_WORKER_SERVICE")]);
  });

  it("refuses a workers.dev PUBLIC_URL and a missing zone", () => {
    const problems = checkSourceConfig(
      config({ vars: { PUBLIC_URL: "https://morph.example.workers.dev" } }),
      TARGET,
    );
    expect(problems.some((p) => /workers\.dev/.test(p))).toBe(true);
    expect(problems.some((p) => /CLOUDFLARE_ZONE_ID/.test(p))).toBe(true);
  });
});

describe("the deploy redirect", () => {
  const root = "/repo";

  it("accepts the build's own artifact", () => {
    expect(checkDeployRedirect({ configPath: "../../dist/server/wrangler.json", auxiliaryWorkers: [] }, root)).toEqual({
      ok: true,
      artifactPath: path.resolve(root, "dist/server/wrangler.json"),
    });
  });

  it.each([
    ["another file", { configPath: "../../wrangler.stg.json", auxiliaryWorkers: [] }],
    ["an absolute path elsewhere", { configPath: "/tmp/wrangler.json" }],
    ["auxiliary Workers", { configPath: "../../dist/server/wrangler.json", auxiliaryWorkers: [{ configPath: "x" }] }],
    ["no configPath", { auxiliaryWorkers: [] }],
    ["an unknown field", { configPath: "../../dist/server/wrangler.json", env: "staging" }],
  ])("refuses a redirect to %s", (_label, redirect) => {
    expect(checkDeployRedirect(redirect, root).ok).toBe(false);
  });
});

describe("the artifact guard", () => {
  const source = config();
  const sourcePath = "/repo/wrangler.jsonc";
  const artifact = (overrides: Record<string, unknown> = {}) => ({
    ...config(),
    main: "index.js",
    configPath: sourcePath,
    userConfigPath: sourcePath,
    topLevelName: WORKER,
    definedEnvironments: [],
    ...overrides,
  });

  it("passes the artifact built from the checked source", () => {
    expect(checkArtifactConfig(artifact(), source, TARGET, sourcePath)).toEqual([]);
  });

  it("refuses an artifact whose routes the Vite plugin kept, [] included", () => {
    expect(routeProblem(checkArtifactConfig(artifact({ routes: [] }), source, TARGET, sourcePath))).toHaveLength(1);
  });

  it("refuses an artifact built from another config", () => {
    const problems = checkArtifactConfig(artifact({ userConfigPath: "/repo/wrangler.stg.jsonc" }), source, TARGET, sourcePath);
    expect(problems).toEqual([expect.stringContaining("built from")]);
  });

  it("refuses an artifact whose vars differ from the source (another environment)", () => {
    const problems = checkArtifactConfig(
      artifact({ vars: { ...(source.vars as object), PUBLIC_URL: "http://localhost:3000" } }),
      source,
      TARGET,
      sourcePath,
    );
    expect(problems).toEqual([expect.stringContaining("vars differ")]);
  });

  it("refuses an artifact whose flags are missing", () => {
    const problems = checkArtifactConfig(artifact({ workers_dev: undefined }), source, TARGET, sourcePath);
    expect(problems).toEqual([expect.stringContaining("workers_dev must be explicitly false")]);
  });
});

describe("the deploy target", () => {
  it("parses a complete target and defaults the environment", () => {
    const parsed = parseDeployTarget({ ...TARGET, environment: undefined });
    expect(parsed).toEqual({ ok: true, value: TARGET });
  });

  it.each([
    ["a short account id", { accountId: "abc" }],
    ["no D1 database", { d1Databases: {} }],
    ["an unknown field", { routes: [] }],
  ])("refuses %s", (_label, overrides) => {
    expect(parseDeployTarget({ ...TARGET, ...overrides }).ok).toBe(false);
  });
});
