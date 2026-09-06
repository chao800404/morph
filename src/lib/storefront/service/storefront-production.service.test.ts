import { describe, expect, it, vi } from "vitest";
import { StorefrontProductionService } from "./storefront-production.service";
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
});
