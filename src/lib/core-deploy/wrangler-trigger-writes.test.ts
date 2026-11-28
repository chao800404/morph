// @vitest-environment node
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { checkArtifactConfig, checkNormalizedConfig } from "./deploy-config-guard";
import { PINNED_WRANGLER_VERSION, deployChildEnv, wranglerDeployArgv } from "./deploy-invocation";
import {
  ACCOUNT,
  ZONE,
  apiError,
  baseState,
  ok,
  startMockCloudflareApi,
  type CustomHandler,
  type MockApi,
  type RecordedRequest,
} from "./test-support/mock-cloudflare-api";

/**
 * The request-recording harness for design 2: the pinned Wrangler, run the way
 * `pnpm run deploy` runs it (fixed argv, the `.wrangler/deploy` redirect, the
 * controlled environment), against a local API that answers every request
 * successfully. It shows what this Wrangler sends for each route shape:
 *
 * - absent and `[]` routes, on a first deploy, an existing Worker's versioned
 *   deploy and an assets-only deploy: the upload completes, `/subdomain` is
 *   told `{enabled:false, previews_enabled:false}`, and not one request goes
 *   to a Custom Domain or Workers Route endpoint;
 * - controls, to show the harness would see a write: a Custom Domain list is a
 *   replace-state changeset plus a records PUT carrying the non-TTY override
 *   flags; a wildcard-only list is a script-level `PUT /routes`; an
 *   authentication error there falls back to the zone Route API.
 *
 * Unlike `sandbox-wrangler-deploy-destination.test.ts` (which answers 400 and
 * only checks where the token goes), every run here must exit 0 and reach the
 * trigger step. An upgrade of Wrangler re-runs this before the pin moves.
 */

const SCRIPT = "morph-harness";
const WRANGLER_DIR = path.join(process.cwd(), "node_modules", "wrangler");
const WRANGLER_BIN = path.join(WRANGLER_DIR, "bin", "wrangler.js");

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

type WorkerState = { exists: boolean; routesAuthError: boolean };

/** The Workers endpoints a deploy uses, answered as the API does on success. */
function workersHandler(worker: WorkerState): CustomHandler {
  return (request, state) => {
    const script = `/accounts/${state.accountId}/workers/scripts/${SCRIPT}`;
    const { method, path: p } = request;
    if (method === "GET" && p === `/accounts/${state.accountId}/workers/services/${SCRIPT}`) {
      return worker.exists
        ? ok({
            id: SCRIPT,
            default_environment: {
              environment: "production",
              created_on: "2026-11-01T00:00:00Z",
              modified_on: "2026-11-01T00:00:00Z",
              script: { id: SCRIPT, tag: "tag", etag: "etag", last_deployed_from: "wrangler" },
            },
          })
        : apiError(404, 10090, "This Worker does not exist on your account.");
    }
    if (method === "PUT" && p === script) {
      worker.exists = true;
      return ok({ id: SCRIPT, etag: "etag", startup_time_ms: 1, deployment_id: "deployment-1" });
    }
    if (method === "POST" && p === `${script}/versions`) {
      return ok({ id: "version-1", startup_time_ms: 1, resources: { script: { etag: "etag" } } });
    }
    if (method === "POST" && p === `${script}/deployments`) {
      return ok({ id: "deployment-2", versions: [{ version_id: "version-1", percentage: 100 }] });
    }
    if (method === "GET" && p === `${script}/deployments`) {
      return ok({
        deployments: [
          {
            id: "deployment-2",
            source: "wrangler",
            strategy: "percentage",
            created_on: "2026-11-28T00:00:00Z",
            versions: [{ version_id: "version-1", percentage: 100 }],
          },
        ],
      });
    }
    // Read for the Worker's tags; the PATCH below writes them back.
    if (method === "GET" && p === `${script}/settings`) return ok({ tags: [], logpush: false, tail_consumers: [] });
    if (method === "PATCH" && p === `${script}/script-settings`) return ok({});
    if (method === "GET" && p === `/accounts/${state.accountId}/workers/workers/${SCRIPT}`) {
      return ok({ id: SCRIPT, name: SCRIPT, subdomain: { enabled: false, previews_enabled: false } });
    }
    if (method === "POST" && p === `${script}/subdomain`) {
      const body = JSON.parse(request.body) as { enabled?: boolean; previews_enabled?: boolean };
      return ok({ enabled: body.enabled ?? false, previews_enabled: body.previews_enabled ?? false });
    }
    if (method === "GET" && p === `/accounts/${state.accountId}/workers/subdomain`) return ok({ subdomain: "harness" });
    if (method === "POST" && p === `${script}/assets-upload-session`) return ok({ jwt: "completion-jwt", buckets: [] });
    if (method === "POST" && p === `${script}/domains/changeset`) {
      return ok({ added: [], removed: [], updated: [], conflicting: [] });
    }
    if (method === "PUT" && p === `${script}/domains/records`) return ok([]);
    if (method === "PUT" && p === `${script}/routes`) {
      return worker.routesAuthError
        ? apiError(403, 10000, "Authentication error")
        : ok((JSON.parse(request.body) as Array<{ pattern: string }>).map((r, i) => ({ id: `route-${i}`, ...r })));
    }
    if (method === "GET" && p === "/zones") return ok([{ id: ZONE, name: "example.com" }]);
    return undefined;
  };
}

/** Requests to an endpoint that binds a hostname or a Route. */
function bindingRequests(requests: readonly RecordedRequest[]): string[] {
  return requests
    .filter(
      (r) =>
        /\/domains(\/|$)/.test(r.path) ||
        /\/workers\/routes$/.test(r.path) ||
        /\/workers\/scripts\/[^/]+\/routes$/.test(r.path),
    )
    .map((r) => `${r.method} ${r.path}${r.query.toString() ? `?${r.query}` : ""}`);
}

type Layout = { root: string; home: string };

/**
 * A checkout as `pnpm run deploy` leaves it after a build: a source config, the
 * redirect, and the artifact it points at.
 */
async function layout(artifact: Record<string, unknown>, options: { assetsOnly?: boolean } = {}): Promise<Layout> {
  const root = await mkdtemp(path.join(tmpdir(), "morph-wrangler-triggers-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  await mkdir(path.join(root, "dist", "server"), { recursive: true });
  await mkdir(path.join(root, "dist", "client"), { recursive: true });
  await mkdir(path.join(root, ".wrangler", "deploy"), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(path.join(root, "dist", "client", "index.html"), "<p>ok</p>\n");
  if (!options.assetsOnly) {
    await writeFile(path.join(root, "dist", "server", "index.js"), "export default { fetch() { return new Response('ok'); } };\n");
  }
  await writeFile(path.join(root, "wrangler.jsonc"), JSON.stringify({ name: SCRIPT, compatibility_date: "2026-03-24" }));
  await writeFile(path.join(root, "dist", "server", "wrangler.json"), JSON.stringify(artifact, null, 2));
  // A redirect that names a config with a Custom Domain list. The runner
  // passes --config, so Wrangler must never follow it.
  await writeFile(
    path.join(root, "dist", "server", "redirected.json"),
    JSON.stringify({ ...artifact, routes: [{ pattern: "redirected.example.com", custom_domain: true }] }),
  );
  await writeFile(
    path.join(root, ".wrangler", "deploy", "config.json"),
    JSON.stringify({ configPath: "../../dist/server/redirected.json", auxiliaryWorkers: [] }),
  );
  return { root, home };
}

function artifact(overrides: Record<string, unknown> = {}, options: { assetsOnly?: boolean } = {}) {
  return {
    name: SCRIPT,
    compatibility_date: "2026-03-24",
    ...(options.assetsOnly ? {} : { main: "index.js", no_bundle: true, rules: [{ type: "ESModule", globs: ["**/*.js"] }] }),
    assets: { directory: "../client", ...(options.assetsOnly ? {} : { binding: "ASSETS" }) },
    workers_dev: false,
    preview_urls: false,
    ...overrides,
  };
}

async function deploy(
  layoutDirs: Layout,
  api: MockApi,
): Promise<{ code: number | null; output: string }> {
  const [bin, ...argv] = wranglerDeployArgv(WRANGLER_BIN, path.join(layoutDirs.root, "dist", "server", "wrangler.json"));
  const env = {
    ...deployChildEnv({
      PATH: process.env.PATH ?? "",
      HOME: layoutDirs.home,
      XDG_CONFIG_HOME: path.join(layoutDirs.home, ".config"),
      CLOUDFLARE_API_TOKEN: "fake-deploy-token",
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
      MORPH_INVENTORY_API_TOKEN: "must-not-reach-wrangler",
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_HIDE_BANNER: "true",
    }),
    // Test only: the runner pins the official API; this harness points it here.
    CLOUDFLARE_API_BASE_URL: api.baseUrl,
  };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin!, ...argv], { cwd: layoutDirs.root, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

async function run(
  shape: Record<string, unknown>,
  worker: Partial<WorkerState> = {},
  options: { assetsOnly?: boolean } = {},
) {
  const state: WorkerState = { exists: false, routesAuthError: false, ...worker };
  const api = await startMockCloudflareApi(baseState(), { handlers: [workersHandler(state)] });
  cleanups.push(() => api.close());
  const dirs = await layout(artifact(shape, options), options);
  const result = await deploy(dirs, api);
  // Every request this Wrangler made had an answer: nothing was skipped past.
  expect(api.unhandled.map((r) => `${r.method} ${r.path}`), result.output).toEqual([]);
  return { ...result, api };
}

function subdomainBodies(api: MockApi) {
  return api.requests
    .filter((r) => r.method === "POST" && r.path.endsWith(`/workers/scripts/${SCRIPT}/subdomain`))
    .map((r) => JSON.parse(r.body));
}

function uploaded(api: MockApi, path: "script" | "versions") {
  const script = `/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}`;
  return path === "script"
    ? api.requests.some((r) => r.method === "PUT" && r.path === script)
    : api.requests.some((r) => r.method === "POST" && r.path === `${script}/versions`) &&
        api.requests.some((r) => r.method === "POST" && r.path === `${script}/deployments`);
}

describe("what the pinned Wrangler writes for each route shape", () => {
  it(`is Wrangler ${PINNED_WRANGLER_VERSION}`, async () => {
    expect(JSON.parse(await readFile(path.join(WRANGLER_DIR, "package.json"), "utf8")).version).toBe(PINNED_WRANGLER_VERSION);
  });

  describe.each([
    ["absent routes", {}],
    ["routes: []", { routes: [] }],
  ])("%s", (_label, shape) => {
    it("first deploy: uploads, disables both subdomains, and sends no binding request", async () => {
      const { code, output, api } = await run(shape);
      expect(code, output).toBe(0);
      expect(uploaded(api, "script"), output).toBe(true);
      expect(subdomainBodies(api)).toEqual([{ enabled: false, previews_enabled: false }]);
      expect(bindingRequests(api.requests)).toEqual([]);
      expect(api.requests.every((r) => r.authorization === "Bearer fake-deploy-token")).toBe(true);
    }, 120_000);

    it("existing Worker: deploys a version, and sends no binding request", async () => {
      const { code, output, api } = await run(shape, { exists: true });
      expect(code, output).toBe(0);
      expect(uploaded(api, "versions"), output).toBe(true);
      expect(subdomainBodies(api)).toEqual([{ enabled: false, previews_enabled: false }]);
      expect(bindingRequests(api.requests)).toEqual([]);
    }, 120_000);

    it("assets-only: uploads, and sends no binding request", async () => {
      const { code, output, api } = await run(shape, {}, { assetsOnly: true });
      expect(code, output).toBe(0);
      expect(api.requests.some((r) => r.path.endsWith("/assets-upload-session")), output).toBe(true);
      expect(uploaded(api, "script"), output).toBe(true);
      expect(subdomainBodies(api)).toEqual([{ enabled: false, previews_enabled: false }]);
      expect(bindingRequests(api.requests)).toEqual([]);
    }, 120_000);
  });

  it("control: a Custom Domain list replaces the Worker's domains, with the non-TTY overrides forced", async () => {
    const { code, output, api } = await run({ routes: [{ pattern: "admin.example.com", custom_domain: true }] });
    expect(code, output).toBe(0);
    const script = `/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}`;
    expect(bindingRequests(api.requests)).toEqual([
      `POST ${script}/domains/changeset?replace_state=true`,
      `PUT ${script}/domains/records`,
    ]);
    const records = api.requests.find((r) => r.path === `${script}/domains/records`)!;
    expect(JSON.parse(records.body)).toMatchObject({
      override_scope: true,
      override_existing_origin: true,
      override_existing_dns_record: true,
      origins: [expect.objectContaining({ hostname: "admin.example.com" })],
    });
  }, 120_000);

  it("control: a wildcard-only list replaces the Worker's Routes with a script-level PUT", async () => {
    const { code, output, api } = await run({ routes: ["*.preview.example.com/*"] });
    expect(code, output).toBe(0);
    const writes = bindingRequests(api.requests).filter((r) => !r.startsWith("GET "));
    expect(writes).toEqual([`PUT /accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/routes`]);
  }, 120_000);

  it("control: an authentication error on that PUT falls back to the zone Route API", async () => {
    const { code, output, api } = await run({ routes: ["*.preview.example.com/*"] }, { routesAuthError: true });
    expect(code, output).toBe(0);
    const writes = bindingRequests(api.requests).filter((r) => !r.startsWith("GET "));
    expect(writes).toEqual([
      `PUT /accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/routes`,
      `POST /zones/${ZONE}/workers/routes`,
    ]);
    expect(api.state.routes[ZONE]).toEqual([expect.objectContaining({ pattern: "*.preview.example.com/*", script: SCRIPT })]);
  }, 120_000);
});

describe("parser parity: the guard sees what the pinned Wrangler reads", () => {
  const require = createRequire(import.meta.url);
  const { unstable_readConfig } = require("wrangler") as {
    unstable_readConfig: (args: { config: string }, options: { hideWarnings: boolean }) => Record<string, unknown>;
  };

  it("a __proto__ key is an inherited Custom Domain list to Wrangler, and both guards refuse it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "morph-wrangler-parity-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await writeFile(path.join(root, "index.js"), "export default { fetch() { return new Response('ok'); } };\n");
    const base = { name: SCRIPT, main: "index.js", compatibility_date: "2026-03-24", workers_dev: false, preview_urls: false };
    const text = JSON.stringify(base).replace(/}$/, ',"__proto__":{"routes":[{"pattern":"a.example.com","custom_domain":true}]}}');
    const file = path.join(root, "wrangler.json");
    await writeFile(file, text);

    const parsed = JSON.parse(text);
    expect(Object.prototype.hasOwnProperty.call(parsed, "routes")).toBe(false);
    const seen = unstable_readConfig({ config: file }, { hideWarnings: true });
    expect(seen.routes).toEqual([{ pattern: "a.example.com", custom_domain: true }]);

    const target = { accountId: ACCOUNT, workerName: SCRIPT, environment: "production", d1Databases: {}, kvNamespaces: {}, r2Buckets: {} };
    expect(checkArtifactConfig(parsed, base, target, "/x").some((p) => p.includes("__proto__"))).toBe(true);
    expect(checkNormalizedConfig(seen, target).some((p) => /routes/.test(p))).toBe(true);
  });
});
