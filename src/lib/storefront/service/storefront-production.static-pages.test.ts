// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { StorefrontProductionService } from "./storefront-production.service";
import type { StorefrontHostResolverDeps } from "./storefront-host-resolver";
import type { ThemeRuntime } from "./theme-runtime.types";

/**
 * Core serves a registered static page itself, from the active release's
 * immutable build artifact; the Theme Worker never sees the request.
 */

const HOST = "shop.example.com";
const PREFIX = "storefronts/sf_1/themes/th_1/builds/bld_1";
const HOME_HTML = "<!doctype html><h1>Home, release one</h1>";
const ABOUT_HTML = "<!doctype html><h1>About, release one</h1>";
const LANDING_HTML = "<!doctype html><h1>Landing, never registered</h1>";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function manifest(
  staticPages: unknown = [
    { path: "/", artifactPath: "runtime/client/index.html", sha256: sha(HOME_HTML) },
    {
      path: "/about",
      artifactPath: "runtime/client/about/index.html",
      sha256: sha(ABOUT_HTML),
    },
  ],
) {
  return {
    artifactEntry: "runtime/server/index.js",
    files: [
      { path: "runtime/client/index.html", sha256: sha(HOME_HTML), contentType: "text/html" },
      {
        path: "runtime/client/about/index.html",
        sha256: sha(ABOUT_HTML),
        contentType: "text/html",
      },
      {
        path: "runtime/client/landing/index.html",
        sha256: sha(LANDING_HTML),
        contentType: "text/html",
      },
      {
        path: "runtime/client/assets/app.js",
        sha256: "f".repeat(64),
        contentType: "application/javascript; charset=utf-8",
      },
    ],
    runtime: {
      kind: "cloudflare-worker",
      workerEntry: "runtime/server/index.js",
      clientAssetsDirectory: "runtime/client",
      ...(staticPages === null ? {} : { staticPages }),
    },
  };
}

function resolverDeps(manifestJson: unknown, releaseId = "rel_1"): StorefrontHostResolverDeps {
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
        id: releaseId,
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
        artifactPrefix: PREFIX,
        manifestJson,
      }),
    },
  };
}

function r2(objects: Record<string, string> = {
  [`${PREFIX}/runtime/client/index.html`]: HOME_HTML,
  [`${PREFIX}/runtime/client/about/index.html`]: ABOUT_HTML,
  [`${PREFIX}/runtime/client/landing/index.html`]: LANDING_HTML,
  [`${PREFIX}/runtime/client/assets/app.js`]: "export {};",
}) {
  return {
    get: vi.fn(async (key: string) => {
      const body = objects[key];
      if (body === undefined) return null;
      return {
        body: null,
        httpEtag: '"r2-etag"',
        httpMetadata: {},
        arrayBuffer: async () => new TextEncoder().encode(body).buffer,
      };
    }),
  } as any;
}

function runtime() {
  return {
    kind: "local-direct",
    handle: vi.fn(async () => ({
      success: true as const,
      response: new Response("rendered by the Theme Worker", {
        headers: { "content-type": "text/html" },
      }),
    })),
  } as unknown as ThemeRuntime & { handle: ReturnType<typeof vi.fn> };
}

function service(options: {
  manifestJson?: unknown;
  bucket?: ReturnType<typeof r2>;
  theme?: ReturnType<typeof runtime>;
  releaseId?: string;
} = {}) {
  const theme = options.theme ?? runtime();
  const bucket = options.bucket ?? r2();
  return {
    theme,
    bucket,
    service: new StorefrontProductionService({
      runtime: theme,
      r2Bucket: bucket,
      resolverDeps: resolverDeps(options.manifestJson ?? manifest(), options.releaseId),
    }),
  };
}

const req = (path: string, init?: RequestInit) =>
  new Request(`https://${HOST}${path}`, init);

describe("registered static pages on the production storefront", () => {
  it("serves the registered page's HTML from the active release's artifact, with release-bound caching", async () => {
    const { service: core, theme, bucket } = service();
    const response = await core.handleRequest(req("/"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(HOME_HTML);
    expect(response.headers.get("content-type")).toMatch(/^text\/html/);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(response.headers.get("etag")).toBe(`"ssg:rel_1:${sha(HOME_HTML)}"`);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(bucket.get).toHaveBeenCalledWith(`${PREFIX}/runtime/client/index.html`);
    expect(theme.handle).not.toHaveBeenCalled();
  });

  it("answers 304 only to the ETag of this release's bytes", async () => {
    const { service: core } = service();
    const etag = `"ssg:rel_1:${sha(HOME_HTML)}"`;
    const fresh = await core.handleRequest(req("/", { headers: { "if-none-match": etag } }));
    expect(fresh.status).toBe(304);
    expect(fresh.headers.get("etag")).toBe(etag);
    expect(fresh.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );

    // The same bytes under another release are another representation.
    const { service: other } = service({ releaseId: "rel_2" });
    const stale = await other.handleRequest(req("/", { headers: { "if-none-match": etag } }));
    expect(stale.status).toBe(200);
    expect(stale.headers.get("etag")).toBe(`"ssg:rel_2:${sha(HOME_HTML)}"`);
    expect(await stale.text()).toBe(HOME_HTML);
  });

  it.each(["/about", "/about/", "/about/index.html"])(
    "serves %s from the same registered page",
    async (path) => {
      const { service: core, theme } = service();
      const response = await core.handleRequest(req(path));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(ABOUT_HTML);
      expect(response.headers.get("etag")).toBe(`"ssg:rel_1:${sha(ABOUT_HTML)}"`);
      expect(theme.handle).not.toHaveBeenCalled();
    },
  );

  it("answers HEAD with the headers and no body", async () => {
    const { service: core } = service();
    const response = await core.handleRequest(req("/about", { method: "HEAD" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(`"ssg:rel_1:${sha(ABOUT_HTML)}"`);
    expect(await response.text()).toBe("");
  });

  it("fails a registered page whose HTML object is missing, never falling back to SSR", async () => {
    const theme = runtime();
    const { service: core } = service({
      theme,
      bucket: r2({ [`${PREFIX}/runtime/client/assets/app.js`]: "export {};" }),
    });
    const response = await core.handleRequest(req("/about"));
    expect(response.status).toBe(503);
    expect(await response.text()).toMatch(/^SSG_ARTIFACT_UNAVAILABLE/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(theme.handle).not.toHaveBeenCalled();
  });

  it("fails every page of a release whose registration is malformed, never falling back to SSR", async () => {
    const theme = runtime();
    const { service: core } = service({
      theme,
      manifestJson: manifest([
        {
          path: "/about",
          artifactPath: "runtime/client/about/index.html",
          sha256: sha("other bytes"),
        },
      ]),
    });
    for (const path of ["/about", "/account"]) {
      const response = await core.handleRequest(req(path));
      expect(response.status).toBe(503);
      expect(await response.text()).toMatch(/^SSG_ARTIFACT_UNAVAILABLE/);
    }
    expect(theme.handle).not.toHaveBeenCalled();
  });

  it("fails a registered page when no artifact bucket is configured", async () => {
    const theme = runtime();
    const core = new StorefrontProductionService({
      runtime: theme,
      resolverDeps: resolverDeps(manifest()),
    });
    const response = await core.handleRequest(req("/"));
    expect(response.status).toBe(503);
    expect(theme.handle).not.toHaveBeenCalled();
  });

  it("leaves unregistered pages and non-read methods to the Theme Worker", async () => {
    const { service: core, theme } = service();
    expect(await (await core.handleRequest(req("/account"))).text()).toBe(
      "rendered by the Theme Worker",
    );
    expect(
      await (await core.handleRequest(req("/about", { method: "POST", body: "x" }))).text(),
    ).toBe("rendered by the Theme Worker");
    expect(theme.handle).toHaveBeenCalledTimes(2);
  });

  it("still serves declared client assets through the generic entry", async () => {
    const { service: core, theme } = service();
    const response = await core.handleRequest(req("/assets/app.js"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("export {};");
    expect(theme.handle).not.toHaveBeenCalled();
  });
});

describe("the generic asset entry and prerendered HTML", () => {
  it.each([
    ["an unregistered page's", "/landing/index.html"],
    ["the root", "/index.html"],
  ])("does not serve %s index.html directly", async (_, path) => {
    const { service: core, theme, bucket } = service({ manifestJson: manifest(null) });
    const response = await core.handleRequest(req(path));
    expect(await response.text()).toBe("rendered by the Theme Worker");
    expect(theme.handle).toHaveBeenCalledTimes(1);
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("does not serve a registered page's index.html outside the release dispatch", async () => {
    // A release without registrations: the same file is just a build output,
    // and the generic entry must not turn it into a public page.
    const { service: core, bucket } = service({ manifestJson: manifest(null) });
    await core.handleRequest(req("/about/index.html"));
    expect(bucket.get).not.toHaveBeenCalled();
  });
});
