import { describe, expect, it, vi } from "vitest";
import type { R2BucketLike } from "../compiler/cloudflare-r2-theme-build-artifact-store";
import type {
  CanonicalThemeBuildManifest,
} from "../compiler/theme-build-artifact-store.types";
import type { StorefrontThemeBuildDAL } from "../dal/storefront-theme-build.dal";
import type { StorefrontThemeBuildDTO } from "../dto/storefront-theme-build.dto";
import {
  sanitizePreviewArtifactPath,
  ThemeBuildPreviewService,
} from "./theme-build-preview.service";

describe("ThemeBuildPreviewService (Phase 4B-7)", () => {
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

  const validSessionResolver = async () => ({
    user: { id: "user-1", role: "admin" },
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

  describe("Authentication & Authorization", () => {
    it("returns 401 when request is unauthenticated", async () => {
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

    it("returns 403 when user lacks admin/user role", async () => {
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

    it("returns 403 when user does not have access to the target storefront (cross-tenant attack)", async () => {
      const { r2Bucket } = createMockR2();
      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal: createMockDAL(),
        sessionResolver: async () => ({ user: { id: "user-attacker", role: "user" } }),
        storefrontAccessChecker: async (_userId, storefrontId) => {
          // Attacker only has access to store-other, NOT store-1
          return storefrontId === "store-other";
        },

      });

      const res = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/"),
        { buildId: "build-1" },
      );

      expect(res.status).toBe(403);
      expect(await res.text()).toContain("does not have access to this storefront");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("allows admin user to access any storefront preview build", async () => {
      const { r2Bucket, storage } = createMockR2();
      const prefix = "storefronts/store-1/themes/theme-1/builds/build-1";
      storage.set(`${prefix}/index.html`, {
        body: new TextEncoder().encode("<html>Admin Preview</html>").buffer,
        httpEtag: "etag-html",
      });

      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal: createMockDAL(),
        sessionResolver: async () => ({ user: { id: "admin-user", role: "admin" } }),
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
        sessionResolver: validSessionResolver,
      });

      const res = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/"),
        { buildId: "build-1" },
      );

      expect(res.status).toBe(403);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });


    it("enforces full authorization check on individual asset requests", async () => {
      const { r2Bucket } = createMockR2();
      const dal = createMockDAL(createDummyBuild(), false);
      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal,
        sessionResolver: validSessionResolver,
      });

      const res = await service.handlePreviewRequest(
        new Request(
          "https://example.com/preview-build/build-1/assets/index-abc.js",
        ),
        { buildId: "build-1", artifactPath: "assets/index-abc.js" },
      );

      expect(res.status).toBe(403);
    });
  });

  describe("Authoritative Succeeded Build State", () => {
    it("returns 404 when build does not exist", async () => {
      const { r2Bucket } = createMockR2();
      const dal = createMockDAL(null);
      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal,
        sessionResolver: validSessionResolver,
      });

      const res = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/non-existent/"),
        { buildId: "non-existent" },
      );

      expect(res.status).toBe(404);
    });

    it("returns 409 when build is queued", async () => {
      const { r2Bucket } = createMockR2();
      const dal = createMockDAL(createDummyBuild({ status: "queued" }));
      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal,
        sessionResolver: validSessionResolver,
      });

      const res = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/"),
        { buildId: "build-1" },
      );

      expect(res.status).toBe(409);
      expect(await res.text()).toContain("in progress");
    });

    it("returns 409 when build is building", async () => {
      const { r2Bucket } = createMockR2();
      const dal = createMockDAL(createDummyBuild({ status: "building" }));
      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal,
        sessionResolver: validSessionResolver,
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
        sessionResolver: validSessionResolver,
      });

      const res = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/"),
        { buildId: "build-1" },
      );

      expect(res.status).toBe(422);
      expect(await res.text()).toContain("Vite syntax error");
    });

    it("fails closed (404) when artifactPrefix or manifestJson is missing on succeeded build", async () => {
      const { r2Bucket } = createMockR2();
      const dal = createMockDAL(createDummyBuild({ artifactPrefix: null }));
      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal,
        sessionResolver: validSessionResolver,
      });

      const res = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/"),
        { buildId: "build-1" },
      );

      expect(res.status).toBe(404);
    });
  });

  describe("Canonical Manifest Serving Boundary", () => {
    it("serves HTML entry, JS, CSS, and binary assets from R2 for succeeded build", async () => {
      const { r2Bucket, storage } = createMockR2();
      const prefix = "storefronts/store-1/themes/theme-1/builds/build-1";

      // Seed R2 objects
      const encoder = new TextEncoder();
      storage.set(`${prefix}/index.html`, {
        body: encoder.encode("<!DOCTYPE html><html><body><h1>Theme</h1></body></html>").buffer,
        httpEtag: "etag-html",
      });
      storage.set(`${prefix}/assets/index-abc.js`, {
        body: encoder.encode("console.log('loaded');").buffer,
        httpEtag: "etag-js",
      });
      storage.set(`${prefix}/assets/index-abc.css`, {
        body: encoder.encode("body { margin: 0; }").buffer,
        httpEtag: "etag-css",
      });
      storage.set(`${prefix}/assets/logo.png`, {
        body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
        httpEtag: "etag-png",
      });

      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal: createMockDAL(),
        sessionResolver: validSessionResolver,
      });

      // 1. Entry HTML request
      const htmlRes = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/"),
        { buildId: "build-1" },
      );
      expect(htmlRes.status).toBe(200);
      expect(htmlRes.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
      expect(htmlRes.headers.get("Cache-Control")).toBe("private, no-store");
      expect(htmlRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(htmlRes.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self'");
      expect(await htmlRes.text()).toContain("<h1>Theme</h1>");

      // 2. JS Asset request
      const jsRes = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/assets/index-abc.js"),
        { buildId: "build-1", artifactPath: "assets/index-abc.js" },
      );
      expect(jsRes.status).toBe(200);
      expect(jsRes.headers.get("Content-Type")).toBe("application/javascript; charset=utf-8");
      expect(jsRes.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
      expect(await jsRes.text()).toBe("console.log('loaded');");

      // 3. CSS Asset request
      const cssRes = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/assets/index-abc.css"),
        { buildId: "build-1", artifactPath: "assets/index-abc.css" },
      );
      expect(cssRes.status).toBe(200);
      expect(cssRes.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
      expect(cssRes.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");

      // 4. Binary PNG Asset request
      const pngRes = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/assets/logo.png"),
        { buildId: "build-1", artifactPath: "assets/logo.png" },
      );
      expect(pngRes.status).toBe(200);
      expect(pngRes.headers.get("Content-Type")).toBe("image/png");
      const pngBuffer = await pngRes.arrayBuffer();
      expect(new Uint8Array(pngBuffer)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    });

    it("strictly rejects R2 orphan objects not listed in canonical manifest", async () => {
      const { r2Bucket, storage } = createMockR2();
      const prefix = "storefronts/store-1/themes/theme-1/builds/build-1";

      // Seed an unlisted / orphan file in R2
      storage.set(`${prefix}/secret-orphan.js`, {
        body: new TextEncoder().encode("secret orphan").buffer,
        httpEtag: "etag-orphan",
      });

      const service = new ThemeBuildPreviewService({
        r2Bucket,
        dal: createMockDAL(),
        sessionResolver: validSessionResolver,
      });

      const res = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/secret-orphan.js"),
        { buildId: "build-1", artifactPath: "secret-orphan.js" },
      );

      // Must be 404 because not in manifest.files!
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
        sessionResolver: validSessionResolver,
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
        sessionResolver: validSessionResolver,
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

      // Verify B1 still returns B1
      const res1Repeat = await service.handlePreviewRequest(
        new Request("https://example.com/preview-build/build-1/"),
        { buildId: "build-1" },
      );
      expect(await res1Repeat.text()).toContain("Build 1 Content");
    });
  });
});
