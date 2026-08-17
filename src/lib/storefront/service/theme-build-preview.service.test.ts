import { describe, expect, it, vi } from "vitest";
import type { R2BucketLike } from "../compiler/cloudflare-r2-theme-build-artifact-store";
import type {
  CanonicalThemeBuildManifest,
} from "../compiler/theme-build-artifact-store.types";
import type { StorefrontThemeBuildDAL } from "../dal/storefront-theme-build.dal";
import type { StorefrontThemeBuildDTO } from "../dto/storefront-theme-build.dto";
import {
  generatePreviewCapabilityToken,
  verifyPreviewCapabilityToken,
} from "./theme-build-preview-token";
import {
  sanitizePreviewArtifactPath,
  ThemeBuildPreviewService,
} from "./theme-build-preview.service";

describe("ThemeBuildPreviewService (Phase 4B-7)", () => {
  const TEST_SECRET = "test-hmac-preview-secret-key-32-chars-long";

  const createMockR2 = () => {
    const storage = new Map<
      string,
      {
        body: ArrayBuffer;
        httpMetadata?: { contentType?: string };
        customMetadata?: Record<string, string>;
        httpEtag: string;
      }
    >();

    const r2Bucket: R2BucketLike = {
      get: vi.fn(async (key: string) => {
        const item = storage.get(key);
        if (!item) return null;
        return {
          body: null,
          async arrayBuffer() {
            return item.body;
          },
          async text() {
            return new TextDecoder().decode(item.body);
          },
          httpEtag: item.httpEtag,
          httpMetadata: item.httpMetadata,
          customMetadata: item.customMetadata,
          size: item.body.byteLength,
        };
      }),
      head: vi.fn(async (key: string) => {
        const item = storage.get(key);
        if (!item) return null;
        return {
          httpEtag: item.httpEtag,
          httpMetadata: item.httpMetadata,
          customMetadata: item.customMetadata,
          size: item.body.byteLength,
        };
      }),
      put: vi.fn(async (key: string, value: any, options: any) => {
        let buffer: ArrayBuffer;
        if (typeof value === "string") {
          const enc = new TextEncoder().encode(value);
          buffer = enc.buffer.slice(
            enc.byteOffset,
            enc.byteOffset + enc.byteLength,
          ) as ArrayBuffer;
        } else if (value instanceof Uint8Array) {
          buffer = value.buffer.slice(
            value.byteOffset,
            value.byteOffset + value.byteLength,
          ) as ArrayBuffer;
        } else {
          buffer = new ArrayBuffer(0);
        }
        const httpEtag = `etag-${key}`;
        storage.set(key, {
          body: buffer,
          httpMetadata: options?.httpMetadata,
          customMetadata: options?.customMetadata,
          httpEtag,
        });
        return { key, size: buffer.byteLength, httpEtag };
      }),
      delete: vi.fn(async () => {}),
    };

    return { r2Bucket, storage };
  };

  const createDummyManifest = (): CanonicalThemeBuildManifest => ({
    buildId: "build-1",
    storefrontId: "store-1",
    themeId: "theme-1",
    sourceRevisionId: "rev-1",
    revisionNumber: 1,
    inputHash: "a".repeat(64),
    compilerId: "tailwind-v4-build",
    compilerVersion: "4.1.17",
    sourceEntry: "src/index.tsx",
    entry: "src/index.tsx",
    artifactEntry: "index.html",
    filesCount: 4,
    totalSizeBytes: 1024,
    files: [
      {
        path: "index.html",
        contentType: "text/html; charset=utf-8",
        sizeBytes: 200,
        sha256: "hash-html",
        r2Etag: "etag-html",
      },
      {
        path: "assets/index-abc.js",
        contentType: "application/javascript; charset=utf-8",
        sizeBytes: 500,
        sha256: "hash-js",
        r2Etag: "etag-js",
      },
      {
        path: "assets/index-abc.css",
        contentType: "text/css; charset=utf-8",
        sizeBytes: 300,
        sha256: "hash-css",
        r2Etag: "etag-css",
      },
      {
        path: "assets/logo.png",
        contentType: "image/png",
        sizeBytes: 24,
        sha256: "hash-png",
        r2Etag: "etag-png",
      },
    ],
    cssChunks: ["assets/index-abc.css"],
    jsChunks: ["assets/index-abc.js"],
    createdAt: "2026-08-17T00:00:00.000Z",
  });

  const createDummyBuild = (
    overrides?: Partial<StorefrontThemeBuildDTO>,
  ): StorefrontThemeBuildDTO => ({
    id: "build-1",
    storefrontId: "store-1",
    themeId: "theme-1",
    sourceRevisionId: "rev-1",
    status: "succeeded",
    inputHash: "a".repeat(64),
    compilerId: "tailwind-v4-build",
    compilerVersion: "4.1.17",
    artifactPrefix: "storefronts/store-1/themes/theme-1/builds/build-1",
    manifestJson: createDummyManifest(),
    diagnosticsJson: null,
    errorMessage: null,
    startedAt: "2026-08-17T00:00:00.000Z",
    completedAt: "2026-08-17T00:00:05.000Z",
    createdBy: "admin",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:05.000Z",
    ...overrides,
  });

  const createMockDAL = (
    build: StorefrontThemeBuildDTO | null = createDummyBuild(),
    isOwner: boolean = true,
  ): StorefrontThemeBuildDAL =>
    ({
      getBuildById: vi.fn(async () => build),
      getBuild: vi.fn(async () => build),
      verifyThemeOwnership: vi.fn(async () => isOwner),
    }) as unknown as StorefrontThemeBuildDAL;

  const validAdminSessionResolver = async () => ({
    user: { id: "admin-1", role: "admin" },
  });

  describe("Path Sanitization & Security", () => {
    it("canonicalizes valid paths", () => {
      expect(sanitizePreviewArtifactPath("")).toBe("");
      expect(sanitizePreviewArtifactPath("/")).toBe("");
      expect(sanitizePreviewArtifactPath("index.html")).toBe("index.html");
      expect(sanitizePreviewArtifactPath("/assets/index.js")).toBe(
        "assets/index.js",
      );
      expect(sanitizePreviewArtifactPath("assets/nested/file.css/")).toBe(
        "assets/nested/file.css",
      );
    });

    it("rejects path traversal and malicious characters", () => {
      const malicious = [
        "../secret.txt",
        "assets/../../secret.txt",
        "assets\\evil.js",
        "assets/..\\evil.js",
        "%2e%2e/secret.js",
        "%2E%2E%2Fsecret.js",
        "%252e%252e/secret.js",
        "assets/\0null.js",
        "assets/%00null.js",
        "assets/%5cevil.js",
      ];

      for (const p of malicious) {
        expect(() => sanitizePreviewArtifactPath(p)).toThrow();
      }
    });
  });

  describe("Ephemeral Preview Capability Token Security (Opaque Sandbox Fetch)", () => {
    it("generates and verifies capability tokens bound to buildId and expiration", async () => {
      const token = await generatePreviewCapabilityToken(
        {
          buildId: "build-1",
          storefrontId: "store-1",
          themeId: "theme-1",
        },
        TEST_SECRET,
      );

      expect(token).toBeDefined();
      const verified = await verifyPreviewCapabilityToken(
        token,
        TEST_SECRET,
        "build-1",
      );
      expect(verified.valid).toBe(true);
      expect(verified.payload?.buildId).toBe("build-1");
      expect(verified.payload?.storefrontId).toBe("store-1");
    });

    it("rejects capability token when used for a different build ID (cross-build protection)", async () => {
      const token = await generatePreviewCapabilityToken(
        {
          buildId: "build-1",
          storefrontId: "store-1",
          themeId: "theme-1",
        },
        TEST_SECRET,
      );

      const verified = await verifyPreviewCapabilityToken(
        token,
        TEST_SECRET,
        "build-2", // Attempting to use build-1 token for build-2
      );
      expect(verified.valid).toBe(false);
      expect(verified.error).toContain("cannot access");
    });

    it("rejects tampered or forged capability tokens", async () => {
      const token = await generatePreviewCapabilityToken(
        {
          buildId: "build-1",
          storefrontId: "store-1",
          themeId: "theme-1",
        },
        TEST_SECRET,
      );

      const tampered = token + "forged";
      const verified = await verifyPreviewCapabilityToken(
        tampered,
        TEST_SECRET,
        "build-1",
      );
      expect(verified.valid).toBe(false);
    });

    it("rejects expired capability tokens", async () => {
      const expiredToken = await generatePreviewCapabilityToken(
        {
          buildId: "build-1",
          storefrontId: "store-1",
          themeId: "theme-1",
          ttlMs: -1000, // Expired in the past
        },
        TEST_SECRET,
      );

      const verified = await verifyPreviewCapabilityToken(
        expiredToken,
        TEST_SECRET,
        "build-1",
      );
      expect(verified.valid).toBe(false);
      expect(verified.error).toContain("expired");
    });

    it("serves HTML entry and sub-resources under opaque sandbox without session cookies when valid token is present", async () => {
      const { r2Bucket, storage } = createMockR2();
      const prefix = "storefronts/store-1/themes/theme-1/builds/build-1";
      storage.set(`${prefix}/index.html`, {
        body: new TextEncoder().encode("<html>Sandbox Theme</html>").buffer,
        httpEtag: "etag-html",
      });
      storage.set(`${prefix}/assets/index-abc.js`, {
        body: new TextEncoder().encode("console.log('opaque asset');").buffer,
        httpEtag: "etag-js",
      });

      const token = await generatePreviewCapabilityToken(
        {
          buildId: "build-1",
          storefrontId: "store-1",
          themeId: "theme-1",
        },
        TEST_SECRET,
      );

      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal: createMockDAL(),
        tokenSecret: TEST_SECRET,
        // Zero session provided (simulating opaque origin sub-resource fetch)
        sessionResolver: async () => null,
      });

      // 1. Entry HTML fetch with capability token in path and Origin: null
      const htmlRes = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/token/", {
          headers: { origin: "null" },
        }),
        { buildId: "build-1", token, artifactPath: "" },
      );
      expect(htmlRes.status).toBe(200);
      expect(await htmlRes.text()).toContain("Sandbox Theme");
      expect(htmlRes.headers.get("Access-Control-Allow-Origin")).toBe("null");
      expect(htmlRes.headers.get("Cross-Origin-Resource-Policy")).toBe(
        "cross-origin",
      );
      // Verify Document-level CSP sandbox enforcement (guarantees opaque origin even when opened directly in a new tab)
      const csp = htmlRes.headers.get("Content-Security-Policy");
      expect(csp).toContain("sandbox allow-scripts;");
      expect(csp).not.toContain("allow-same-origin");

      // 2. Relative JS module graph sub-resource fetch with Origin: null
      const jsRes = await service.handlePreviewRequest(
        new Request(
          "https://example.com/preview-build/build-1/token/assets/index-abc.js",
          { headers: { origin: "null" } },
        ),
        { buildId: "build-1", token, artifactPath: "assets/index-abc.js" },
      );
      expect(jsRes.status).toBe(200);
      expect(await jsRes.text()).toBe("console.log('opaque asset');");
      expect(jsRes.headers.get("Access-Control-Allow-Origin")).toBe("null");
      expect(jsRes.headers.get("Cross-Origin-Resource-Policy")).toBe(
        "cross-origin",
      );
    });

    it("enforces CSP sandbox allow-scripts on direct top-level preview HTML navigation (prevents same-origin privilege escape)", async () => {
      const { r2Bucket, storage } = createMockR2();
      const prefix = "storefronts/store-1/themes/theme-1/builds/build-1";
      storage.set(`${prefix}/index.html`, {
        body: new TextEncoder().encode("<html>Direct Tab Theme</html>").buffer,
        httpEtag: "etag-html",
      });

      const token = await generatePreviewCapabilityToken(
        {
          buildId: "build-1",
          storefrontId: "store-1",
          themeId: "theme-1",
        },
        TEST_SECRET,
      );

      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal: createMockDAL(),
        tokenSecret: TEST_SECRET,
      });

      // User opens preview URL directly in browser tab
      const res = await service.handlePreviewRequest(
        new Request("https://morph.example/preview-build/build-1/token/"),
        { buildId: "build-1", token, artifactPath: "" },
      );

      expect(res.status).toBe(200);
      const csp = res.headers.get("Content-Security-Policy");
      expect(csp).toContain("sandbox allow-scripts;");
      expect(csp).not.toContain("allow-same-origin");
      expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    });


    it("supports CORS preflight OPTIONS request for opaque sandbox", async () => {
      const { r2Bucket } = createMockR2();
      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal: createMockDAL(),
        tokenSecret: TEST_SECRET,
      });

      const optionsRes = await service.handlePreviewRequest(
        new Request(
          "https://example.com/preview-build/build-1/token/assets/index-abc.js",
          {
            method: "OPTIONS",
            headers: {
              origin: "null",
              "access-control-request-method": "GET",
            },
          },
        ),
        { buildId: "build-1", token: "tok", artifactPath: "assets/index-abc.js" },
      );

      expect(optionsRes.status).toBe(204);
      expect(optionsRes.headers.get("Access-Control-Allow-Origin")).toBe("null");
      expect(optionsRes.headers.get("Access-Control-Allow-Methods")).toContain(
        "GET",
      );

    });

    it("fails closed with 500 when secret key is missing (zero hardcoded fallback secrets)", async () => {
      const { r2Bucket } = createMockR2();
      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal: createMockDAL(),
        // No secret passed, environment has no secret
      });

      const res = await service.handlePreviewRequest(
        new Request(
          "https://example.com/preview-build/build-1/token/assets/x.js",
        ),
        { buildId: "build-1", token: "some-token", artifactPath: "assets/x.js" },
      );

      expect(res.status).toBe(500);
      expect(await res.text()).toContain("Server Configuration Error");
    });

    it("returns 401 when capability token is invalid or expired", async () => {
      const { r2Bucket } = createMockR2();
      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal: createMockDAL(),
        tokenSecret: TEST_SECRET,
        sessionResolver: async () => null,
      });

      const res = await service.handlePreviewRequest(
        new Request(
          "https://example.com/preview-build/build-1/bad-token/assets/x.js",
        ),
        { buildId: "build-1", token: "bad-token", artifactPath: "assets/x.js" },
      );
      expect(res.status).toBe(401);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });
  });


  describe("Direct Session Authentication & Authorization (Admin-Only Model)", () => {
    it("returns 401 when request has neither capability token nor valid session", async () => {
      const { r2Bucket } = createMockR2();
      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal: createMockDAL(),
        sessionResolver: async () => null,
      });

      const res = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/"),
        { buildId: "build-1" },
      );

      expect(res.status).toBe(401);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("returns 403 when session user is non-admin user role", async () => {
      const { r2Bucket } = createMockR2();
      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal: createMockDAL(),
        sessionResolver: async () => ({
          user: { id: "user-1", role: "user" },
        }),
      });

      const res = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/"),
        { buildId: "build-1" },
      );

      expect(res.status).toBe(403);
      expect(await res.text()).toContain("Administrator access is required");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("returns 403 when session user has guest role", async () => {
      const { r2Bucket } = createMockR2();
      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal: createMockDAL(),
        sessionResolver: async () => ({ user: { id: "u1", role: "guest" } }),
      });

      const res = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/"),
        { buildId: "build-1" },
      );

      expect(res.status).toBe(403);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("allows admin user with direct session to preview build", async () => {
      const { r2Bucket, storage } = createMockR2();
      const prefix = "storefronts/store-1/themes/theme-1/builds/build-1";
      storage.set(`${prefix}/index.html`, {
        body: new TextEncoder().encode("<html>Admin Preview</html>").buffer,
        httpEtag: "etag-html",
      });

      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal: createMockDAL(),
        sessionResolver: validAdminSessionResolver,
      });

      const res = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/"),
        { buildId: "build-1" },
      );

      expect(res.status).toBe(200);
      expect(await res.text()).toContain("Admin Preview");
    });

    it("returns 403 when theme ownership verification fails (theme does not belong to storefront)", async () => {
      const { r2Bucket } = createMockR2();
      const dal = createMockDAL(createDummyBuild(), false); // Ownership check returns false
      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal,
        sessionResolver: validAdminSessionResolver,
      });

      const res = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/"),
        { buildId: "build-1" },
      );

      expect(res.status).toBe(403);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });
  });

  describe("Authoritative Succeeded Build State & Manifest Boundaries", () => {
    it("returns 404 when build does not exist", async () => {
      const { r2Bucket } = createMockR2();
      const dal = createMockDAL(null);
      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal,
        sessionResolver: validAdminSessionResolver,
      });

      const res = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/non-existent/"),
        { buildId: "non-existent" },
      );

      expect(res.status).toBe(404);
    });

    it("returns 409 when build is queued or building", async () => {
      const { r2Bucket } = createMockR2();
      const dal = createMockDAL(createDummyBuild({ status: "building" }));
      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal,
        sessionResolver: validAdminSessionResolver,
      });

      const res = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/"),
        { buildId: "build-1" },
      );

      expect(res.status).toBe(409);
    });

    it("returns 422 when build is failed", async () => {
      const { r2Bucket } = createMockR2();
      const dal = createMockDAL(
        createDummyBuild({
          status: "failed",
          errorMessage: "Vite syntax error",
        }),
      );
      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal,
        sessionResolver: validAdminSessionResolver,
      });

      const res = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/"),
        { buildId: "build-1" },
      );

      expect(res.status).toBe(422);
      expect(await res.text()).toContain("Vite syntax error");
    });

    it("fails closed (404) when artifactPrefix or manifestJson is missing", async () => {
      const { r2Bucket } = createMockR2();
      const dal = createMockDAL(createDummyBuild({ artifactPrefix: null }));
      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal,
        sessionResolver: validAdminSessionResolver,
      });

      const res = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/"),
        { buildId: "build-1" },
      );

      expect(res.status).toBe(404);
    });

    it("strictly rejects R2 orphan objects not listed in canonical manifest", async () => {
      const { r2Bucket, storage } = createMockR2();
      const prefix = "storefronts/store-1/themes/theme-1/builds/build-1";

      storage.set(`${prefix}/secret-orphan.js`, {
        body: new TextEncoder().encode("secret orphan").buffer,
        httpEtag: "etag-orphan",
      });

      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal: createMockDAL(),
        sessionResolver: validAdminSessionResolver,
      });

      const res = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/secret-orphan.js"),
        { buildId: "build-1", artifactPath: "secret-orphan.js" },
      );

      expect(res.status).toBe(404);
      expect(await res.text()).toContain("not part of build");
    });

    it("handles 304 Not Modified when If-None-Match matches ETag", async () => {
      const { r2Bucket, storage } = createMockR2();
      const prefix = "storefronts/store-1/themes/theme-1/builds/build-1";

      storage.set(`${prefix}/assets/index-abc.js`, {
        body: new TextEncoder().encode("console.log('js');").buffer,
        httpEtag: "etag-js",
      });

      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal: createMockDAL(),
        sessionResolver: validAdminSessionResolver,
      });

      const res = await service.handlePreviewRequest(
        new Request(
          "https://example.com/preview-build/build-1/assets/index-abc.js",
          {
            headers: { "if-none-match": "etag-js" },
          },
        ),
        { buildId: "build-1", artifactPath: "assets/index-abc.js" },
      );

      expect(res.status).toBe(304);
    });

    it("strictly rejects entry point if not listed in canonical manifest.files (absolute fail-closed boundary)", async () => {

      const { r2Bucket, storage } = createMockR2();
      const prefix = "storefronts/store-1/themes/theme-1/builds/build-1";
      storage.set(`${prefix}/index.html`, {
        body: new TextEncoder().encode("<html>Unlisted Entry</html>").buffer,
        httpEtag: "etag-html",
      });

      const manifestWithoutEntry = {
        ...createDummyManifest(),
        files: [
          {
            path: "assets/index-abc.js",
            contentType: "application/javascript; charset=utf-8",
            sizeBytes: 500,
            sha256: "hash-js",
            r2Etag: "etag-js",
          },
        ],
      };

      const dal = createMockDAL(
        createDummyBuild({ manifestJson: manifestWithoutEntry }),
      );

      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal,
        sessionResolver: validAdminSessionResolver,
      });

      const res = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/"),
        { buildId: "build-1", artifactPath: "" },
      );

      expect(res.status).toBe(404);
      expect(await res.text()).toContain("not part of build");
    });
  });

  describe("Build Immutability & Scope Isolation", () => {

    it("ensures Build B1 URL strictly serves B1 artifacts and Build B2 serves B2 artifacts", async () => {
      const { r2Bucket, storage } = createMockR2();
      const prefixB1 = "storefronts/store-1/themes/theme-1/builds/build-1";
      const prefixB2 = "storefronts/store-1/themes/theme-1/builds/build-2";

      const enc = new TextEncoder();
      storage.set(`${prefixB1}/index.html`, {
        body: enc.encode("<html><body>Build 1 Content</body></html>").buffer,
        httpEtag: "etag-b1",
      });
      storage.set(`${prefixB2}/index.html`, {
        body: enc.encode("<html><body>Build 2 Content</body></html>").buffer,
        httpEtag: "etag-b2",
      });

      const manifestB1 = createDummyManifest();
      const manifestB2 = { ...createDummyManifest(), buildId: "build-2" };

      const buildB1 = createDummyBuild({
        id: "build-1",
        artifactPrefix: prefixB1,
        manifestJson: manifestB1,
      });
      const buildB2 = createDummyBuild({
        id: "build-2",
        artifactPrefix: prefixB2,
        manifestJson: manifestB2,
      });

      const dal: StorefrontThemeBuildDAL = {
        getBuildById: vi.fn(async (id: string) => {
          if (id === "build-1") return buildB1;
          if (id === "build-2") return buildB2;
          return null;
        }),
        verifyThemeOwnership: vi.fn(async () => true),
      } as unknown as StorefrontThemeBuildDAL;

      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal,
        sessionResolver: validAdminSessionResolver,
      });

      const res1 = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/"),
        { buildId: "build-1" },
      );
      expect(await res1.text()).toContain("Build 1 Content");

      const res2 = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-2/"),
        { buildId: "build-2" },
      );
      expect(await res2.text()).toContain("Build 2 Content");
    });
  });
});
