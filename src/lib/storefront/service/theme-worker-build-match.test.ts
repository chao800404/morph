// @vitest-environment node
/**
 * The release/Worker build match (render plan v2 step 1, PR 3).
 *
 * The Worker half is tested by running the exact module source the deployer
 * writes, over a stand-in Theme entry that records every call, so "the Theme
 * never ran" is observed rather than inferred. Runs outside jsdom: the module
 * builds a `Request` from another, which jsdom's AbortSignal breaks.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  EXPECTED_THEME_BUILD_HEADER,
  RELEASE_WORKER_MATCH_ENV,
  SERVED_THEME_BUILD_HEADER,
  THEME_BUILD_ID_VAR,
  THEME_BUILD_MISMATCH_HEADER,
  THEME_BUILD_MISMATCH_RETRY_AFTER_SECONDS,
  releaseWorkerMatchEnabled,
  themeBuildMatchModuleSource,
  verifyThemeWorkerBuild,
} from "./theme-worker-build-match";
import {
  StorefrontProductionService,
  THEME_RUNTIME_MISMATCH_LOG_LABEL,
  THEME_RUNTIME_UNAVAILABLE_PUBLIC_MESSAGE,
} from "./storefront-production.service";
import type { StorefrontHostResolverDeps } from "./storefront-host-resolver";
import { createThemeRuntime } from "./storefront-request-routing";
import { ServiceBindingThemeRuntime } from "./theme-runtimes";
import {
  DEPLOYED_THEME_BUILD_MATCH_METADATA_KEY,
  isThemeBuildMatchMarked,
  withDeployedThemeBuildMatch,
} from "./theme-worker-deployment-state";

type ThemeCall = Readonly<{
  method: string;
  url: string;
  expectedHeader: string | null;
  storefrontHeader: string | null;
  body: string | null;
  self: unknown;
}>;

type GuardModule = {
  default: {
    fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>;
    tag?: string;
  };
  marker?: string;
  calls: ThemeCall[];
};

// The stand-in for a build's Worker entry. It records each call (and the
// POST body it consumed, the side effect a wrong build must never perform).
const THEME_ENTRY = `export const marker = "named-export-kept";
export const calls = [];
export default {
  tag: "theme-handler",
  async fetch(request, env, ctx) {
    calls.push({
      method: request.method,
      url: request.url,
      expectedHeader: request.headers.get(${JSON.stringify(EXPECTED_THEME_BUILD_HEADER)}),
      storefrontHeader: request.headers.get("x-morph-storefront-id"),
      body: request.method === "POST" ? await request.text() : null,
      self: this && this.tag,
    });
    const url = new URL(request.url);
    if (url.pathname === "/redirect") return Response.redirect("https://shop.example.com/next", 302);
    if (url.pathname === "/own-503") return new Response("theme busy", { status: 503 });
    return new Response("theme page", { status: 200, headers: { "x-theme": "1", "Cache-Control": "public, max-age=600" } });
  },
};
`;

let directory = "";
const modules = new Map<string, GuardModule>();

async function loadGuard(mainModule: string): Promise<GuardModule> {
  const cached = modules.get(mainModule);
  if (cached) return cached;
  const root = join(directory, mainModule.replace(/[^a-z]/gi, "_"));
  await mkdir(join(root, mainModule, ".."), { recursive: true });
  await writeFile(join(root, mainModule), THEME_ENTRY, "utf8");
  const guardPath = join(root, "__morph_build_match.mjs");
  await writeFile(guardPath, themeBuildMatchModuleSource(mainModule), "utf8");
  const guard = (await import(
    /* @vite-ignore */ pathToFileURL(guardPath).href
  )) as Omit<GuardModule, "calls">;
  const entry = (await import(
    /* @vite-ignore */ pathToFileURL(join(root, mainModule)).href
  )) as { calls: ThemeCall[] };
  const loaded = { ...guard, calls: entry.calls } as GuardModule;
  modules.set(mainModule, loaded);
  return loaded;
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "morph-build-match-"));
});

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

const workerEnv = (buildId?: string) =>
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

  it("in production, neither Core nor the deployer turns the check on", async () => {
    const binding = { fetch: vi.fn(async () => new Response("ok")) };
    const runtime = createThemeRuntime({
      THEME_WORKER: binding,
      ENVIRONMENT: "production",
      [RELEASE_WORKER_MATCH_ENV]: "1",
    });
    const result = await runtime.handle({
      request: new Request("https://shop.example.com/"),
      resolved: {
        hostname: "shop.example.com",
        domainId: "dom_1",
        storefrontId: "sf_1",
        releaseId: "rel_1",
        themeId: "th_1",
        sourceRevisionId: "rev_1",
        themeBuildId: "bld_1",
        contentPublicationId: null,
        artifactPrefix: "p",
        manifest: {} as never,
        themeWorkerBuildMatch: true,
      },
    });
    // No expectation sent, and an unconfirmed answer on a marked release
    // passes: the switch is ignored.
    expect(result.success).toBe(true);
    const sent = (binding.fetch.mock.calls[0] as unknown as [Request])[0];
    expect(sent.headers.get(EXPECTED_THEME_BUILD_HEADER)).toBeNull();
  });
});

describe("the Worker's build match module", () => {
  it("passes a request without Core's expectation to the Theme untouched", async () => {
    const guard = await loadGuard("index.js");
    const before = guard.calls.length;
    const request = coreRequest("/", { method: "GET" });
    const response = await guard.default.fetch(request, workerEnv("bld_A"), {});
    expect(guard.calls.length).toBe(before + 1);
    expect(guard.calls.at(-1)).toMatchObject({
      method: "GET",
      expectedHeader: null,
      storefrontHeader: "sf_1",
      self: "theme-handler",
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("theme page");
    // No confirmation: with the switch off nothing in the answer changes.
    expect(response.headers.get(SERVED_THEME_BUILD_HEADER)).toBeNull();
  });

  it("also passes it through on a Worker env without the build id (legacy)", async () => {
    const guard = await loadGuard("index.js");
    const before = guard.calls.length;
    const response = await guard.default.fetch(
      coreRequest("/", { method: "POST", body: "order=1" }),
      workerEnv(),
      {},
    );
    expect(guard.calls.length).toBe(before + 1);
    expect(guard.calls.at(-1)?.body).toBe("order=1");
    expect(response.status).toBe(200);
  });

  it("runs the Theme on a match, hides Core's expectation from it, and confirms the build", async () => {
    const guard = await loadGuard("index.js");
    const before = guard.calls.length;
    const response = await guard.default.fetch(
      coreRequest("/cart", {
        method: "POST",
        body: "add=sku_1",
        expected: "bld_A",
      }),
      workerEnv("bld_A"),
      {},
    );
    expect(guard.calls.length).toBe(before + 1);
    expect(guard.calls.at(-1)).toMatchObject({
      method: "POST",
      body: "add=sku_1",
      expectedHeader: null,
      storefrontHeader: "sf_1",
      self: "theme-handler",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get(SERVED_THEME_BUILD_HEADER)).toBe("bld_A");
    expect(response.headers.get("x-theme")).toBe("1");
    expect(await response.text()).toBe("theme page");
  });

  it("confirms an answer whose headers cannot be changed by rebuilding it", async () => {
    const guard = await loadGuard("index.js");
    const response = await guard.default.fetch(
      coreRequest("/redirect", { expected: "bld_A" }),
      workerEnv("bld_A"),
      {},
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://shop.example.com/next",
    );
    expect(response.headers.get(SERVED_THEME_BUILD_HEADER)).toBe("bld_A");
  });

  it.each([
    ["another build", workerEnv("bld_A"), "bld_B"],
    ["no build id in the Worker's env", workerEnv(), "bld_B"],
    ["an empty build id in the Worker's env", workerEnv(""), "bld_B"],
    ["an empty expectation", workerEnv("bld_A"), ""],
  ])(
    "refuses before the Theme runs when the Worker has %s; a POST is not executed",
    async (_case, env, expected) => {
      const guard = await loadGuard("index.js");
      const before = guard.calls.length;
      const response = await guard.default.fetch(
        coreRequest("/checkout", {
          method: "POST",
          body: "pay=1",
          expected,
        }),
        env,
        {},
      );
      expect(guard.calls.length).toBe(before);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("retry-after")).toBe(
        String(THEME_BUILD_MISMATCH_RETRY_AFTER_SECONDS),
      );
      expect(response.headers.get(THEME_BUILD_MISMATCH_HEADER)).toBe("1");
      expect(response.headers.get(SERVED_THEME_BUILD_HEADER)).toBeNull();
      const body = await response.text();
      expect(body).not.toContain("bld_A");
      expect(body).not.toContain("bld_B");
    },
  );

  it("keeps the build entry's named exports and handler properties", async () => {
    const guard = await loadGuard("index.js");
    expect(guard.marker).toBe("named-export-kept");
    expect(guard.default.tag).toBe("theme-handler");
  });

  it("imports an entry that sits below the server directory", async () => {
    const guard = await loadGuard("assets/worker-entry.js");
    const response = await guard.default.fetch(
      coreRequest("/", { expected: "bld_A" }),
      workerEnv("bld_A"),
      {},
    );
    expect(response.headers.get(SERVED_THEME_BUILD_HEADER)).toBe("bld_A");
  });
});

describe("verifyThemeWorkerBuild (Core's reading of the answer)", () => {
  const refusal = () =>
    new Response("x", {
      status: 503,
      headers: { [THEME_BUILD_MISMATCH_HEADER]: "1" },
    });
  const confirmed = (id: string) =>
    new Response("page", {
      status: 201,
      statusText: "Created",
      headers: { [SERVED_THEME_BUILD_HEADER]: id, "x-theme": "1" },
    });
  const plain = (status = 200) => new Response("page", { status });

  it.each([
    ["the Worker's refusal", refusal, false, "WORKER_BUILD_MISMATCH"],
    ["the Worker's refusal, marked release", refusal, true, "WORKER_BUILD_MISMATCH"],
    ["a confirmation of another build", () => confirmed("bld_A"), false, "WORKER_BUILD_CONFIRMED_OTHER"],
    ["a marked release answered without confirmation", () => plain(), true, "WORKER_BUILD_UNCONFIRMED"],
  ] as const)("refuses %s", (_case, response, releaseMarked, code) => {
    expect(
      verifyThemeWorkerBuild({
        response: response(),
        expectedThemeBuildId: "bld_B",
        releaseMarked,
      }),
    ).toEqual({ ok: false, code });
  });

  it("accepts an unmarked release's unconfirmed answer exactly as it came (legacy Worker)", () => {
    const response = plain();
    expect(
      verifyThemeWorkerBuild({
        response,
        expectedThemeBuildId: "bld_B",
        releaseMarked: false,
      }),
    ).toEqual({ ok: true, response });
  });

  it("reads a Theme's own 503 as the Theme's, not as a mismatch", () => {
    const response = plain(503);
    expect(
      verifyThemeWorkerBuild({
        response,
        expectedThemeBuildId: "bld_B",
        releaseMarked: false,
      }),
    ).toEqual({ ok: true, response });
  });

  it("accepts a confirmed answer and removes only the confirmation", async () => {
    for (const releaseMarked of [false, true]) {
      const verdict = verifyThemeWorkerBuild({
        response: confirmed("bld_B"),
        expectedThemeBuildId: "bld_B",
        releaseMarked,
      });
      if (!verdict.ok) throw new Error(verdict.code);
      expect(verdict.response.status).toBe(201);
      expect(verdict.response.statusText).toBe("Created");
      expect(verdict.response.headers.get("x-theme")).toBe("1");
      expect(verdict.response.headers.get(SERVED_THEME_BUILD_HEADER)).toBeNull();
      expect(await verdict.response.text()).toBe("page");
    }
  });
});

describe("the release/Worker mark in release metadata", () => {
  it("is set to the build, and removed, only when it changes", () => {
    const none = { deployedThemeBuildId: "bld_A" };
    expect(withDeployedThemeBuildMatch(none, null)).toBe(none);
    expect(withDeployedThemeBuildMatch(null, null)).toBeNull();
    const marked = withDeployedThemeBuildMatch(none, "bld_A");
    expect(marked).toEqual({
      deployedThemeBuildId: "bld_A",
      [DEPLOYED_THEME_BUILD_MATCH_METADATA_KEY]: "bld_A",
    });
    expect(withDeployedThemeBuildMatch(marked, "bld_A")).toBe(marked);
    expect(withDeployedThemeBuildMatch(marked, null)).toEqual(none);
  });

  it("marks a release only for its own build", () => {
    const metadata = { [DEPLOYED_THEME_BUILD_MATCH_METADATA_KEY]: "bld_A" };
    expect(isThemeBuildMatchMarked(metadata, "bld_A")).toBe(true);
    expect(isThemeBuildMatchMarked(metadata, "bld_B")).toBe(false);
    expect(isThemeBuildMatchMarked(null, "bld_A")).toBe(false);
    expect(isThemeBuildMatchMarked({}, "bld_A")).toBe(false);
  });
});

/**
 * Core end to end: host -> active release -> the stable service binding,
 * which answers with whichever Worker is "deployed": the build match module
 * over the stand-in Theme, run with that Worker's env, or a legacy Worker
 * (the same Theme without the module).
 */
describe("Core over the stable service binding", () => {
  const HOST = "shop.example.com";

  function resolverDeps(release: {
    themeBuildId: string;
    metadata?: Record<string, unknown> | null;
  }): StorefrontHostResolverDeps {
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
          id: `rel_${release.themeBuildId}`,
          themeId: "th_1",
          sourceRevisionId: "rev_1",
          themeBuildId: release.themeBuildId,
          contentPublicationId: "pub_1",
          metadata: release.metadata ?? null,
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

  type Deployed =
    | { kind: "guarded"; buildId: string }
    | { kind: "legacy" };

  async function service(args: {
    switchOn: boolean;
    release: { themeBuildId: string; metadata?: Record<string, unknown> | null };
    deployed: Deployed;
  }) {
    const guard = await loadGuard("index.js");
    // The legacy Worker: the build's entry as its main, no module.
    const legacyEntry = (await import(
      /* @vite-ignore */ pathToFileURL(join(directory, "index_js", "index.js"))
        .href
    )) as { default: GuardModule["default"] };
    const seen: Headers[] = [];
    const binding = {
      fetch: async (request: Request) => {
        seen.push(new Headers(request.headers));
        return args.deployed.kind === "guarded"
          ? guard.default.fetch(request, workerEnv(args.deployed.buildId), {})
          : legacyEntry.default.fetch(request, {}, {});
      },
    };
    const runtime = args.switchOn
      ? createThemeRuntime({
          THEME_WORKER: binding,
          [RELEASE_WORKER_MATCH_ENV]: "1",
        })
      : createThemeRuntime({ THEME_WORKER: binding });
    expect(runtime).toBeInstanceOf(ServiceBindingThemeRuntime);
    return {
      guard,
      seen,
      service: new StorefrontProductionService({
        runtime,
        resolverDeps: resolverDeps(args.release),
      }),
    };
  }

  const marked = (buildId: string) => ({
    [DEPLOYED_THEME_BUILD_MATCH_METADATA_KEY]: buildId,
  });

  it("with the switch off, sends no expectation and serves whatever answers, as before", async () => {
    for (const deployed of [
      { kind: "guarded", buildId: "bld_A" },
      { kind: "legacy" },
    ] as const) {
      const { service: core, seen, guard } = await service({
        switchOn: false,
        release: { themeBuildId: "bld_B", metadata: marked("bld_B") },
        deployed,
      });
      const before = guard.calls.length;
      const response = await core.handleRequest(
        new Request(`https://${HOST}/checkout`, {
          method: "POST",
          body: "pay=1",
          headers: { origin: `https://${HOST}` },
        }),
      );
      expect(seen[0]?.get(EXPECTED_THEME_BUILD_HEADER)).toBeNull();
      expect(guard.calls.length).toBe(before + 1);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("theme page");
    }
  });

  it("drops an expectation a browser sends, so only Core can ask for the check", async () => {
    const { service: core, seen } = await service({
      switchOn: false,
      release: { themeBuildId: "bld_B" },
      deployed: { kind: "guarded", buildId: "bld_A" },
    });
    const response = await core.handleRequest(
      new Request(`https://${HOST}/`, {
        headers: { [EXPECTED_THEME_BUILD_HEADER]: "bld_X" },
      }),
    );
    expect(seen[0]?.get(EXPECTED_THEME_BUILD_HEADER)).toBeNull();
    expect(response.status).toBe(200);
  });

  it("serves a match and strips the Worker's confirmation", async () => {
    const { service: core, seen } = await service({
      switchOn: true,
      release: { themeBuildId: "bld_A", metadata: marked("bld_A") },
      deployed: { kind: "guarded", buildId: "bld_A" },
    });
    const response = await core.handleRequest(new Request(`https://${HOST}/`));
    expect(seen[0]?.get(EXPECTED_THEME_BUILD_HEADER)).toBe("bld_A");
    expect(response.status).toBe(200);
    expect(response.headers.get(SERVED_THEME_BUILD_HEADER)).toBeNull();
    expect(response.headers.get("x-theme")).toBe("1");
    expect(await response.text()).toBe("theme page");
  });

  it("answers a deploy-swap mismatch with a non-cacheable 503 and never runs the wrong build's POST", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Release B is active (its mark is from an earlier deploy, or none
      // yet); Worker A, with the module, still answers.
      for (const metadata of [null, marked("bld_B")]) {
        const { service: core, guard } = await service({
          switchOn: true,
          release: { themeBuildId: "bld_B", metadata },
          deployed: { kind: "guarded", buildId: "bld_A" },
        });
        const before = guard.calls.length;
        const response = await core.handleRequest(
          new Request(`https://${HOST}/checkout`, {
            method: "POST",
            body: "pay=1",
            headers: { origin: `https://${HOST}` },
          }),
        );
        expect(guard.calls.length).toBe(before);
        expect(response.status).toBe(503);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("retry-after")).toBe(
          String(THEME_BUILD_MISMATCH_RETRY_AFTER_SECONDS),
        );
        expect(response.headers.get(THEME_BUILD_MISMATCH_HEADER)).toBeNull();
        expect(await response.text()).toBe(
          THEME_RUNTIME_UNAVAILABLE_PUBLIC_MESSAGE,
        );
      }
      expect(log).toHaveBeenCalledWith(
        THEME_RUNTIME_MISMATCH_LOG_LABEL,
        expect.objectContaining({
          code: "WORKER_BUILD_MISMATCH",
          runtime: "service-binding",
          status: 503,
          storefrontId: "sf_1",
          releaseId: "rel_bld_B",
          themeBuildId: "bld_B",
        }),
      );
    } finally {
      log.mockRestore();
    }
  });

  it("keeps an unmarked release on a legacy Worker serving, unchanged (no outage)", async () => {
    const { service: core, seen } = await service({
      switchOn: true,
      release: { themeBuildId: "bld_B" },
      deployed: { kind: "legacy" },
    });
    const response = await core.handleRequest(new Request(`https://${HOST}/`));
    // The expectation is sent; a Worker without the module ignores it.
    expect(seen[0]?.get(EXPECTED_THEME_BUILD_HEADER)).toBe("bld_B");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("theme page");
  });

  it("refuses a marked release answered by a Worker without the module (marked but missing)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { service: core } = await service({
        switchOn: true,
        release: { themeBuildId: "bld_A", metadata: marked("bld_A") },
        deployed: { kind: "legacy" },
      });
      const response = await core.handleRequest(
        new Request(`https://${HOST}/`),
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("retry-after")).toBe(
        String(THEME_BUILD_MISMATCH_RETRY_AFTER_SECONDS),
      );
      expect(await response.text()).toBe(
        THEME_RUNTIME_UNAVAILABLE_PUBLIC_MESSAGE,
      );
      expect(log).toHaveBeenCalledWith(
        THEME_RUNTIME_MISMATCH_LOG_LABEL,
        expect.objectContaining({ code: "WORKER_BUILD_UNCONFIRMED" }),
      );
    } finally {
      log.mockRestore();
    }
  });

  it("ignores a mark recorded for another build than the release's", async () => {
    const { service: core } = await service({
      switchOn: true,
      release: { themeBuildId: "bld_B", metadata: marked("bld_A") },
      deployed: { kind: "legacy" },
    });
    const response = await core.handleRequest(new Request(`https://${HOST}/`));
    expect(response.status).toBe(200);
  });
});
