// @vitest-environment node
/**
 * The release/Worker build match (render plan v2 step 1, PR 3).
 *
 * The Worker half is tested by running the exact module source the deployer
 * writes, over stand-in Theme entries that record every call and every
 * evaluation, so "the Theme never ran" (and "was never even loaded") is
 * observed rather than inferred. Each case gets a fresh copy: the module
 * keeps per-isolate state (the deployed build id, the loaded Theme), as a
 * Worker isolate does.
 *
 * Runs outside jsdom: the module builds a `Request` from another, which
 * jsdom's AbortSignal breaks.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  EXPECTED_THEME_BUILD_HEADER,
  RELEASE_WORKER_MATCH_ENV,
  THEME_BUILD_ID_VAR,
  THEME_BUILD_MISMATCH_HEADER,
  THEME_BUILD_MISMATCH_RETRY_AFTER_SECONDS,
  releaseWorkerMatchEnabled,
  themeBuildMatchModuleSource,
  themeWorkerBuildMismatch,
} from "./theme-worker-build-match";
import {
  StorefrontProductionService,
  THEME_RUNTIME_MISMATCH_LOG_LABEL,
  THEME_RUNTIME_UNAVAILABLE_PUBLIC_MESSAGE,
} from "./storefront-production.service";
import type { StorefrontHostResolverDeps } from "./storefront-host-resolver";
import { createThemeRuntime } from "./storefront-request-routing";
import { ServiceBindingThemeRuntime } from "./theme-runtimes";

type ThemeCall = Readonly<{
  method: string;
  request: Request;
  expectedHeader: string | null;
  storefrontHeader: string | null;
  body: string | null;
  envBuildId: unknown;
}>;

type WorkerHandler = {
  fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>;
};

type Loaded = {
  guard: WorkerHandler;
  /** The Theme entry's own module (importing it evaluates it, if not yet). */
  entry: () => Promise<{ calls: ThemeCall[]; default: unknown }>;
  /** How often the Theme entry has been evaluated, read without importing it. */
  evaluations: () => number;
  /** The guard module's default export object, for shape checks. */
  guardModule: Record<string, unknown>;
};

// Shared by the stand-in entries: record the call (and the POST body it
// consumed, the side effect a wrong build must never perform) and answer.
const RECORD = `
async function record(calls, request, env) {
  calls.push({
    method: request.method,
    request,
    expectedHeader: request.headers.get(${JSON.stringify(EXPECTED_THEME_BUILD_HEADER)}),
    storefrontHeader: request.headers.get("x-morph-storefront-id"),
    body: request.method === "POST" ? await request.text() : null,
    envBuildId: env && env[${JSON.stringify(THEME_BUILD_ID_VAR)}],
  });
  const url = new URL(request.url);
  if (url.pathname === "/own-503") return new Response("theme busy", { status: 503 });
  return new Response("theme page", {
    status: 200,
    headers: { "x-theme": "1", "Cache-Control": "public, max-age=600" },
  });
}
`;

const evaluationCounter = (key: string) =>
  `globalThis.__morphEvaluations = globalThis.__morphEvaluations || {};
globalThis.__morphEvaluations[${JSON.stringify(key)}] = (globalThis.__morphEvaluations[${JSON.stringify(key)}] || 0) + 1;`;

/** Start's and Astro's shape: an object with `fetch`. */
const OBJECT_ENTRY = (key: string) => `${evaluationCounter(key)}
${RECORD}
export const calls = [];
export default {
  tag: "theme-handler",
  async fetch(request, env, ctx) {
    if (this.tag !== "theme-handler") throw new Error("receiver lost");
    return record(calls, request, env);
  },
};
`;

/** A WorkerEntrypoint-style class: constructed with (ctx, env), fetch(request). */
const CLASS_ENTRY = (key: string) => `${evaluationCounter(key)}
${RECORD}
export const calls = [];
export default class ThemeEntrypoint {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(request) { return record(calls, request, this.env); }
}
`;

/**
 * A Theme that, once evaluated, attacks what the module relies on: it makes
 * every header lookup answer "absent", hides headers behind its own getter,
 * and rewrites the deployed build id in env. Originals are kept on
 * globalThis so the test can restore them.
 */
const TAMPERING_ENTRY = (key: string) => `${evaluationCounter(key)}
${RECORD}
const headersDescriptor = Object.getOwnPropertyDescriptor(Request.prototype, "headers");
globalThis.__morphRestore = () => {
  Headers.prototype.get = originalGet;
  Object.defineProperty(Request.prototype, "headers", headersDescriptor);
};
const originalGet = Headers.prototype.get;
Headers.prototype.get = function (name) {
  return String(name).toLowerCase() === ${JSON.stringify(EXPECTED_THEME_BUILD_HEADER)}
    ? null
    : originalGet.call(this, name);
};
Object.defineProperty(Request.prototype, "headers", {
  configurable: true,
  get() { return new Headers(); },
});
export const calls = [];
export default {
  async fetch(request, env, ctx) {
    env[${JSON.stringify(THEME_BUILD_ID_VAR)}] = "whatever-you-expect";
    return record(calls, request, env);
  },
};
`;

/** A WorkerEntrypoint-style class whose fetch is an instance field. */
const FIELD_CLASS_ENTRY = (key: string) => `${evaluationCounter(key)}
${RECORD}
export const calls = [];
export default class ThemeEntrypoint {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  fetch = async (request) => record(calls, request, this.env);
}
`;

/** An entry whose own top-level code throws. */
const THROWING_ENTRY = (key: string) => `${evaluationCounter(key)}
throw new Error("theme top-level failure");
export default { fetch() {} };
`;

let directory = "";
let counter = 0;

async function loadGuard(
  mainModule: string,
  entrySource: (key: string) => string = OBJECT_ENTRY,
  options: { writeEntry?: boolean } = {},
): Promise<Loaded & { writeEntry: () => Promise<void> }> {
  counter += 1;
  const key = `entry-${counter}`;
  const root = join(directory, key);
  const entryPath = join(root, mainModule);
  await mkdir(join(entryPath, ".."), { recursive: true });
  const writeEntry = () => writeFile(entryPath, entrySource(key), "utf8");
  if (options.writeEntry !== false) await writeEntry();
  const guardPath = join(root, "__morph_build_match.mjs");
  await writeFile(guardPath, themeBuildMatchModuleSource(mainModule), "utf8");
  const guardModule = (await import(
    /* @vite-ignore */ pathToFileURL(guardPath).href
  )) as Record<string, unknown> & { default: WorkerHandler };
  return {
    writeEntry,
    guard: guardModule.default,
    guardModule,
    entry: () =>
      import(/* @vite-ignore */ pathToFileURL(entryPath).href) as Promise<{
        calls: ThemeCall[];
        default: unknown;
      }>,
    evaluations: () =>
      (
        globalThis as unknown as {
          __morphEvaluations?: Record<string, number>;
        }
      ).__morphEvaluations?.[key] ?? 0,
  };
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "morph-build-match-"));
});

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

const workerEnv = (buildId?: string): Record<string, unknown> =>
  buildId === undefined ? {} : { [THEME_BUILD_ID_VAR]: buildId };

function coreRequest(
  path: string,
  init: RequestInit & { expected?: string } = {},
): Request {
  const { expected, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("x-morph-storefront-id", "sf_1");
  if (expected !== undefined) headers.set(EXPECTED_THEME_BUILD_HEADER, expected);
  return new Request(`https://shop.example.com${path}`, { ...rest, headers });
}

describe("releaseWorkerMatchEnabled", () => {
  it("is on only when the server sets exactly 1", () => {
    expect(releaseWorkerMatchEnabled(undefined)).toBe(false);
    expect(releaseWorkerMatchEnabled({})).toBe(false);
    for (const value of ["0", "true", "yes", " 1", 1, true]) {
      expect(
        releaseWorkerMatchEnabled({ [RELEASE_WORKER_MATCH_ENV]: value }),
      ).toBe(false);
    }
    expect(releaseWorkerMatchEnabled({ [RELEASE_WORKER_MATCH_ENV]: "1" })).toBe(
      true,
    );
  });

  it("is ignored in production until the native build is enabled there (PR 6)", () => {
    for (const production of [
      { ENVIRONMENT: "production" },
      { CF_PAGES: "1" },
    ]) {
      expect(
        releaseWorkerMatchEnabled({
          ...production,
          [RELEASE_WORKER_MATCH_ENV]: "1",
        }),
      ).toBe(false);
    }
    expect(
      releaseWorkerMatchEnabled({
        ENVIRONMENT: "staging",
        [RELEASE_WORKER_MATCH_ENV]: "1",
      }),
    ).toBe(true);
  });
});

describe("the Worker's build match module", () => {
  it("does not evaluate the Theme until a request is let through", async () => {
    const loaded = await loadGuard("index.js");
    expect(loaded.evaluations()).toBe(0);
    // Only fetch is forwarded; the module exports nothing of the build.
    expect(Object.keys(loaded.guardModule)).toEqual(["default"]);
    expect(Object.keys(loaded.guard)).toEqual(["fetch"]);
  });

  it("passes a request without Core's expectation to the Theme untouched, and its answer back untouched", async () => {
    const loaded = await loadGuard("index.js");
    const request = coreRequest("/", { method: "GET" });
    const response = await loaded.guard.fetch(request, workerEnv("bld_A"), {});
    const { calls } = await loaded.entry();
    expect(calls).toHaveLength(1);
    // The very request object, not a copy.
    expect(calls[0]!.request).toBe(request);
    expect(calls[0]).toMatchObject({
      method: "GET",
      expectedHeader: null,
      storefrontHeader: "sf_1",
    });
    expect(response.status).toBe(200);
    expect([...response.headers]).toEqual([
      ["cache-control", "public, max-age=600"],
      ["content-type", "text/plain;charset=UTF-8"],
      ["x-theme", "1"],
    ]);
    expect(await response.text()).toBe("theme page");
  });

  it("also passes it through on a Worker env without the build id (switch off in Core)", async () => {
    const loaded = await loadGuard("index.js");
    const response = await loaded.guard.fetch(
      coreRequest("/", { method: "POST", body: "order=1" }),
      workerEnv(),
      {},
    );
    const { calls } = await loaded.entry();
    expect(calls.map((call) => call.body)).toEqual(["order=1"]);
    expect(response.status).toBe(200);
  });

  it("runs the Theme on a match, hides Core's expectation from it, and adds nothing to its answer", async () => {
    const loaded = await loadGuard("index.js");
    const response = await loaded.guard.fetch(
      coreRequest("/cart", {
        method: "POST",
        body: "add=sku_1",
        expected: "bld_A",
      }),
      workerEnv("bld_A"),
      {},
    );
    const { calls } = await loaded.entry();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      body: "add=sku_1",
      expectedHeader: null,
      storefrontHeader: "sf_1",
      envBuildId: "bld_A",
    });
    expect(response.status).toBe(200);
    expect([...response.headers]).toEqual([
      ["cache-control", "public, max-age=600"],
      ["content-type", "text/plain;charset=UTF-8"],
      ["x-theme", "1"],
    ]);
  });

  it.each([
    ["another build", workerEnv("bld_A"), "bld_B"],
    ["no build id in the Worker's env", workerEnv(), "bld_B"],
    ["an empty build id in the Worker's env", workerEnv(""), "bld_B"],
    ["an empty expectation", workerEnv("bld_A"), ""],
  ])(
    "refuses, without loading the Theme, when the Worker has %s; a POST is not executed",
    async (_case, env, expected) => {
      const loaded = await loadGuard("index.js");
      const response = await loaded.guard.fetch(
        coreRequest("/checkout", { method: "POST", body: "pay=1", expected }),
        env,
        {},
      );
      expect(loaded.evaluations()).toBe(0);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("retry-after")).toBe(
        String(THEME_BUILD_MISMATCH_RETRY_AFTER_SECONDS),
      );
      expect(response.headers.get(THEME_BUILD_MISMATCH_HEADER)).toBe("1");
      const body = await response.text();
      expect(body).not.toContain("bld_A");
      expect(body).not.toContain("bld_B");
    },
  );

  it("refuses a mismatch after the Theme has loaded too, and never runs it", async () => {
    const loaded = await loadGuard("index.js");
    await loaded.guard.fetch(coreRequest("/", { expected: "bld_A" }), workerEnv("bld_A"), {});
    const response = await loaded.guard.fetch(
      coreRequest("/checkout", { method: "POST", body: "pay=1", expected: "bld_B" }),
      workerEnv("bld_A"),
      {},
    );
    const { calls } = await loaded.entry();
    expect(calls).toHaveLength(1);
    expect(response.status).toBe(503);
  });

  it("keeps the build id it read before the Theme loaded, whatever env says later", async () => {
    const loaded = await loadGuard("index.js");
    await loaded.guard.fetch(coreRequest("/", { expected: "bld_A" }), workerEnv("bld_A"), {});
    const response = await loaded.guard.fetch(
      coreRequest("/", { expected: "bld_B" }),
      workerEnv("bld_B"),
      {},
    );
    expect(response.status).toBe(503);
    expect((await loaded.entry()).calls).toHaveLength(1);
  });

  it("still refuses after the Theme tampered with Headers, Request and env", async () => {
    const loaded = await loadGuard("index.js", TAMPERING_ENTRY);
    const env = workerEnv("bld_A");
    try {
      // Lets the Theme load; it tampers on evaluation and on its first call.
      const first = await loaded.guard.fetch(
        coreRequest("/", { expected: "bld_A" }),
        env,
        {},
      );
      expect(first.status).toBe(200);
      expect(env[THEME_BUILD_ID_VAR]).toBe("whatever-you-expect");
      for (const expected of ["bld_B", "whatever-you-expect"]) {
        const response = await loaded.guard.fetch(
          coreRequest("/checkout", { method: "POST", body: "pay=1", expected }),
          env,
          {},
        );
        expect(response.status).toBe(503);
      }
      expect((await loaded.entry()).calls).toHaveLength(1);
    } finally {
      (globalThis as unknown as { __morphRestore?: () => void }).__morphRestore?.();
    }
    // The test process is whole again.
    expect(new Headers({ a: "1" }).get("a")).toBe("1");
  });

  it("forwards to a WorkerEntrypoint-style class default export", async () => {
    const loaded = await loadGuard("index.js", CLASS_ENTRY);
    const response = await loaded.guard.fetch(
      coreRequest("/", { expected: "bld_A" }),
      workerEnv("bld_A"),
      {},
    );
    expect(response.status).toBe(200);
    const { calls } = await loaded.entry();
    expect(calls[0]).toMatchObject({ envBuildId: "bld_A", expectedHeader: null });
  });

  it("forwards to a class whose fetch is an instance field", async () => {
    const loaded = await loadGuard("index.js", FIELD_CLASS_ENTRY);
    const response = await loaded.guard.fetch(
      coreRequest("/", { method: "POST", body: "x=1", expected: "bld_A" }),
      workerEnv("bld_A"),
      {},
    );
    expect(response.status).toBe(200);
    const { calls } = await loaded.entry();
    expect(calls[0]).toMatchObject({ envBuildId: "bld_A", body: "x=1" });
  });

  it("does not keep a rejected import: the next request imports again", async () => {
    // The entry cannot be loaded at first (here: not there yet), then can.
    const loaded = await loadGuard("index.js", OBJECT_ENTRY, {
      writeEntry: false,
    });
    await expect(
      loaded.guard.fetch(coreRequest("/", { expected: "bld_A" }), workerEnv("bld_A"), {}),
    ).rejects.toThrow();
    await loaded.writeEntry();
    const response = await loaded.guard.fetch(
      coreRequest("/", { expected: "bld_A" }),
      workerEnv("bld_A"),
      {},
    );
    expect(response.status).toBe(200);
    expect((await loaded.entry()).calls).toHaveLength(1);
  });

  it("shares one import between concurrent first requests", async () => {
    const loaded = await loadGuard("index.js");
    const responses = await Promise.all(
      [1, 2, 3].map(() =>
        loaded.guard.fetch(coreRequest("/", { expected: "bld_A" }), workerEnv("bld_A"), {}),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(loaded.evaluations()).toBe(1);
  });

  it("fails each request, and never hangs, when the entry's top level throws", async () => {
    const loaded = await loadGuard("index.js", THROWING_ENTRY);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        loaded.guard.fetch(coreRequest("/", { expected: "bld_A" }), workerEnv("bld_A"), {}),
      ).rejects.toThrow("theme top-level failure");
    }
    // A mismatch is still refused without touching the Theme.
    const refused = await loaded.guard.fetch(
      coreRequest("/", { expected: "bld_B" }),
      workerEnv("bld_A"),
      {},
    );
    expect(refused.status).toBe(503);
  });

  it("imports an entry that sits below the server directory", async () => {
    const loaded = await loadGuard("assets/worker-entry.js");
    const response = await loaded.guard.fetch(
      coreRequest("/", { expected: "bld_A" }),
      workerEnv("bld_A"),
      {},
    );
    expect(response.status).toBe(200);
  });
});

describe("themeWorkerBuildMismatch (Core's reading of the answer)", () => {
  it("reads only the module's refusal as a mismatch", () => {
    expect(
      themeWorkerBuildMismatch(
        new Response("x", {
          status: 503,
          headers: { [THEME_BUILD_MISMATCH_HEADER]: "1" },
        }),
      ),
    ).toBe("WORKER_BUILD_MISMATCH");
    // A Theme's own 503, and the header on any other status, are the Theme's.
    expect(themeWorkerBuildMismatch(new Response("x", { status: 503 }))).toBeNull();
    expect(
      themeWorkerBuildMismatch(
        new Response("x", {
          status: 200,
          headers: { [THEME_BUILD_MISMATCH_HEADER]: "1" },
        }),
      ),
    ).toBeNull();
  });
});

/**
 * Core end to end: host -> active release -> the stable service binding,
 * which answers with whichever Worker is "deployed": the module over the
 * stand-in Theme, run with that Worker's env, or a legacy Worker (the same
 * Theme as its own main, without the module).
 */
describe("Core over the stable service binding", () => {
  const HOST = "shop.example.com";

  function resolverDeps(themeBuildId: string): StorefrontHostResolverDeps {
    return {
      domainDal: {
        findByHostname: async () => ({
          id: "dom_1",
          storefrontId: "sf_1",
          hostname: HOST,
          status: "active",
        }),
      },
      storefrontDalRef: {
        findActive: async () => ({ id: "sf_1", status: "published" }),
      },
      releaseDal: {
        getActive: async () => ({
          id: `rel_${themeBuildId}`,
          themeId: "th_1",
          sourceRevisionId: "rev_1",
          themeBuildId,
          contentPublicationId: "pub_1",
        }),
      },
      buildDal: {
        getBuildById: async (id: string) => ({
          id,
          storefrontId: "sf_1",
          themeId: "th_1",
          status: "succeeded",
          artifactPrefix: `themes/th_1/builds/${id}`,
          manifestJson: {
            artifactEntry: "runtime/server/index.js",
            files: [],
            runtime: {
              kind: "cloudflare-worker",
              workerEntry: "runtime/server/index.js",
              clientAssetsDirectory: "runtime/client",
            },
          },
        }),
      },
    };
  }

  type Deployed = { kind: "guarded"; buildId: string } | { kind: "legacy" };

  async function core(args: {
    env: Record<string, unknown>;
    releaseBuildId: string;
    deployed: Deployed;
  }) {
    const loaded = await loadGuard("index.js");
    const seen: Headers[] = [];
    const binding = {
      fetch: async (request: Request) => {
        seen.push(new Headers(request.headers));
        if (args.deployed.kind === "guarded") {
          return loaded.guard.fetch(
            request,
            workerEnv(args.deployed.buildId),
            {},
          );
        }
        const legacy = (await loaded.entry()).default as WorkerHandler;
        return legacy.fetch(request, {}, {});
      },
    };
    const runtime = createThemeRuntime({ THEME_WORKER: binding, ...args.env });
    expect(runtime).toBeInstanceOf(ServiceBindingThemeRuntime);
    return {
      loaded,
      seen,
      service: new StorefrontProductionService({
        runtime,
        resolverDeps: resolverDeps(args.releaseBuildId),
      }),
    };
  }

  const ON = { [RELEASE_WORKER_MATCH_ENV]: "1" };
  const checkout = () =>
    new Request(`https://${HOST}/checkout`, {
      method: "POST",
      body: "pay=1",
      headers: { origin: `https://${HOST}` },
    });

  it.each([
    ["switch off", {}],
    ["switch set in production", { ...ON, ENVIRONMENT: "production" }],
  ])(
    "with the %s, sends no expectation and serves whatever answers, as before",
    async (_case, env) => {
      for (const deployed of [
        { kind: "guarded", buildId: "bld_A" },
        { kind: "legacy" },
      ] as const) {
        const { service, seen, loaded } = await core({
          env,
          releaseBuildId: "bld_B",
          deployed,
        });
        const response = await service.handleRequest(checkout());
        expect(seen[0]?.get(EXPECTED_THEME_BUILD_HEADER)).toBeNull();
        expect((await loaded.entry()).calls.map((call) => call.body)).toEqual([
          "pay=1",
        ]);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("theme page");
      }
    },
  );

  it("drops an expectation a browser sends, so only Core can ask for the check", async () => {
    const { service, seen } = await core({
      env: {},
      releaseBuildId: "bld_B",
      deployed: { kind: "guarded", buildId: "bld_A" },
    });
    const response = await service.handleRequest(
      new Request(`https://${HOST}/`, {
        headers: { [EXPECTED_THEME_BUILD_HEADER]: "bld_X" },
      }),
    );
    expect(seen[0]?.get(EXPECTED_THEME_BUILD_HEADER)).toBeNull();
    expect(response.status).toBe(200);
  });

  it("serves a match", async () => {
    const { service, seen } = await core({
      env: ON,
      releaseBuildId: "bld_A",
      deployed: { kind: "guarded", buildId: "bld_A" },
    });
    const response = await service.handleRequest(new Request(`https://${HOST}/`));
    expect(seen[0]?.get(EXPECTED_THEME_BUILD_HEADER)).toBe("bld_A");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-theme")).toBe("1");
    expect(await response.text()).toBe("theme page");
  });

  it("answers a deploy-swap mismatch with a non-cacheable 503 and never runs the wrong build's POST", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { service, loaded } = await core({
        env: ON,
        releaseBuildId: "bld_B",
        deployed: { kind: "guarded", buildId: "bld_A" },
      });
      const response = await service.handleRequest(checkout());
      expect(loaded.evaluations()).toBe(0);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("retry-after")).toBe(
        String(THEME_BUILD_MISMATCH_RETRY_AFTER_SECONDS),
      );
      expect(response.headers.get(THEME_BUILD_MISMATCH_HEADER)).toBeNull();
      expect(await response.text()).toBe(THEME_RUNTIME_UNAVAILABLE_PUBLIC_MESSAGE);
      expect(log).toHaveBeenCalledWith(THEME_RUNTIME_MISMATCH_LOG_LABEL, {
        code: "WORKER_BUILD_MISMATCH",
        runtime: "service-binding",
        status: 503,
        storefrontId: "sf_1",
        releaseId: "rel_bld_B",
        themeBuildId: "bld_B",
      });
    } finally {
      log.mockRestore();
    }
  });

  it("keeps a Worker without the module serving, unchanged (no outage; the documented residual)", async () => {
    const { service, seen, loaded } = await core({
      env: ON,
      releaseBuildId: "bld_B",
      deployed: { kind: "legacy" },
    });
    const response = await service.handleRequest(checkout());
    // The expectation is sent; a Worker without the module ignores it.
    expect(seen[0]?.get(EXPECTED_THEME_BUILD_HEADER)).toBe("bld_B");
    expect((await loaded.entry()).calls).toHaveLength(1);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("theme page");
  });

  it("passes a Theme's own 503 through as the Theme's", async () => {
    const { service } = await core({
      env: ON,
      releaseBuildId: "bld_A",
      deployed: { kind: "guarded", buildId: "bld_A" },
    });
    const response = await service.handleRequest(
      new Request(`https://${HOST}/own-503`),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("theme busy");
  });
});
