// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createBootstrapApi, createInventoryApi } from "./cloudflare-api";
import type { DeployTarget } from "./deploy-target";
import { ensurePlatformBindings } from "./ensure-platform-bindings";
import { readInventory } from "./inventory";
import type { PlatformManifest } from "./platform-manifest";
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
  type MockState,
} from "./test-support/mock-cloudflare-api";

const TARGET: DeployTarget = {
  accountId: ACCOUNT,
  workerName: WORKER,
  environment: "production",
  d1Databases: { DATABASE: D1_ID },
  kvNamespaces: {},
  r2Buckets: {},
};
const MANIFEST: PlatformManifest = {
  zoneId: ZONE,
  customDomains: ["admin.example.com", "ops.example.com"],
  routes: [{ pattern: "*.preview.example.com/*" }],
  previewNamespace: "preview.example.com",
};

const apis: MockApi[] = [];
afterEach(async () => {
  for (const api of apis.splice(0)) await api.close();
});

async function setup(state: MockState) {
  const api = await startMockCloudflareApi(state);
  apis.push(api);
  const inventory = createInventoryApi({ baseUrl: api.baseUrl, token: "inventory-token", accountId: ACCOUNT });
  const bootstrap = createBootstrapApi({ baseUrl: api.baseUrl, token: "bootstrap-token", accountId: ACCOUNT });
  const run = () =>
    ensurePlatformBindings({
      target: TARGET,
      manifest: MANIFEST,
      read: () => readInventory(inventory, TARGET, MANIFEST),
      api: bootstrap,
    });
  return { api, run };
}

const writes = (api: MockApi) => api.writes().map((r) => `${r.method} ${r.path}`);

describe("platform:ensure", () => {
  it("creates what is missing, with the bootstrap credential, and re-reads after each write", async () => {
    const storefront = domain("shop.example.com");
    const { api, run } = await setup(
      baseState({ domains: [storefront], d1: { [D1_ID]: [row("shop.example.com", storefront.id)] } }),
    );
    const result = await run();
    expect(result.status).toBe("complete");
    expect(result.steps.map((s) => `${s.subject}:${s.outcome}`)).toEqual([
      "admin.example.com:created",
      "ops.example.com:created",
      "*.preview.example.com/*:created",
    ]);
    expect(writes(api)).toEqual([
      `PUT /accounts/${ACCOUNT}/workers/domains`,
      `PUT /accounts/${ACCOUNT}/workers/domains`,
      `POST /zones/${ZONE}/workers/routes`,
    ]);
    const put = api.writes()[0]!;
    expect(JSON.parse(put.body)).toEqual({ hostname: "admin.example.com", service: WORKER, environment: "production", zone_id: ZONE });
    expect(put.authorization).toBe("Bearer bootstrap-token");
    for (const read of api.requests.filter((r) => r.method === "GET")) expect(read.authorization).toBe("Bearer inventory-token");
    // A full read for the plan, then one before and one after each of the three writes.
    expect(api.requests.filter((r) => r.method === "GET" && r.path.endsWith("/workers/domains"))).toHaveLength(7);
    // The storefront's binding is untouched.
    expect(api.state.domains.find((d) => d.hostname === "shop.example.com")).toEqual(storefront);
  });

  it("writes nothing on a repeat run", async () => {
    const { api, run } = await setup(baseState());
    expect((await run()).status).toBe("complete");
    const before = api.writes().length;
    const again = await run();
    expect(again.status).toBe("complete");
    expect(again.steps.every((s) => s.outcome === "present")).toBe(true);
    expect(api.writes()).toHaveLength(before);
  });

  it("stops at a failed write and finishes on the next run without repeating what was done", async () => {
    const { api, run } = await setup(baseState());
    api.faults.push({ method: "PUT", path: `/accounts/${ACCOUNT}/workers/domains`, times: 1, status: 400 });
    // First attach (admin) refused by the API; nothing after it is attempted.
    const first = await run();
    expect(first.status).toBe("failed");
    expect(first.steps.map((s) => s.outcome)).toEqual(["failed", "not-attempted", "not-attempted"]);
    expect(writes(api)).toEqual([`PUT /accounts/${ACCOUNT}/workers/domains`]);

    // Second run: the route create fails once, after both domains are bound.
    api.faults.push({ method: "POST", path: `/zones/${ZONE}/workers/routes`, times: 1, status: 400 });
    const second = await run();
    expect(second.steps.map((s) => s.outcome)).toEqual(["created", "created", "failed"]);

    const third = await run();
    expect(third.status).toBe("complete");
    expect(third.steps.map((s) => s.outcome)).toEqual(["present", "present", "created"]);
    expect(writes(api).filter((w) => w.startsWith("PUT"))).toHaveLength(3);
    expect(writes(api).filter((w) => w.startsWith("POST"))).toHaveLength(2);
  });

  it("resolves an ambiguous attach by re-reading, not by retrying", async () => {
    const { api, run } = await setup(baseState());
    api.faults.push({ method: "PUT", path: `/accounts/${ACCOUNT}/workers/domains`, times: 1, status: 502, applyFirst: true });
    const result = await run();
    expect(result.status).toBe("complete");
    expect(result.steps[0]).toMatchObject({ subject: "admin.example.com", outcome: "present" });
    expect(writes(api).filter((w) => w.startsWith("PUT"))).toHaveLength(2);
  });

  it("re-plans each write from a fresh read, and does not write over a claim that appeared since the first read", async () => {
    const { api, run } = await setup(baseState());
    let reads = 0;
    api.beforeAnswer.push((request, state) => {
      if (request.method === "GET" && request.path.endsWith("/workers/domains") && ++reads === 2) {
        state.domains.push(domain("admin.example.com", { service: "morph" }));
      }
    });
    const result = await run();
    expect(result.status).toBe("refused");
    expect(result.steps[0]).toMatchObject({ subject: "admin.example.com", outcome: "refused" });
    expect(api.writes()).toEqual([]);
  });

  it("stops before a write when the fresh read shows a claim on another planned hostname", async () => {
    const { api, run } = await setup(baseState());
    let reads = 0;
    api.beforeAnswer.push((request, state) => {
      if (request.method === "GET" && request.path.endsWith("/workers/domains") && ++reads === 2) {
        state.domains.push(domain("ops.example.com", { service: "morph" }));
      }
    });
    const result = await run();
    expect(result.status).toBe("refused");
    expect(result.steps.map((step) => `${step.subject}:${step.outcome}`)).toEqual([
      "admin.example.com:refused",
      "ops.example.com:not-attempted",
      "*.preview.example.com/*:not-attempted",
    ]);
    expect(result.steps[0]!.detail).toMatch(/ops\.example\.com changed since the first read/);
    expect(api.writes()).toEqual([]);
  });

  it("stops the Route create when the fresh read fails the caller's check", async () => {
    const { api, run } = await setup(baseState());
    let reads = 0;
    const result = await ensurePlatformBindings({
      target: TARGET,
      manifest: { ...MANIFEST, customDomains: [] },
      read: () => readInventory(createInventoryApi({ baseUrl: api.baseUrl, token: "i", accountId: ACCOUNT }), TARGET, MANIFEST),
      api: createBootstrapApi({ baseUrl: api.baseUrl, token: "b", accountId: ACCOUNT }),
      checkBeforeWrite: () => (++reads >= 1 ? ["t1.preview.example.com is inside the preview namespace"] : []),
    });
    void run;
    expect(result.status).toBe("refused");
    expect(result.steps[0]).toMatchObject({ subject: "*.preview.example.com/*", outcome: "refused" });
    expect(api.writes()).toEqual([]);
  });

  it("refuses, and writes nothing, when a platform hostname is bound to another Worker", async () => {
    const { api, run } = await setup(baseState({ domains: [domain("ops.example.com", { service: "morph" })] }));
    const result = await run();
    expect(result.status).toBe("refused");
    expect(result.steps.find((s) => s.subject === "ops.example.com")?.outcome).toBe("refused");
    expect(api.writes()).toEqual([]);
  });

  it("never adopts a storefront-owned binding, even on this Worker", async () => {
    const owned = domain("admin.example.com");
    const { api, run } = await setup(
      baseState({ domains: [owned], d1: { [D1_ID]: [row("admin.example.com", owned.id)] } }),
    );
    const result = await run();
    expect(result.status).toBe("refused");
    expect(result.steps[0]).toMatchObject({ subject: "admin.example.com", outcome: "refused" });
    expect(api.writes()).toEqual([]);
  });

  it("refuses a Route pattern another Worker holds, and never deletes", async () => {
    const { api, run } = await setup(
      baseState({ routes: { [ZONE]: [{ id: "r1", pattern: "*.preview.example.com/*", script: "other" }] } }),
    );
    expect((await run()).status).toBe("refused");
    expect(api.requests.some((r) => r.method === "DELETE")).toBe(false);
    expect(api.writes()).toEqual([]);
  });

  it("refuses a hostname outside the platform zone", async () => {
    const state: MockState = baseState();
    state.zones = [{ id: ZONE, name: "other-zone.com" }];
    const { api, run } = await setup(state);
    expect((await run()).status).toBe("refused");
    expect(api.writes()).toEqual([]);
  });
});

describe("round 5: the preview wildcard never takes over another binding", () => {
  it.each([
    ["a foreign Custom Domain under it", { domains: [domain("app.preview.example.com", { service: "someone-else" })] }],
    ["one of this account's other Workers", { domains: [domain("t1.preview.example.com", { service: "morph-theme-x" })] }],
    ["a Core binding in another environment", { domains: [domain("t2.preview.example.com", { environment: "staging" })] }],
  ])("refuses, writing nothing, when %s exists", async (_label, overrides) => {
    const { api, run } = await setup(baseState(overrides));
    const result = await run();
    expect(result.status).toBe("refused");
    expect(result.steps.find((s) => s.kind === "route")).toMatchObject({ outcome: "refused" });
    expect(api.writes()).toEqual([]);
  });

  it.each([
    ["a broader wildcard for another Worker", { id: "r1", pattern: "*.example.com/*", script: "other" }],
    ["a narrower Route under it", { id: "r2", pattern: "t1.preview.example.com/*", script: "other" }],
    ["an exclusion Route under it", { id: "r3", pattern: "t1.preview.example.com/assets/*" }],
  ])("refuses, writing nothing, when %s overlaps it", async (_label, route) => {
    const { api, run } = await setup(baseState({ routes: { [ZONE]: [route] } }));
    const result = await run();
    expect(result.status).toBe("refused");
    expect(api.writes()).toEqual([]);
  });

  it("still creates it when the only host under it is served by this Worker", async () => {
    const { api, run } = await setup(baseState({ domains: [domain("ok.preview.example.com")] }));
    const result = await run();
    expect(result.status).toBe("complete");
    expect(api.writes().some((w) => w.method === "POST")).toBe(true);
  });
});
