// @vitest-environment node
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// The repo's own JSONC reader for wrangler.jsonc; a plain .mjs with no types.
// @ts-expect-error TS7016
import { parseJsonc } from "../../../scripts/theme-runtime-wiring-scan.mjs";
import { createBootstrapApi, createInventoryApi } from "./cloudflare-api";
import { EXIT, runCoreDeploy, type CoreDeployDeps } from "./core-deploy";
import { PINNED_VITE_PLUGIN_VERSION, PINNED_WRANGLER_VERSION } from "./deploy-invocation";
import {
  ACCOUNT,
  D1_ID,
  WORKER,
  ZONE,
  baseState,
  domain,
  row,
  startMockCloudflareApi,
  type MockApi,
} from "./test-support/mock-cloudflare-api";

const ROOT = "/repo";
const at = (file: string) => path.join(ROOT, file);

const SOURCE = {
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
};

const TARGET = {
  accountId: ACCOUNT,
  workerName: WORKER,
  d1Databases: { DATABASE: D1_ID },
  kvNamespaces: { KV: "kv-id" },
  r2Buckets: { R2_BUCKET: "bucket" },
};

const ENV = {
  CLOUDFLARE_API_TOKEN: "deploy-token",
  CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
  MORPH_INVENTORY_API_TOKEN: "inventory-token",
  MORPH_BOOTSTRAP_API_TOKEN: "bootstrap-token",
  MORPH_DEPLOY_TARGET: "target.json",
};

const apis: MockApi[] = [];
afterEach(async () => {
  for (const api of apis.splice(0)) await api.close();
});

type Harness = {
  deps: CoreDeployDeps;
  steps: string[];
  logs: string[];
  reports: Record<string, unknown>;
  files: Map<string, string>;
  api: MockApi;
  childEnvs: Record<string, Record<string, string>>;
};

async function harness(
  options: {
    source?: unknown;
    sourceText?: string;
    env?: Record<string, string | undefined>;
    onWrangler?: (api: MockApi) => number;
    artifact?: (source: Record<string, unknown>) => Record<string, unknown>;
    /** The migrations directory's entries; the mock D1 has applied 0001_init.sql. */
    migrationFiles?: string[];
  } = {},
): Promise<Harness> {
  const admin = domain("admin.example.com");
  const shop = domain("shop.example.com");
  const api = await startMockCloudflareApi(
    baseState({ domains: [admin, shop], d1: { [D1_ID]: [row("shop.example.com", shop.id)] } }),
    {
      handlers: [
        (request) =>
          request.path.endsWith(`/d1/database/${D1_ID}/query`) && JSON.parse(request.body).sql.includes("d1_migrations")
            ? {
                status: 200,
                body: { success: true, errors: [], result: [{ success: true, results: [{ name: "0001_init.sql" }], meta: {} }] },
              }
            : undefined,
      ],
    },
  );
  apis.push(api);
  const files = new Map<string, string>([
    [at("package.json"), JSON.stringify({ devDependencies: { wrangler: PINNED_WRANGLER_VERSION } })],
    [at("node_modules/wrangler/package.json"), JSON.stringify({ version: PINNED_WRANGLER_VERSION })],
    [at("node_modules/@cloudflare/vite-plugin/package.json"), JSON.stringify({ version: PINNED_VITE_PLUGIN_VERSION })],
    [at("target.json"), JSON.stringify(TARGET)],
    [at("wrangler.jsonc"), options.sourceText ?? `// Core\n${JSON.stringify(options.source ?? SOURCE, null, 2)}\n`],
    // Left by an earlier build: must be removed before anything reads it.
    [at(".wrangler/deploy/config.json"), JSON.stringify({ configPath: "../../stale/wrangler.json" })],
    [at("dist/server/wrangler.json"), JSON.stringify({ name: "stale" })],
  ]);
  const mtimes = new Map<string, number>();
  let clock = 1_000_000;
  const steps: string[] = [];
  const logs: string[] = [];
  const reports: Record<string, unknown> = {};
  const childEnvs: Record<string, Record<string, string>> = {};
  const deps: CoreDeployDeps = {
    rootDir: ROOT,
    env: { ...ENV, ...options.env },
    readText: (file) => {
      const text = files.get(file);
      if (text === undefined) throw new Error(`ENOENT ${file}`);
      return text;
    },
    exists: (file) => files.has(file),
    mtimeMs: (file) => mtimes.get(file) ?? 0,
    listDir: (dir) => {
      steps.push(`ls ${path.relative(ROOT, dir)}`);
      return options.migrationFiles ?? ["0001_init.sql"];
    },
    lock: (dir) => {
      if (files.has(`${dir}/pid`)) return false;
      files.set(`${dir}/pid`, "1");
      steps.push("lock");
      return true;
    },
    unlock: (dir) => {
      files.delete(`${dir}/pid`);
      steps.push("unlock");
    },
    removeDir: (dir) => {
      steps.push(`rm ${path.relative(ROOT, dir)}`);
      for (const key of [...files.keys()]) if (key.startsWith(`${dir}/`)) files.delete(key);
    },
    parseJsonc: (text) => parseJsonc(text),
    run: async (step, argv, env) => {
      steps.push(`${step}: ${argv.slice(1).map((a) => (a.startsWith(ROOT) ? path.relative(ROOT, a) : a)).join(" ")}`);
      childEnvs[step] = env;
      if (step === "build") {
        clock += 10_000;
        const source = JSON.parse(files.get(at("wrangler.jsonc"))!.replace(/^\/\/.*\n/, ""));
        const artifact = options.artifact?.(source) ?? {
          ...source,
          main: "index.js",
          configPath: at("wrangler.jsonc"),
          userConfigPath: at("wrangler.jsonc"),
          topLevelName: source.name,
        };
        files.set(at(".wrangler/deploy/config.json"), JSON.stringify({ configPath: "../../dist/server/wrangler.json", auxiliaryWorkers: [] }));
        files.set(at("dist/server/wrangler.json"), JSON.stringify(artifact));
        mtimes.set(at(".wrangler/deploy/config.json"), clock);
        mtimes.set(at("dist/server/wrangler.json"), clock);
        return 0;
      }
      return options.onWrangler?.(api) ?? 0;
    },
    inventoryApi: (accountId) => createInventoryApi({ baseUrl: api.baseUrl, token: ENV.MORPH_INVENTORY_API_TOKEN, accountId }),
    bootstrapApi: (accountId) => createBootstrapApi({ baseUrl: api.baseUrl, token: ENV.MORPH_BOOTSTRAP_API_TOKEN, accountId }),
    writeReport: (name, data) => {
      reports[name] = data;
    },
    log: (line) => logs.push(line),
    now: () => new Date(clock),
    sleep: async () => {},
    reconcileDelayMs: 0,
  };
  return { deps, steps, logs, reports, files, api, childEnvs };
}

const deploy = (h: Harness, args: { bootstrap?: boolean } = {}) =>
  runCoreDeploy("deploy", { targetPath: null, bootstrap: args.bootstrap ?? false }, h.deps);

describe("pnpm run deploy", () => {
  it("runs guard, clean, migration check, pre-check, build, artifact guard, Wrangler and post-check in that order", async () => {
    const h = await harness();
    const result = await deploy(h);
    expect(result).toEqual({ exitCode: EXIT.ok, problems: [] });
    expect(h.steps).toEqual([
      "lock",
      "rm dist",
      "rm .wrangler/deploy",
      "ls drizzle",
      "build: run build",
      "wrangler: node_modules/wrangler/bin/wrangler.js deploy --no-autoconfig --env-file /dev/null",
      "unlock",
    ]);
    // The migration check read the target's database by id, before the build.
    const queries = h.api.requests.filter((r) => r.path.endsWith(`/d1/database/${D1_ID}/query`)).map((r) => JSON.parse(r.body).sql);
    expect(queries[0]).toBe("SELECT name FROM d1_migrations ORDER BY id");
    expect(Object.keys(h.reports)).toEqual(["pre", "post"]);
    // Wrangler never sees the inventory or bootstrap credentials.
    expect(h.childEnvs.wrangler!.MORPH_INVENTORY_API_TOKEN).toBeUndefined();
    expect(h.childEnvs.wrangler!.MORPH_BOOTSTRAP_API_TOKEN).toBeUndefined();
    expect(h.api.writes()).toEqual([]);
  });

  it.each([
    ["routes: []", { ...SOURCE, routes: [] }],
    ["a custom_domain list", { ...SOURCE, routes: [{ pattern: "admin.example.com", custom_domain: true }] }],
    ["an inherited env route", { ...SOURCE, route: "admin.example.com/*", env: { staging: {} } }],
  ])("refuses %s before any remote read, build or deploy", async (_label, source) => {
    const h = await harness({ source });
    const result = await deploy(h);
    expect(result.exitCode).toBe(EXIT.refused);
    expect(h.steps).toEqual([]);
    expect(h.api.requests).toEqual([]);
  });

  it("refuses a JSONC source with routes hidden after a comment", async () => {
    const h = await harness({
      sourceText: `{\n  // binds the CMS\n  "routes": [],\n${JSON.stringify(SOURCE).slice(1)}\n`,
    });
    expect((await deploy(h)).exitCode).toBe(EXIT.refused);
    expect(h.steps).toEqual([]);
  });

  it.each([
    ["WRANGLER_CI_OVERRIDE_NAME", { WRANGLER_CI_OVERRIDE_NAME: "morph" }],
    ["CLOUDFLARE_ENV", { CLOUDFLARE_ENV: "local_preview_e2e" }],
    ["a missing inventory credential", { MORPH_INVENTORY_API_TOKEN: undefined }],
  ])("refuses %s before anything runs", async (_label, env) => {
    const h = await harness({ env });
    expect((await deploy(h)).exitCode).toBe(EXIT.refused);
    expect(h.steps).toEqual([]);
  });

  it("refuses the deploy when the inventory cannot be read, and never runs Wrangler", async () => {
    const h = await harness();
    h.api.faults.push({ method: "GET", path: `/accounts/${ACCOUNT}/workers/domains`, times: 99, status: 500 });
    const result = await deploy(h);
    expect(result.exitCode).toBe(EXIT.refused);
    expect(h.steps.some((s) => s.startsWith("build") || s.startsWith("wrangler"))).toBe(false);
    expect(h.reports.pre).toMatchObject({ status: "unavailable" });
  });

  it("refuses the deploy when the inventory has drift before it starts", async () => {
    const h = await harness();
    h.api.state.domains = h.api.state.domains.filter((d) => d.hostname !== "shop.example.com");
    expect((await deploy(h)).exitCode).toBe(EXIT.refused);
    expect(h.steps.some((s) => s.startsWith("wrangler"))).toBe(false);
  });

  it.each([
    ["a migration file the database has not applied", ["0001_init.sql", "0002_next.sql"]],
    ["a database migration this checkout lacks", []],
  ])("refuses %s, before building", async (_label, migrationFiles) => {
    const h = await harness({ migrationFiles });
    expect((await deploy(h)).exitCode).toBe(EXIT.refused);
    expect(h.steps.some((s) => s.startsWith("build"))).toBe(false);
    expect(h.logs.some((l) => l.includes("migrations:"))).toBe(true);
  });

  it("refuses when the migration list cannot be read", async () => {
    const h = await harness();
    h.api.faults.push({ method: "POST", path: `/accounts/${ACCOUNT}/d1/database/`, times: 1, status: 403 });
    expect((await deploy(h)).exitCode).toBe(EXIT.refused);
    expect(h.steps.some((s) => s.startsWith("build"))).toBe(false);
  });

  it("refuses a second run in the same checkout", async () => {
    const h = await harness();
    h.files.set(at(".wrangler/core-deploy.lock/pid"), "999");
    const result = await deploy(h);
    expect(result.exitCode).toBe(EXIT.refused);
    expect(h.steps).toEqual([]);
  });

  it("reports an artifact replaced while Wrangler ran", async () => {
    const h = await harness({
      onWrangler: () => {
        h.files.set(at("dist/server/wrangler.json"), JSON.stringify({ name: "swapped" }));
        return 0;
      },
    });
    const result = await deploy(h);
    expect(result).toEqual({ exitCode: EXIT.deployFailed, problems: ["the checked config changed while Wrangler ran"] });
    expect(h.steps.at(-1)).toBe("unlock");
  });

  it("refuses an artifact that differs from the checked source", async () => {
    const h = await harness({
      artifact: (source) => ({ ...source, userConfigPath: at("wrangler.jsonc"), routes: [{ pattern: "admin.example.com", custom_domain: true }] }),
    });
    expect((await deploy(h)).exitCode).toBe(EXIT.refused);
    expect(h.steps.some((s) => s.startsWith("wrangler"))).toBe(false);
  });

  it("detects a storefront domain that is gone after the deploy", async () => {
    const h = await harness({
      onWrangler: (api) => {
        api.state.domains = api.state.domains.filter((d) => d.hostname !== "shop.example.com");
        return 0;
      },
    });
    const result = await deploy(h);
    expect(result.exitCode).toBe(EXIT.drift);
    expect(h.reports.post).toMatchObject({
      status: "drift",
      drift: [expect.objectContaining({ kind: "storefront-domain-missing" })],
    });
  });

  it("runs the post-check when Wrangler fails after the upload, and keeps both results", async () => {
    const h = await harness({
      onWrangler: (api) => {
        api.state.domains = api.state.domains.filter((d) => d.hostname !== "admin.example.com");
        return 1;
      },
    });
    const result = await deploy(h);
    expect(result.exitCode).toBe(EXIT.drift);
    expect(result.problems).toEqual(["post-deploy check: drift", "wrangler deploy exited 1"]);
    expect(h.reports.post).toBeDefined();
  });

  it("reports a failed deploy with bindings unchanged as a deploy failure", async () => {
    const h = await harness({ onWrangler: () => 1 });
    expect(await deploy(h)).toEqual({ exitCode: EXIT.deployFailed, problems: ["wrangler deploy exited 1"] });
  });

  it("reports verification unavailable after the deploy apart from drift", async () => {
    const h = await harness({
      onWrangler: (api) => {
        api.faults.push({ method: "POST", path: `/accounts/${ACCOUNT}/d1/database/`, times: 99, status: 503 });
        return 0;
      },
    });
    expect((await deploy(h)).exitCode).toBe(EXIT.unavailable);
  });

  it("lets a bootstrap deploy run with the platform bindings still missing, and nothing else", async () => {
    const h = await harness();
    h.api.state.domains = h.api.state.domains.filter((d) => d.hostname !== "admin.example.com");
    expect((await deploy(h)).exitCode).toBe(EXIT.refused);
    const bootstrap = await harness();
    bootstrap.api.state.domains = bootstrap.api.state.domains.filter((d) => d.hostname !== "admin.example.com");
    expect((await deploy(bootstrap, { bootstrap: true })).exitCode).toBe(EXIT.ok);
    expect(bootstrap.api.writes()).toEqual([]);
  });
});

describe("pnpm run platform:ensure and deploy:verify", () => {
  it("binds the missing platform hostname, then verifies strictly", async () => {
    const h = await harness();
    h.api.state.domains = h.api.state.domains.filter((d) => d.hostname !== "admin.example.com");
    const result = await runCoreDeploy("ensure-platform-bindings", { targetPath: null, bootstrap: false }, h.deps);
    expect(result.exitCode).toBe(EXIT.ok);
    expect(h.api.writes().map((w) => w.method)).toEqual(["PUT"]);
    expect(h.steps).toEqual(["lock", "unlock"]);
    expect(h.reports["ensure-pre"]).toMatchObject({ status: "ok" });
    expect(h.reports["ensure-verify"]).toMatchObject({ status: "ok" });
  });

  it("refuses to bootstrap over a storefront domain inside the preview namespace, writing nothing", async () => {
    const h = await harness();
    h.api.state.domains = h.api.state.domains.filter((d) => d.hostname !== "admin.example.com");
    const hidden = domain("shop.preview.localhost");
    h.api.state.domains.push(hidden);
    h.api.state.d1[D1_ID]!.push(row("shop.preview.localhost", hidden.id));
    const result = await runCoreDeploy("ensure-platform-bindings", { targetPath: null, bootstrap: false }, h.deps);
    expect(result.exitCode).toBe(EXIT.refused);
    expect(h.api.writes()).toEqual([]);
    expect(h.reports["ensure-pre"]).toMatchObject({
      status: "drift",
      drift: [expect.objectContaining({ kind: "storefront-domain-in-preview-namespace" })],
    });
  });

  it("refuses platform:ensure while another run holds the checkout", async () => {
    const h = await harness();
    h.files.set(at(".wrangler/core-deploy.lock/pid"), "999");
    expect((await runCoreDeploy("ensure-platform-bindings", { targetPath: null, bootstrap: false }, h.deps)).exitCode).toBe(EXIT.refused);
    expect(h.api.requests).toEqual([]);
  });

  it("still runs the post-check when a checked file cannot be read after Wrangler", async () => {
    const h = await harness({
      onWrangler: () => {
        const readText = h.deps.readText;
        (h.deps as { readText: (file: string) => string }).readText = (file) => {
          if (file.endsWith("dist/server/wrangler.json")) throw new Error("EIO");
          return readText(file);
        };
        return 0;
      },
    });
    const result = await deploy(h);
    expect(result).toEqual({ exitCode: EXIT.deployFailed, problems: ["the checked config changed while Wrangler ran"] });
    expect(h.reports.post).toMatchObject({ status: "ok" });
  });

  it("verify only reads", async () => {
    const h = await harness();
    expect((await runCoreDeploy("verify", { targetPath: null, bootstrap: false }, h.deps)).exitCode).toBe(EXIT.ok);
    expect(h.api.writes()).toEqual([]);
    expect(h.steps).toEqual([]);
  });
});
