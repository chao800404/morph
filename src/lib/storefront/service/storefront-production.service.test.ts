// @vitest-environment node
/**
 * Runs outside jsdom on purpose.
 *
 * These are runtime transports: they build one `Request` from another, which
 * copies the source's `AbortSignal`. Under jsdom the page gets jsdom's
 * `AbortSignal` while `Request` still comes from undici, and undici rejects a
 * signal it does not recognise — so `new Request(target, request)` throws for
 * a reason that exists nowhere but the test environment. Workers have one
 * realm and no DOM, and nothing here touches a document.
 */
import { SVG_VALIDATOR_VERSION } from "@/lib/security/svg-validation";
import { describe, expect, it, vi } from "vitest";
import {
  StorefrontProductionService,
  THEME_RUNTIME_UNAVAILABLE_PUBLIC_MESSAGE,
} from "./storefront-production.service";
import { createThemeRuntime } from "./storefront-request-routing";
import {
  DispatchNamespaceThemeRuntime,
  LocalDirectThemeRuntime,
  ServiceBindingThemeRuntime,
  UnavailableThemeRuntime,
} from "./theme-runtimes";
import { themeWorkerScriptName } from "./theme-runtime.types";
import type { StorefrontHostResolverDeps } from "./storefront-host-resolver";

const HOST = "shop.example.com";
const ASSET_PATH = "runtime/client/assets/app-abc123.js";

// Canonical manifest shape as persisted to D1: the artifact store maps the
// runner's `metadata` onto `runtime` before storing.
const manifest = {
  artifactEntry: "preview/index.html",
  files: [
    {
      path: ASSET_PATH,
      sha256: "deadbeef",
      contentType: "application/javascript; charset=utf-8",
    },
  ],
  runtime: {
    kind: "cloudflare-worker",
    workerEntry: "runtime/server/index.js",
    clientAssetsDirectory: "runtime/client",
  },
};

function resolverDeps(): StorefrontHostResolverDeps {
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
        id: "rel_1",
        themeId: "th_1",
        sourceRevisionId: "rev_1",
        themeBuildId: "bld_1",
        contentPublicationId: "pub_1",
      }),
    },
    buildDal: {
      getBuildById: async () => ({
        id: "bld_1",
        storefrontId: "sf_1",
        themeId: "th_1",
        status: "succeeded",
        artifactPrefix: "themes/th_1/builds/bld_1",
        manifestJson: manifest,
      }),
    },
  };
}

function r2(body = "console.log(1)") {
  return {
    get: vi.fn(async () => ({
      body: null,
      httpEtag: '"deadbeef"',
      httpMetadata: { contentType: "application/javascript; charset=utf-8" },
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    })),
  } as any;
}

function req(path: string, init?: RequestInit) {
  return new Request(`https://${HOST}${path}`, init);
}

describe("StorefrontProductionService", () => {
  it("routes only read-only catalog requests using the resolved storefront", async () => {
    const catalogHandler = vi.fn(async () => new Response("catalog"));
    const runtime = new UnavailableThemeRuntime();
    const service = new StorefrontProductionService({
      runtime,
      resolverDeps: resolverDeps(),
      catalogHandler,
    });
    const response = await service.handleRequest(
      req("/api/store/products", {
        headers: { "x-storefront-host": "attacker.example" },
      }),
    );
    expect(await response.text()).toBe("catalog");
    expect(catalogHandler).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ storefrontId: "sf_1", hostname: HOST }),
    );
    expect(
      (
        await service.handleRequest(
          req("/api/store/products", { method: "POST" }),
        )
      ).status,
    ).toBe(405);
    expect(catalogHandler).toHaveBeenCalledTimes(1);
  });

  it("exposes only token-authorized order transfer confirmation on the store host", async () => {
    const confirmationHandler = vi.fn(
      async () =>
        new Response(JSON.stringify({ orderTransfer: { status: "accepted" } }), {
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "cache-control": "private, no-store",
            "content-type": "application/json",
          },
        }),
    );
    const accountApiHandler = vi.fn(
      async () =>
        new Response(JSON.stringify({ orderTransfer: { status: "pending" } }), {
          headers: { "content-type": "application/json" },
        }),
    );
    const service = new StorefrontProductionService({
      runtime: new UnavailableThemeRuntime(),
      resolverDeps: resolverDeps(),
      orderTransferConfirmationHandler: confirmationHandler,
      storefrontCustomerApiHandler: accountApiHandler,
    });

    const response = await service.handleRequest(
      req("/api/store/orders/ord_123/transfer/accept", {
        method: "POST",
        headers: { "x-storefront-host": "attacker.example" },
      }),
    );

    expect(response.status).toBe(200);
    expect(confirmationHandler).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ storefrontId: "sf_1", hostname: HOST }),
      "ord_123",
      "accept",
    );
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-methods")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");

    const methodRejected = await service.handleRequest(
      req("/api/store/orders/ord_123/transfer/accept"),
    );
    const requestStarted = await service.handleRequest(
      req("/api/store/orders/ord_123/transfer/request", { method: "POST" }),
    );
    expect(methodRejected.status).toBe(405);
    expect(requestStarted.status).toBe(200);
    expect(accountApiHandler).toHaveBeenCalledWith(
      "POST",
      "orders/ord_123/transfer/request",
      expect.any(Request),
      expect.objectContaining({ storefrontId: "sf_1", hostname: HOST }),
    );
    expect(confirmationHandler).toHaveBeenCalledTimes(1);
  });

  it("proxies only the storefront sign-in and verification endpoints", async () => {
    const authHandler = vi.fn(
      async () =>
        new Response(JSON.stringify({ user: null }), {
          headers: {
            "access-control-allow-origin": "*",
            "cache-control": "public, max-age=60",
            "content-type": "application/json",
            "set-cookie": "better-auth.session_token=opaque; HttpOnly; Secure; Path=/; SameSite=Lax",
          },
        }),
    );
    const service = new StorefrontProductionService({
      runtime: new UnavailableThemeRuntime(),
      resolverDeps: resolverDeps(),
      storefrontAuthHandler: authHandler,
    });

    const response = await service.handleRequest(
      req("/api/auth/get-session", {
        headers: { "x-storefront-host": "attacker.example" },
      }),
    );
    expect(response.status).toBe(200);
    expect(authHandler).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ storefrontId: "sf_1", hostname: HOST }),
    );
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("set-cookie")).toContain(
      "better-auth.session_token=opaque",
    );

    const signUp = await service.handleRequest(
      req("/api/auth/sign-up/email", { method: "POST" }),
    );
    const otp = await service.handleRequest(
      req("/api/auth/email-otp/verify-email", { method: "POST" }),
    );
    const adminPlugin = await service.handleRequest(
      req("/api/auth/admin/set-role", { method: "POST" }),
    );
    const preflight = await service.handleRequest(
      req("/api/auth/get-session", { method: "OPTIONS" }),
    );
    expect(signUp.status).toBe(200);
    expect(otp.status).toBe(200);
    expect(adminPlugin.status).toBe(404);
    expect(preflight.status).toBe(404);
    expect(authHandler).toHaveBeenCalledTimes(3);
  });

  it("allows only ownership-scoped customer Store API routes on the store host", async () => {
    const accountApiHandler = vi.fn(
      async () =>
        new Response(JSON.stringify({ customer: { id: "cus_1" } }), {
          headers: {
            "access-control-allow-origin": "*",
            "content-type": "application/json",
          },
        }),
    );
    const service = new StorefrontProductionService({
      runtime: new UnavailableThemeRuntime(),
      resolverDeps: resolverDeps(),
      storefrontCustomerApiHandler: accountApiHandler,
    });

    const response = await service.handleRequest(
      req("/api/store/customers/me/orders?limit=20"),
    );
    const cancelReturn = await service.handleRequest(
      req("/api/store/customers/me/orders/order_1/returns/return_1", {
        method: "DELETE",
      }),
    );
    const claims = await service.handleRequest(
      req("/api/store/customers/me/orders/order_1/claims"),
    );
    const exchanges = await service.handleRequest(
      req("/api/store/customers/me/orders/order_1/exchanges"),
    );
    const unknown = await service.handleRequest(
      req("/api/store/customers/me/role"),
    );
    const preflight = await service.handleRequest(
      req("/api/store/customers/me", { method: "OPTIONS" }),
    );

    expect(response.status).toBe(200);
    expect(cancelReturn.status).toBe(200);
    expect(claims.status).toBe(200);
    expect(exchanges.status).toBe(200);
    expect(accountApiHandler).toHaveBeenCalledWith(
      "GET",
      "customers/me/orders",
      expect.any(Request),
      expect.objectContaining({ storefrontId: "sf_1", hostname: HOST }),
    );
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(accountApiHandler).toHaveBeenCalledWith(
      "DELETE",
      "customers/me/orders/order_1/returns/return_1",
      expect.any(Request),
      expect.objectContaining({ storefrontId: "sf_1", hostname: HOST }),
    );
    expect(accountApiHandler).toHaveBeenCalledWith(
      "GET",
      "customers/me/orders/order_1/claims",
      expect.any(Request),
      expect.objectContaining({ storefrontId: "sf_1", hostname: HOST }),
    );
    expect(accountApiHandler).toHaveBeenCalledWith(
      "GET",
      "customers/me/orders/order_1/exchanges",
      expect.any(Request),
      expect.objectContaining({ storefrontId: "sf_1", hostname: HOST }),
    );
    expect(unknown.status).toBe(404);
    expect(preflight.status).toBe(405);
    expect(accountApiHandler).toHaveBeenCalledTimes(4);
  });

  it("serves a declared client asset from the immutable artifact with public caching", async () => {
    const bucket = r2();
    const runtime = { kind: "local-direct" as const, handle: vi.fn() };
    const service = new StorefrontProductionService({
      runtime: runtime as any,
      r2Bucket: bucket,
      resolverDeps: resolverDeps(),
    });

    const res = await service.handleRequest(req("/assets/app-abc123.js"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
    expect(bucket.get).toHaveBeenCalledWith(
      "themes/th_1/builds/bld_1/runtime/client/assets/app-abc123.js",
    );
    expect(runtime.handle).not.toHaveBeenCalled();
  });

  it("honours a non-default client assets directory from the canonical manifest", async () => {
    const customManifest = {
      artifactEntry: "preview/index.html",
      files: [
        {
          path: "dist/browser/app.js",
          sha256: "cafe",
          contentType: "application/javascript; charset=utf-8",
        },
      ],
      runtime: {
        kind: "cloudflare-worker",
        workerEntry: "runtime/server/index.js",
        clientAssetsDirectory: "dist/browser",
      },
    };
    const bucket = r2();
    const base = resolverDeps();
    const service = new StorefrontProductionService({
      runtime: { kind: "local-direct", handle: vi.fn() } as any,
      r2Bucket: bucket,
      resolverDeps: {
        ...base,
        buildDal: {
          getBuildById: async () => ({
            id: "bld_1",
            storefrontId: "sf_1",
            themeId: "th_1",
            status: "succeeded",
            artifactPrefix: "themes/th_1/builds/bld_1",
            manifestJson: customManifest,
          }),
        },
      },
    });

    const res = await service.handleRequest(req("/app.js"));

    expect(res.status).toBe(200);
    expect(bucket.get).toHaveBeenCalledWith(
      "themes/th_1/builds/bld_1/dist/browser/app.js",
    );
  });

  it("delegates page requests to the Theme Worker runtime", async () => {
    let seenReleaseId: string | null = null;
    const handle = vi.fn(async (invocation: any) => {
      seenReleaseId = invocation.resolved.releaseId;
      return {
        success: true as const,
        response: new Response("<!doctype html>ssr", {
          headers: { "Content-Type": "text/html" },
        }),
      };
    });
    const service = new StorefrontProductionService({
      runtime: { kind: "local-direct", handle } as any,
      r2Bucket: r2(),
      resolverDeps: resolverDeps(),
    });

    const res = await service.handleRequest(req("/about"));

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ssr");
    expect(handle).toHaveBeenCalledOnce();
    expect(seenReleaseId).toBe("rel_1");
  });

  it("treats an undeclared asset-looking path as a page request, never as an R2 probe", async () => {
    const bucket = r2();
    const handle = vi.fn(async () => ({
      success: true as const,
      response: new Response("404 page", { status: 404 }),
    }));
    const service = new StorefrontProductionService({
      runtime: { kind: "local-direct", handle } as any,
      r2Bucket: bucket,
      resolverDeps: resolverDeps(),
    });

    const res = await service.handleRequest(req("/assets/not-in-manifest.js"));

    expect(bucket.get).not.toHaveBeenCalled();
    expect(handle).toHaveBeenCalledOnce();
    expect(res.status).toBe(404);
  });

  it("refuses a traversal-shaped path instead of handing it to the Theme Worker", async () => {
    const handle = vi.fn();
    const service = new StorefrontProductionService({
      runtime: { kind: "local-direct", handle } as any,
      r2Bucket: r2(),
      resolverDeps: resolverDeps(),
    });

    const res = await service.handleRequest(
      req("/assets/%2e%2e%2f%2e%2e%2fsecret"),
    );

    expect(res.status).toBe(400);
    expect(handle).not.toHaveBeenCalled();
  });

  it("fails closed when the host resolves to no active release", async () => {
    const deps = resolverDeps();
    const service = new StorefrontProductionService({
      runtime: new UnavailableThemeRuntime(),
      r2Bucket: r2(),
      resolverDeps: { ...deps, releaseDal: { getActive: async () => null } },
    });

    const res = await service.handleRequest(req("/"));
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("no active release");
  });

  it("reports an unconfigured runtime instead of serving a substitute page", async () => {
    const service = new StorefrontProductionService({
      runtime: new UnavailableThemeRuntime(),
      r2Bucket: r2(),
      resolverDeps: resolverDeps(),
    });

    const res = await service.handleRequest(req("/"));
    expect(res.status).toBe(503);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
  });

  it("keeps runtime configuration out of the public body and logs it for operators", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // The runtime the real environment selects when nothing is configured.
      const runtime = createThemeRuntime({});
      expect(runtime.kind).toBe("unavailable");
      const service = new StorefrontProductionService({
        runtime,
        r2Bucket: r2(),
        resolverDeps: resolverDeps(),
      });

      const res = await service.handleRequest(req("/"));
      const body = await res.text();

      expect(res.status).toBe(503);
      expect(Object.fromEntries(res.headers)).toEqual({
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
        "x-content-type-options": "nosniff",
      });
      expect(body).toBe(THEME_RUNTIME_UNAVAILABLE_PUBLIC_MESSAGE);
      for (const leaked of [
        "THEME_WORKER",
        "MORPH_LOCAL_THEME_ORIGIN",
        "not configured",
        "bind",
        "Theme Worker",
      ]) {
        expect(body).not.toContain(leaked);
      }

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [label, entry] = errorSpy.mock.calls[0]!;
      expect(label).toBe("[storefront] Theme runtime unavailable");
      expect(entry).toMatchObject({
        reason: "RUNTIME_NOT_CONFIGURED",
        runtime: "unavailable",
        status: 503,
        storefrontId: "sf_1",
      });
      expect((entry as { detail: string }).detail).toContain("THEME_WORKER");
      expect((entry as { detail: string }).detail).toContain(
        "MORPH_LOCAL_THEME_ORIGIN",
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("redacts origins and opaque values from the logged runtime detail", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const secretToken = "tok_9f8e7d6c5b4a39281706f5e4d3c2b1a0";
      const service = new StorefrontProductionService({
        runtime: new UnavailableThemeRuntime(
          `MORPH_LOCAL_THEME_ORIGIN=http://10.1.2.3:8799/internal?key=abc refused; also localhost:8799 and https://theme.internal.example/x; token ${secretToken}`,
        ),
        r2Bucket: r2(),
        resolverDeps: resolverDeps(),
      });

      const res = await service.handleRequest(req("/"));
      const body = await res.text();
      expect(body).toBe(THEME_RUNTIME_UNAVAILABLE_PUBLIC_MESSAGE);

      const logged = JSON.stringify(errorSpy.mock.calls);
      expect(logged).toContain("MORPH_LOCAL_THEME_ORIGIN");
      expect(logged).toContain("RUNTIME_NOT_CONFIGURED");
      for (const value of [
        "http://",
        "https://",
        "10.1.2.3",
        "8799",
        "key=abc",
        "theme.internal.example",
        "localhost",
        secretToken,
      ]) {
        expect(logged).not.toContain(value);
        expect(body).not.toContain(value);
      }
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("leaves other runtime failures unchanged", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const service = new StorefrontProductionService({
        runtime: new DispatchNamespaceThemeRuntime(),
        r2Bucket: r2(),
        resolverDeps: resolverDeps(),
      });
      const res = await service.handleRequest(req("/"));
      expect(res.status).toBe(503);
      expect(await res.text()).toBe(
        "Theme dispatch namespace binding is not configured.",
      );
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("themeWorkerScriptName", () => {
  it("derives one deterministic name per immutable build", () => {
    expect(themeWorkerScriptName("bld_ABC123")).toBe("morph-theme-bld-abc123");
    expect(themeWorkerScriptName("bld_ABC123")).toBe(
      themeWorkerScriptName("bld_ABC123"),
    );
  });

  it("refuses build ids that cannot form a valid script name", () => {
    expect(() => themeWorkerScriptName("")).toThrow(/INVALID_THEME_BUILD_ID/);
    expect(() => themeWorkerScriptName("b".repeat(80))).toThrow(
      /INVALID_THEME_BUILD_ID/,
    );
  });
});

describe("ThemeRuntime transports", () => {
  const invocation = {
    request: new Request(`https://${HOST}/about?x=1`),
    resolved: {
      hostname: HOST,
      themeBuildId: "bld_1",
      releaseId: "rel_1",
    },
  } as any;

  it("dispatch runtime reports an undeployed script as unavailable, not as a 200", async () => {
    const runtime = new DispatchNamespaceThemeRuntime({
      get: () => ({
        fetch: async () => {
          throw new Error("Worker not found");
        },
      }),
    });

    const result = await runtime.handle(invocation);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("SCRIPT_NOT_DEPLOYED");
    expect(result.status).toBe(503);
  });

  it("dispatch runtime fails closed with no binding configured", async () => {
    const result = await new DispatchNamespaceThemeRuntime().handle(invocation);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("RUNTIME_NOT_CONFIGURED");
  });

  it("dispatch runtime targets the script name derived from the build", async () => {
    const get = vi.fn(() => ({
      fetch: async () => new Response("ok"),
    }));
    const result = await new DispatchNamespaceThemeRuntime({ get }).handle(
      invocation,
    );
    expect(result.success).toBe(true);
    expect(get).toHaveBeenCalledWith("morph-theme-bld-1");
  });

  it("local runtime preserves path, query and storefront identity headers", async () => {
    const fetchImpl = vi.fn(async (input: any) => {
      const forwarded = input as Request;
      expect(new URL(forwarded.url).pathname).toBe("/about");
      expect(new URL(forwarded.url).search).toBe("?x=1");
      expect(forwarded.headers.get("x-morph-storefront-host")).toBe(HOST);
      expect(forwarded.headers.get("x-morph-release-id")).toBe("rel_1");
      return new Response("local");
    });

    const result = await new LocalDirectThemeRuntime(
      "http://127.0.0.1:8788",
      fetchImpl as any,
    ).handle(invocation);

    expect(result.success).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("local runtime negotiates identity upstream without changing the shopper request or consuming the stream", async () => {
    const original = new Request(invocation.request, {
      headers: {
        "accept-encoding": "gzip, deflate, br",
        cookie: "cart=fixture",
      },
    });
    const streamed = new Response(new ReadableStream());
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(input).toBeInstanceOf(Request);
      return streamed;
    });
    const result = await new LocalDirectThemeRuntime(
      "http://127.0.0.1:8799",
      fetchImpl,
    ).handle({ ...invocation, request: original });
    expect(result).toEqual({ success: true, response: streamed });
    expect(streamed.bodyUsed).toBe(false);
    expect(fetchImpl.mock.calls).toHaveLength(1);
    const forwarded = fetchImpl.mock.calls[0]![0] as Request;
    expect(forwarded.headers.get("accept-encoding")).toBe("identity");
    expect(forwarded.headers.get("cookie")).toBe("cart=fixture");
    expect(original.headers.get("accept-encoding")).toBe("gzip, deflate, br");
  });

  it("production service bindings retain the shopper compression negotiation", async () => {
    const input = new Request(invocation.request, {
      headers: { "accept-encoding": "gzip, deflate, br" },
    });
    const fetch = vi.fn(async (forwarded: Request) => {
      expect(forwarded.headers.get("accept-encoding")).toBe(
        "gzip, deflate, br",
      );
      return new Response("ok");
    });
    const result = await new ServiceBindingThemeRuntime(() => ({
      fetch,
    })).handle({
      ...invocation,
      request: input,
    });
    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("local runtime tells the Theme to fetch content from Morph Core, not from itself", async () => {
    // The forwarded request's URL has already been rewritten to the local Theme
    // Worker. Deriving the callback origin from it would send the Theme to its
    // own address, where there is no content endpoint, and the storefront would
    // silently render component defaults instead of published content.
    const fetchImpl = vi.fn(async (input: any) => {
      expect((input as Request).headers.get("x-morph-content-origin")).toBe(
        `https://${HOST}`,
      );
      return new Response("local");
    });

    const result = await new LocalDirectThemeRuntime(
      "http://127.0.0.1:8788",
      fetchImpl as any,
    ).handle(invocation);

    // Asserted explicitly: the transport catches everything the fetch throws,
    // so a failed expectation inside it would otherwise pass silently.
    expect(result.success).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("service binding runtime forwards the origin the request arrived on", async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(request.headers.get("x-morph-content-origin")).toBe(
        `https://${HOST}`,
      );
      return new Response("ok");
    });

    const result = await new ServiceBindingThemeRuntime(() => ({
      fetch,
    })).handle(invocation);

    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("never lets a client spoof the content origin", async () => {
    const spoofed = {
      ...invocation,
      request: new Request(`https://${HOST}/about?x=1`, {
        headers: { "x-morph-content-origin": "https://attacker.example" },
      }),
    };
    const fetch = vi.fn(async (request: Request) => {
      expect(request.headers.get("x-morph-content-origin")).toBe(
        `https://${HOST}`,
      );
      return new Response("ok");
    });

    const result = await new ServiceBindingThemeRuntime(() => ({
      fetch,
    })).handle(spoofed);

    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("ServiceBindingThemeRuntime", () => {
  const resolved = {
    hostname: HOST,
    storefrontId: "sf_1",
    releaseId: "rel_1",
    themeBuildId: "bld_1",
    contentPublicationId: "pub_1",
  } as any;

  it("forwards to the bound Theme Worker with resolved storefront context", async () => {
    let seen: Request | null = null;
    const runtime = new ServiceBindingThemeRuntime(() => ({
      fetch: async (request: Request) => {
        seen = request;
        return new Response("themed");
      },
    }));

    const result = await runtime.handle({
      request: new Request(`https://${HOST}/about`),
      resolved,
    });

    expect(result.success).toBe(true);
    expect(seen!.headers.get("x-morph-storefront-id")).toBe("sf_1");
    expect(seen!.headers.get("x-morph-release-id")).toBe("rel_1");
    expect(seen!.headers.get("x-morph-theme-build-id")).toBe("bld_1");
    expect(seen!.headers.get("x-morph-content-publication-id")).toBe("pub_1");
  });

  it("overwrites client-supplied storefront context headers", async () => {
    let seen: Request | null = null;
    const runtime = new ServiceBindingThemeRuntime(() => ({
      fetch: async (request: Request) => {
        seen = request;
        return new Response("themed");
      },
    }));

    await runtime.handle({
      request: new Request(`https://${HOST}/about`, {
        headers: {
          "x-morph-storefront-id": "sf_ATTACKER",
          "x-morph-release-id": "rel_ATTACKER",
        },
      }),
      resolved,
    });

    expect(seen!.headers.get("x-morph-storefront-id")).toBe("sf_1");
    expect(seen!.headers.get("x-morph-release-id")).toBe("rel_1");
  });

  it("strips a spoofed content publication header when the release has none", async () => {
    let seen: Request | null = null;
    const runtime = new ServiceBindingThemeRuntime(() => ({
      fetch: async (request: Request) => {
        seen = request;
        return new Response("themed");
      },
    }));

    await runtime.handle({
      request: new Request(`https://${HOST}/about`, {
        headers: { "x-morph-content-publication-id": "pub_ATTACKER" },
      }),
      resolved: { ...resolved, contentPublicationId: null },
    });

    expect(seen!.headers.get("x-morph-content-publication-id")).toBeNull();
  });

  it("refuses an unmapped storefront instead of using another Theme Worker", async () => {
    const result = await new ServiceBindingThemeRuntime(() => null).handle({
      request: new Request(`https://${HOST}/`),
      resolved,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("RUNTIME_NOT_CONFIGURED");
    expect(result.status).toBe(503);
  });
});

describe("DispatchNamespaceThemeRuntime storefront context", () => {
  const resolved = {
    hostname: HOST,
    storefrontId: "sf_1",
    releaseId: "rel_1",
    themeBuildId: "bld_1",
    contentPublicationId: "pub_1",
  } as any;

  function dispatchRuntime() {
    const fetch = vi.fn(async (_request: Request) => new Response("themed"));
    const runtime = new DispatchNamespaceThemeRuntime({
      get: () => ({ fetch }),
    });
    return { runtime, fetch };
  }

  function dispatched(fetch: ReturnType<typeof dispatchRuntime>["fetch"]) {
    expect(fetch).toHaveBeenCalledOnce();
    return fetch.mock.calls[0]![0];
  }

  it("forwards the resolved storefront context to the dispatched Theme Worker", async () => {
    const { runtime, fetch } = dispatchRuntime();

    const result = await runtime.handle({
      request: new Request(`https://${HOST}/about?x=1`),
      resolved,
    });

    expect(result.success).toBe(true);
    const seen = dispatched(fetch);
    expect(new URL(seen.url).pathname).toBe("/about");
    expect(seen.headers.get("x-morph-storefront-host")).toBe(HOST);
    expect(seen.headers.get("x-morph-content-origin")).toBe(`https://${HOST}`);
    expect(seen.headers.get("x-morph-storefront-id")).toBe("sf_1");
    expect(seen.headers.get("x-morph-release-id")).toBe("rel_1");
    expect(seen.headers.get("x-morph-theme-build-id")).toBe("bld_1");
    expect(seen.headers.get("x-morph-content-publication-id")).toBe("pub_1");
  });

  it("overwrites every client-supplied storefront context header", async () => {
    // A visitor-supplied content origin would make the Theme render "published
    // content" fetched from an origin the visitor controls.
    const { runtime, fetch } = dispatchRuntime();

    const result = await runtime.handle({
      request: new Request(`https://${HOST}/about`, {
        headers: {
          "x-morph-storefront-host": "attacker.example",
          "x-morph-content-origin": "https://attacker.example",
          "x-morph-storefront-id": "sf_ATTACKER",
          "x-morph-release-id": "rel_ATTACKER",
          "x-morph-theme-build-id": "bld_ATTACKER",
          "x-morph-content-publication-id": "pub_ATTACKER",
        },
      }),
      resolved,
    });

    expect(result.success).toBe(true);
    const seen = dispatched(fetch);
    expect(seen.headers.get("x-morph-storefront-host")).toBe(HOST);
    expect(seen.headers.get("x-morph-content-origin")).toBe(`https://${HOST}`);
    expect(seen.headers.get("x-morph-storefront-id")).toBe("sf_1");
    expect(seen.headers.get("x-morph-release-id")).toBe("rel_1");
    expect(seen.headers.get("x-morph-theme-build-id")).toBe("bld_1");
    expect(seen.headers.get("x-morph-content-publication-id")).toBe("pub_1");
  });

  it("strips a spoofed content publication header when the release has none", async () => {
    const { runtime, fetch } = dispatchRuntime();

    const result = await runtime.handle({
      request: new Request(`https://${HOST}/about`, {
        headers: { "x-morph-content-publication-id": "pub_ATTACKER" },
      }),
      resolved: { ...resolved, contentPublicationId: null },
    });

    expect(result.success).toBe(true);
    expect(
      dispatched(fetch).headers.get("x-morph-content-publication-id"),
    ).toBeNull();
  });
});

describe("LocalDirectThemeRuntime global binding", () => {
  it("calls the runtime fetch with the global receiver, not the instance", async () => {
    // Workers reject a `fetch` invoked with any other receiver:
    // "Illegal invocation: function called with incorrect `this` reference".
    // Storing the global on the instance and calling `this.fetchImpl(...)`
    // does exactly that, so the default must wrap instead of alias.
    const seen: unknown[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = function (this: unknown) {
      seen.push(this);
      return Promise.resolve(new Response("ok"));
    } as unknown as typeof fetch;

    try {
      const runtime = new LocalDirectThemeRuntime("http://127.0.0.1:8799");
      const result = await runtime.handle({
        request: new Request(`https://${HOST}/about`),
        resolved: {
          hostname: HOST,
          storefrontId: "sf_1",
          releaseId: "rel_1",
          themeBuildId: "bld_1",
          contentPublicationId: null,
        } as never,
      });

      expect(result.success).toBe(true);
      expect(seen).toHaveLength(1);
      expect(seen[0] === globalThis || seen[0] === undefined).toBe(true);
      expect(seen[0]).not.toBeInstanceOf(LocalDirectThemeRuntime);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("what of a shopper's request reaches the Theme Worker", () => {
  const resolved = {
    hostname: HOST,
    storefrontId: "sf_1",
    releaseId: "rel_1",
    themeBuildId: "bld_1",
    contentPublicationId: "pub_1",
  } as any;

  /** Each transport, run once, returning the request the Theme received. */
  const transports: ReadonlyArray<
    readonly [string, (request: Request) => Promise<Request>]
  > = [
    [
      "service binding",
      async (request) => {
        const fetch = vi.fn(async (_r: Request) => new Response("ok"));
        const result = await new ServiceBindingThemeRuntime(() => ({
          fetch,
        })).handle({ request, resolved });
        expect(result.success).toBe(true);
        expect(fetch).toHaveBeenCalledOnce();
        return fetch.mock.calls[0]![0];
      },
    ],
    [
      "dispatch namespace",
      async (request) => {
        const fetch = vi.fn(async (_r: Request) => new Response("ok"));
        const result = await new DispatchNamespaceThemeRuntime({
          get: () => ({ fetch }),
        }).handle({ request, resolved });
        expect(result.success).toBe(true);
        expect(fetch).toHaveBeenCalledOnce();
        return fetch.mock.calls[0]![0];
      },
    ],
    [
      "local direct",
      async (request) => {
        const fetchImpl = vi.fn(
          async (_input: RequestInfo | URL) => new Response("ok"),
        );
        const result = await new LocalDirectThemeRuntime(
          "http://127.0.0.1:8788",
          fetchImpl,
        ).handle({ request, resolved });
        expect(result.success).toBe(true);
        expect(fetchImpl).toHaveBeenCalledOnce();
        return fetchImpl.mock.calls[0]![0] as Request;
      },
    ],
  ];

  describe.each(transports)("over the %s transport", (_name, forward) => {
    it("keeps Core's storefront context over forged values", async () => {
      const seen = await forward(
        new Request(`https://${HOST}/about`, {
          headers: {
            "x-morph-storefront-host": "attacker.example",
            "x-morph-content-origin": "https://attacker.example",
            "x-morph-storefront-id": "sf_ATTACKER",
            "x-morph-release-id": "rel_ATTACKER",
            "x-morph-theme-build-id": "bld_ATTACKER",
            "x-morph-content-publication-id": "pub_ATTACKER",
          },
        }),
      );
      expect(seen.headers.get("x-morph-storefront-host")).toBe(HOST);
      expect(seen.headers.get("x-morph-content-origin")).toBe(
        `https://${HOST}`,
      );
      expect(seen.headers.get("x-morph-storefront-id")).toBe("sf_1");
      expect(seen.headers.get("x-morph-release-id")).toBe("rel_1");
      expect(seen.headers.get("x-morph-theme-build-id")).toBe("bld_1");
      expect(seen.headers.get("x-morph-content-publication-id")).toBe("pub_1");
    });

    it("drops every other inbound x-morph-* header", async () => {
      const seen = await forward(
        new Request(`https://${HOST}/about`, {
          headers: {
            "x-morph-preview-id": "prv_ATTACKER",
            "x-morph-draft": "1",
          },
        }),
      );
      expect(seen.headers.get("x-morph-preview-id")).toBeNull();
      expect(seen.headers.get("x-morph-draft")).toBeNull();
      const morphHeaders = [...seen.headers.keys()]
        .filter((name) => name.startsWith("x-morph-"))
        .sort();
      expect(morphHeaders).toEqual(
        [
          "x-morph-content-origin",
          "x-morph-content-publication-id",
          "x-morph-release-id",
          "x-morph-storefront-host",
          "x-morph-storefront-id",
          "x-morph-theme-build-id",
        ].sort(),
      );
    });

    it("removes platform credential cookies and keeps the Theme's, in order", async () => {
      const seen = await forward(
        new Request(`https://${HOST}/about`, {
          headers: {
            cookie:
              "better-auth.session_token=secret; theme_pref=1; __Secure-better-auth.x=y; cart=fixture",
          },
        }),
      );
      expect(seen.headers.get("cookie")).toBe("theme_pref=1; cart=fixture");
    });

    it("sends no cookie header when every cookie is a platform credential", async () => {
      const seen = await forward(
        new Request(`https://${HOST}/about`, {
          headers: {
            cookie: "better-auth.session_token=secret; __Host-verify_access=z",
          },
        }),
      );
      expect(seen.headers.has("cookie")).toBe(false);
    });

    it.each<readonly [string, HeadersInit, string]>([
      [
        "whitespace around pairs and the `=`",
        { cookie: " better-auth.session_token =x ;theme=1" },
        "theme=1",
      ],
      // A pair with no name is never a platform cookie; it passes untouched.
      ["a nameless pair", { cookie: "=value; theme=1" }, "=value; theme=1"],
      [
        "a __Host- platform name",
        { cookie: "__Host-better-auth.session_token=s; theme=1" },
        "theme=1",
      ],
      [
        "a lowercase __secure- prefix",
        { cookie: "__secure-better-auth.x=y; theme=1" },
        "theme=1",
      ],
      [
        "a mixed-case __HoSt- prefix",
        { cookie: "__HoSt-better-auth.x=y; theme=1" },
        "theme=1",
      ],
      [
        "the password-reset grant",
        { cookie: "verify_access=t; theme=1" },
        "theme=1",
      ],
      // Assumption, not verified: workerd joins repeated `cookie` headers
      // into one value with "; ", as Node's (undici's) `Headers` does here.
      // If it joined them otherwise, this case would not describe production.
      [
        "two cookie headers on one request",
        [
          ["cookie", "better-auth.session_token=s; theme=1"],
          ["cookie", "cart=fixture"],
        ],
        "theme=1; cart=fixture",
      ],
    ])("filters cookies given %s", async (_case, headers, expected) => {
      const seen = await forward(
        new Request(`https://${HOST}/about`, { headers }),
      );
      expect(seen.headers.get("cookie")).toBe(expected);
    });

    it("leaves headers outside x-morph-* and cookie as they were", async () => {
      const seen = await forward(
        new Request(`https://${HOST}/about`, {
          headers: {
            "accept-language": "zh-TW,en;q=0.8",
            "user-agent": "Shopper/1.0",
            authorization: "Bearer theme-own",
          },
        }),
      );
      expect(seen.headers.get("accept-language")).toBe("zh-TW,en;q=0.8");
      expect(seen.headers.get("user-agent")).toBe("Shopper/1.0");
      expect(seen.headers.get("authorization")).toBe("Bearer theme-own");
    });
  });
});

describe("published content endpoint", () => {
  const contentPorts = {
    getPublishedDocument: vi.fn(async () => ({
      sections: [
        { id: "starter-hero", enabled: true, props: { heading: "Published" } },
      ],
    })),
  };

  function service(overrides: Record<string, unknown> = {}) {
    return new StorefrontProductionService({
      runtime: { kind: "local-direct", handle: vi.fn() } as never,
      r2Bucket: r2(),
      resolverDeps: resolverDeps(),
      contentPorts: contentPorts as never,
      ...overrides,
    });
  }

  it("serves the active release's content for a route", async () => {
    contentPorts.getPublishedDocument.mockClear();
    const res = await service().handleRequest(req("/_morph/content?path=/"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    // `hiddenSlots` travels with the slots: a section the author hid has to be
    // named, because an absent slot means "no stored values" and the theme
    // answers that with the component's own defaults.
    expect(await res.json()).toEqual({
      slots: { "starter-hero": { heading: "Published" } },
      hiddenSlots: [],
    });
    // Scoped to the publication the active release points at, never a draft.
    expect(contentPorts.getPublishedDocument).toHaveBeenCalledWith({
      publicationId: "pub_1",
      templateType: "index",
    });
  });

  it("versions the response by release so rollback restores content", async () => {
    const res = await service().handleRequest(req("/_morph/content?path=/"));
    expect(res.headers.get("ETag")).toContain("rel_1");
  });

  it("never reaches the Theme Worker for this path", async () => {
    const handle = vi.fn();
    await service({
      runtime: { kind: "local-direct", handle } as never,
    }).handleRequest(req("/_morph/content?path=/"));
    expect(handle).not.toHaveBeenCalled();
  });

  it("refuses a path that could not be a route", async () => {
    const res = await service().handleRequest(
      req("/_morph/content?path=notapath"),
    );
    expect(res.status).toBe(400);
  });

  it("refuses a write method", async () => {
    const res = await service().handleRequest(
      req("/_morph/content?path=/", { method: "POST" }),
    );
    expect(res.status).toBe(405);
  });

  it("reports an unconfigured content source instead of serving empty content", async () => {
    // Silently returning no slots would render the site with placeholder copy
    // and look like a successful publish.
    const res = await service({ contentPorts: undefined }).handleRequest(
      req("/_morph/content?path=/"),
    );
    expect(res.status).toBe(503);
  });

  it("isolates an SVG a Theme route answers with, and leaves pages alone", async () => {
    const answers: Record<string, Response> = {
      "/icon": new Response("<svg/>", {
        headers: { "Content-Type": "image/svg+xml" },
      }),
      "/page": new Response("<p>", {
        headers: { "Content-Type": "text/html" },
      }),
    };
    const runtime = {
      kind: "local-direct" as const,
      handle: vi.fn(async ({ request }: { request: Request }) => ({
        success: true as const,
        response: answers[new URL(request.url).pathname]!,
      })),
    };
    const service = new StorefrontProductionService({
      runtime: runtime as any,
      r2Bucket: r2(),
      resolverDeps: resolverDeps(),
    });

    const icon = await service.handleRequest(req("/icon"));
    expect(icon.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(icon.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const page = await service.handleRequest(req("/page"));
    expect(page.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("sends published SVG media as an isolated download, whatever its stored verdict", async () => {
    const key = "assets/11111111-1111-4111-8111-111111111111.svg";
    const service = new StorefrontProductionService({
      runtime: new UnavailableThemeRuntime(),
      r2Bucket: {
        get: vi.fn(async () => ({
          body: "<svg/>",
          httpMetadata: { contentType: "image/svg+xml" },
          // Even a file that passed the current rules is never inline here.
          customMetadata: {
            svgValidatorVersion: String(SVG_VALIDATOR_VERSION),
          },
        })),
      } as any,
      resolverDeps: resolverDeps(),
      mediaPorts: {
        listPublishedAssetKeys: async () =>
          new Map([["11111111-1111-4111-8111-111111111111", new Set([key])]]),
      },
    });

    const res = await service.handleRequest(
      req("/_storefront-media/11111111-1111-4111-8111-111111111111"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe("attachment");
    expect(res.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
