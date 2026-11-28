// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createInventoryApi } from "./cloudflare-api";
import type { DeployTarget } from "./deploy-target";
import { compareInventory, readInventory, reconcile, type Verdict } from "./inventory";
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
  customDomains: ["admin.example.com"],
  routes: [{ pattern: "*.preview.example.com/*" }],
  previewNamespace: "preview.example.com",
};

const apis: MockApi[] = [];
afterEach(async () => {
  for (const api of apis.splice(0)) await api.close();
});

/** A healthy account: the platform domain and Route, and two storefronts' domains. */
function healthyState(): MockState {
  const admin = domain("admin.example.com");
  const shopA = domain("shop-a.example.com");
  const shopB = domain("shop-b.example.com");
  return baseState({
    domains: [admin, shopA, shopB, domain("other.example.com", { service: "someone-else" })],
    routes: {
      [ZONE]: [
        { id: "route-preview", pattern: "*.preview.example.com/*", script: WORKER },
        { id: "route-foreign", pattern: "blog.example.com/*", script: "blog-worker" },
      ],
    },
    d1: {
      [D1_ID]: [
        row("shop-a.example.com", shopA.id),
        // A second storefront: Settings only shows the oldest, the inventory covers both.
        { ...row("shop-b.example.com", shopB.id), storefront_id: "00000000-0000-4000-8000-000000000003" },
        row("pending.example.com", null, "pending"),
      ],
    },
  });
}

async function verdictFor(
  state: MockState,
  options: { mode?: "strict" | "bootstrap"; mutate?: (api: MockApi) => void; maxReads?: number } = {},
): Promise<{ verdict: Verdict; api: MockApi }> {
  const api = await startMockCloudflareApi(state);
  apis.push(api);
  options.mutate?.(api);
  const client = createInventoryApi({ baseUrl: api.baseUrl, token: "inventory-token", accountId: ACCOUNT });
  const verdict = await reconcile({
    read: () => readInventory(client, TARGET, MANIFEST),
    compare: (snapshot) => compareInventory({ snapshot, target: TARGET, manifest: MANIFEST, mode: options.mode ?? "strict" }),
    delayMs: 0,
    maxReads: options.maxReads ?? 4,
    sleep: async () => {},
  });
  return { verdict, api };
}

const kinds = (verdict: Verdict) =>
  verdict.status === "drift" ? verdict.drift.map((d) => d.kind) : [];

describe("the binding inventory", () => {
  it("matches exact identities, and only reads", async () => {
    const state = healthyState();
    state.d1[D1_ID] = state.d1[D1_ID]!.filter((r) => r.status !== "pending");
    const { verdict, api } = await verdictFor(state);
    expect(verdict.status).toBe("ok");
    expect(verdict.reads).toBe(1);
    expect(api.writes()).toEqual([]);
    for (const request of api.requests) expect(request.authorization).toBe("Bearer inventory-token");
    // The D1 query covers every undeleted storefront, joined to storefronts.
    const d1 = api.requests.find((r) => r.path.endsWith("/query"))!;
    expect(JSON.parse(d1.body).sql).toMatch(/JOIN storefronts s .* s\.deleted_at IS NULL/);
    // Custom Domains and Routes are read unfiltered.
    expect(api.requests.find((r) => r.path.endsWith("/workers/domains"))!.query.toString()).toBe("");
  });

  it("re-reads a pending row (a connect in progress) once, and reports it without failing", async () => {
    const { verdict } = await verdictFor(healthyState());
    expect(verdict.status).toBe("ok");
    expect(verdict.reads).toBe(2);
    if (verdict.status === "ok") {
      expect(verdict.diagnostics).toEqual([
        expect.stringMatching(/^pending storefront domain pending\.example\.com/),
        expect.stringMatching(/^1 pending row\(s\) unchanged across 2 paired read\(s\)/),
      ]);
    }
  });

  it("reads again when a new pending row appears on the second read", async () => {
    const state = healthyState();
    const { verdict } = await verdictFor(state, {
      mutate: (api) => {
        let reads = 0;
        api.beforeAnswer.push((request, s) => {
          if (request.path.endsWith("/query") && ++reads === 2) s.d1[D1_ID]!.push(row("second.example.com", null, "pending"));
        });
      },
    });
    expect(verdict.status).toBe("ok");
    expect(verdict.reads).toBe(3);
  });

  it("is transient when a pending row first appears on the last allowed read", async () => {
    const state = healthyState();
    state.d1[D1_ID] = state.d1[D1_ID]!.filter((r) => r.status !== "pending");
    const { verdict } = await verdictFor(state, {
      maxReads: 2,
      mutate: (api) => {
        let reads = 0;
        api.beforeAnswer.push((request, s) => {
          // Read 1 finds drift (shop-b unbound); read 2 rebinds it and a connect starts.
          if (request.path.endsWith("/query") && ++reads === 2) s.d1[D1_ID]!.push(row("late.example.com", null, "pending"));
        });
        const shopB = api.state.domains.find((d) => d.hostname === "shop-b.example.com")!;
        api.state.domains = api.state.domains.filter((d) => d !== shopB);
        let domainReads = 0;
        api.beforeAnswer.push((request, s) => {
          if (request.path.endsWith("/workers/domains") && ++domainReads === 2) s.domains.push(shopB);
        });
      },
    });
    expect(verdict.status).toBe("transient");
  });

  it("is unavailable when a page carries more entries than its per_page", async () => {
    const state = healthyState();
    const api = await startMockCloudflareApi(state, {
      handlers: [
        (request) => {
          if (request.path !== `/accounts/${ACCOUNT}/workers/domains`) return undefined;
          const page = Number(request.query.get("page") ?? "1");
          const result = page === 1 ? state.domains.slice(0, 1) : state.domains.slice(1);
          return {
            status: 200,
            body: { success: true, errors: [], result, result_info: { page, per_page: 1, total_pages: 2, count: result.length, total_count: state.domains.length } },
          };
        },
      ],
    });
    apis.push(api);
    const client = createInventoryApi({ baseUrl: api.baseUrl, token: "t", accountId: ACCOUNT });
    await expect(client.listWorkerDomains()).rejects.toThrow(/more than per_page/);
  });

  it("is unavailable when a page's count disagrees with its entries", async () => {
    const state = healthyState();
    const api = await startMockCloudflareApi(state, {
      handlers: [
        (request) =>
          request.path === `/zones/${ZONE}/workers/routes`
            ? { status: 200, body: { success: true, errors: [], result: state.routes[ZONE], result_info: { count: 99 } } }
            : undefined,
      ],
    });
    apis.push(api);
    const client = createInventoryApi({ baseUrl: api.baseUrl, token: "t", accountId: ACCOUNT });
    await expect(client.listZoneRoutes(ZONE)).rejects.toThrow(/says 99 entries/);
  });

  it("compares a pending row that activates between the paired reads", async () => {
    const state = healthyState();
    const { verdict } = await verdictFor(state, {
      mutate: (api) => {
        let reads = 0;
        api.beforeAnswer.push((request, s) => {
          if (request.path.endsWith("/query") && ++reads === 2) {
            // Activated in D1 with an id, but the attach left no binding: drift.
            s.d1[D1_ID] = s.d1[D1_ID]!.map((r) => (r.status === "pending" ? { ...r, status: "active", cloudflare_domain_id: "lost" } : r));
          }
        });
      },
    });
    expect(verdict.status).toBe("drift");
    expect(kinds(verdict)).toEqual(["storefront-domain-missing"]);
  });

  it("reports a storefront domain inside the preview namespace", async () => {
    const state = healthyState();
    state.d1[D1_ID] = state.d1[D1_ID]!.filter((r) => r.status !== "pending");
    const hidden = domain("t1.preview.example.com");
    state.domains.push(hidden);
    state.d1[D1_ID]!.push(row("t1.preview.example.com", hidden.id));
    const { verdict } = await verdictFor(state);
    expect(kinds(verdict)).toEqual(["storefront-domain-in-preview-namespace"]);
  });

  it("reports a storefront domain that is active in D1 and not bound as drift, after a paired re-read", async () => {
    const state = healthyState();
    state.domains = state.domains.filter((d) => d.hostname !== "shop-b.example.com");
    const { verdict } = await verdictFor(state);
    expect(verdict.status).toBe("drift");
    expect(verdict.reads).toBe(2);
    expect(kinds(verdict)).toEqual(["storefront-domain-missing"]);
  });

  it("reports a binding whose id differs from its D1 row, and one bound to another Worker", async () => {
    const state = healthyState();
    state.domains = state.domains.map((d) =>
      d.hostname === "shop-a.example.com" ? { ...d, id: "re-created-by-hand" } : d.hostname === "shop-b.example.com" ? { ...d, service: "morph" } : d,
    );
    const { verdict } = await verdictFor(state);
    expect(kinds(verdict).sort()).toEqual(["storefront-domain-id-mismatch", "storefront-domain-wrong-owner"]);
  });

  it("reports platform bindings that are missing, foreign, or unknown to the config", async () => {
    const state = healthyState();
    state.domains = [
      ...state.domains.filter((d) => d.hostname !== "admin.example.com"),
      domain("admin.example.com", { service: "morph" }),
      domain("leftover.example.com"),
    ];
    state.routes[ZONE] = [{ id: "route-x", pattern: "*.old-preview.example.com/*", script: WORKER }];
    const { verdict } = await verdictFor(state);
    expect(kinds(verdict).sort()).toEqual([
      "platform-domain-wrong-owner",
      "platform-route-missing",
      "unknown-domain",
      "unknown-route",
    ]);
  });

  it("tolerates missing platform bindings in bootstrap mode, and nothing else", async () => {
    const state = healthyState();
    state.domains = state.domains.filter((d) => d.hostname !== "admin.example.com" && d.hostname !== "shop-a.example.com");
    state.routes[ZONE] = [];
    const { verdict } = await verdictFor(state, { mode: "bootstrap" });
    expect(kinds(verdict)).toEqual(["storefront-domain-missing"]);
    if (verdict.status === "drift") {
      expect(verdict.tolerated.map((d) => d.kind).sort()).toEqual(["platform-domain-missing", "platform-route-missing"]);
    }
  });

  it("reports a connect that completes between reads as ok, not drift", async () => {
    const state = healthyState();
    const late = domain("late.example.com");
    // Read 1: D1 already active, API not yet bound (the connect's attach in flight).
    state.d1[D1_ID]!.push(row("late.example.com", late.id));
    const { verdict } = await verdictFor(state, {
      mutate: (api) => {
        let reads = 0;
        api.beforeAnswer.push((request, s) => {
          if (request.path.endsWith("/workers/domains") && request.method === "GET" && ++reads === 2) s.domains.push(late);
        });
      },
    });
    expect(verdict.status).toBe("ok");
    expect(verdict.reads).toBe(2);
  });

  it("reports a binding still moving after the bounded reads as transient", async () => {
    const state = healthyState();
    let flip = 0;
    const { verdict } = await verdictFor(state, {
      maxReads: 3,
      mutate: (api) => {
        api.beforeAnswer.push((request, s) => {
          if (request.path.endsWith("/workers/domains") && request.method === "GET") {
            flip += 1;
            const hostname = flip % 2 === 1 ? "a-moving.example.com" : "b-moving.example.com";
            s.domains = [...s.domains.filter((d) => !d.hostname.endsWith("-moving.example.com")), domain(hostname)];
          }
        });
      },
    });
    expect(verdict.status).toBe("transient");
    expect(verdict.reads).toBe(3);
  });

  it.each([
    ["a 500 from the Custom Domains list", { method: "GET", path: `/accounts/${ACCOUNT}/workers/domains`, times: 9, status: 500 }],
    ["a 403 from D1", { method: "POST", path: `/accounts/${ACCOUNT}/d1/database/`, times: 9, status: 403 }],
    ["success:false with HTTP 200", { method: "GET", path: `/zones/${ZONE}/workers/routes`, times: 9, status: 200, body: { success: false, errors: [{ code: 10000, message: "x" }], result: null } }],
    ["an answer that is not JSON", { method: "GET", path: `/zones/${ZONE}`, times: 9, status: 200, body: "<html>" }],
  ])("is unavailable, never empty, on %s", async (_label, fault) => {
    const { verdict } = await verdictFor(healthyState(), { mutate: (api) => api.faults.push(fault) });
    expect(verdict.status).toBe("unavailable");
  });

  it("is unavailable when a list cannot be shown complete", async () => {
    const state = healthyState();
    const api = await startMockCloudflareApi(state, {
      handlers: [
        (request) =>
          request.path === `/accounts/${ACCOUNT}/workers/domains`
            ? { status: 200, body: { success: true, errors: [], result: state.domains, result_info: { total_count: state.domains.length + 1 } } }
            : undefined,
      ],
    });
    apis.push(api);
    const client = createInventoryApi({ baseUrl: api.baseUrl, token: "t", accountId: ACCOUNT });
    await expect(client.listWorkerDomains()).rejects.toThrow(/incomplete list/);
  });

  it("follows every page a paged answer announces", async () => {
    const state = healthyState();
    const api = await startMockCloudflareApi(state, {
      handlers: [
        (request) => {
          if (request.path !== `/accounts/${ACCOUNT}/workers/domains`) return undefined;
          const page = Number(request.query.get("page") ?? "1");
          const slice = state.domains.slice((page - 1) * 2, page * 2);
          return {
            status: 200,
            body: { success: true, errors: [], result: slice, result_info: { page, per_page: 2, total_pages: 2, total_count: state.domains.length } },
          };
        },
      ],
    });
    apis.push(api);
    const client = createInventoryApi({ baseUrl: api.baseUrl, token: "t", accountId: ACCOUNT });
    expect((await client.listWorkerDomains()).map((d) => d.hostname)).toEqual(state.domains.map((d) => d.hostname));
  });

  it("compares the post-deploy read with the pre-deploy read by identity, not by count", async () => {
    const state = healthyState();
    const api = await startMockCloudflareApi(state);
    apis.push(api);
    const client = createInventoryApi({ baseUrl: api.baseUrl, token: "t", accountId: ACCOUNT });
    const before = await readInventory(client, TARGET, MANIFEST);
    // Same number of bindings, but the platform domain was re-created with a new id.
    state.domains = state.domains.map((d) => (d.hostname === "admin.example.com" ? { ...d, id: "new-id" } : d));
    const after = await readInventory(client, TARGET, MANIFEST);
    const { discrepancies } = compareInventory({ snapshot: after, target: TARGET, manifest: MANIFEST, mode: "strict", baseline: before });
    expect(discrepancies.map((d) => d.kind)).toEqual(["platform-domain-changed"]);
  });

  it("reports a storefront row whose id and binding both changed during the deploy", async () => {
    const state = healthyState();
    const api = await startMockCloudflareApi(state);
    apis.push(api);
    const client = createInventoryApi({ baseUrl: api.baseUrl, token: "t", accountId: ACCOUNT });
    const before = await readInventory(client, TARGET, MANIFEST);
    // Each read alone is consistent (D1 and the API agree); only the pair shows the change.
    state.domains = state.domains.map((d) => (d.hostname === "shop-a.example.com" ? { ...d, id: "rebound" } : d));
    state.d1[D1_ID] = state.d1[D1_ID]!.map((r) => (r.hostname === "shop-a.example.com" ? { ...r, cloudflare_domain_id: "rebound" } : r));
    const after = await readInventory(client, TARGET, MANIFEST);
    expect(compareInventory({ snapshot: after, target: TARGET, manifest: MANIFEST, mode: "strict" }).discrepancies).toEqual([]);
    const { discrepancies } = compareInventory({ snapshot: after, target: TARGET, manifest: MANIFEST, mode: "strict", baseline: before });
    expect(discrepancies.map((d) => d.kind)).toEqual(["storefront-domain-changed"]);
  });

  it("is unavailable when the pages of a list contradict each other", async () => {
    const state = healthyState();
    const api = await startMockCloudflareApi(state, {
      handlers: [
        (request) => {
          if (request.path !== `/accounts/${ACCOUNT}/workers/domains`) return undefined;
          const page = Number(request.query.get("page") ?? "1");
          // Page 1 says 3 entries over 2 pages; page 2 says 2 entries. Two arrive.
          return {
            status: 200,
            body: {
              success: true,
              errors: [],
              result: state.domains.slice(page - 1, page),
              result_info: { page, per_page: 1, total_pages: 2, total_count: page === 1 ? 3 : 2 },
            },
          };
        },
      ],
    });
    apis.push(api);
    const client = createInventoryApi({ baseUrl: api.baseUrl, token: "t", accountId: ACCOUNT });
    await expect(client.listWorkerDomains()).rejects.toThrow(/describes another list/);
  });
});
