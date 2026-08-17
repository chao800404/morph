import { describe, expect, it, vi } from "vitest";
import type {
  StorefrontThemeBuildDTO,
  StorefrontThemeBuildInput,
} from "@/lib/storefront/dto/storefront-theme-build.dto";
import {
  calculateArtifactSha256,
  CloudflareR2ThemeBuildArtifactStore,
  type R2BucketLike,
  validateAndCanonicalizeArtifactPath,
} from "./cloudflare-r2-theme-build-artifact-store";
import type { ThemeBuildArtifactFile } from "./theme-build-runner.types";

describe("CloudflareR2ThemeBuildArtifactStore (Phase 4B-6)", () => {
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
        // True R2 conditional write: onlyIf etagDoesNotMatch "*" fails if key exists
        if (options?.onlyIf?.etagDoesNotMatch === "*" && storage.has(key)) {
          return null;
        }

        let buffer: ArrayBuffer;
        if (typeof value === "string") {
          const enc = new TextEncoder().encode(value);
          buffer = enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength) as ArrayBuffer;
        } else if (value instanceof Uint8Array) {
          buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
        } else if (value instanceof ArrayBuffer) {
          buffer = value;
        } else {
          buffer = new ArrayBuffer(0);
        }

        const httpEtag = `etag-${key.replace(/[^a-zA-Z0-9]/g, "")}-${buffer.byteLength}`;
        storage.set(key, {
          body: buffer,
          httpMetadata: options?.httpMetadata,
          customMetadata: options?.customMetadata,
          httpEtag,
        });

        return {
          key,
          size: buffer.byteLength,
          httpEtag,
          customMetadata: options?.customMetadata,
        };
      }),
      delete: vi.fn(async (key: string | string[]) => {
        if (Array.isArray(key)) {
          for (const k of key) storage.delete(k);
        } else {
          storage.delete(key);
        }
      }),
    };

    return { r2Bucket, storage };
  };

  const createDummyBuild = (overrides?: Partial<StorefrontThemeBuildDTO>): StorefrontThemeBuildDTO => ({
    id: "build-101",
    storefrontId: "store-1",
    themeId: "theme-1",
    sourceRevisionId: "rev-1",
    status: "building",
    inputHash: "hash-12345",
    compilerId: "tailwind-v4-build",
    compilerVersion: "4.1.17",
    artifactPrefix: null,
    manifestJson: null,
    diagnosticsJson: null,
    errorMessage: null,
    startedAt: "2026-08-17T00:00:00.000Z",
    completedAt: null,
    createdBy: "admin",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    ...overrides,
  });

  const createDummyBuildInput = (): StorefrontThemeBuildInput => ({
    buildId: "build-101",
    storefrontId: "store-1",
    themeId: "theme-1",
    sourceRevisionId: "rev-1",
    revisionNumber: 1,
    files: [{ path: "src/index.tsx", content: "export default () => 1;", isEntry: true }],
    entry: "src/index.tsx",
    inputHash: "hash-12345",
    compilerId: "tailwind-v4-build",
    compilerVersion: "4.1.17",
  });

  it("persists dist artifacts and commits canonical manifest to R2", async () => {
    const { r2Bucket, storage } = createMockR2();
    const store = new CloudflareR2ThemeBuildArtifactStore({ r2Bucket });

    const build = createDummyBuild();
    const buildInput = createDummyBuildInput();

    const artifacts: ThemeBuildArtifactFile[] = [
      {
        path: "index.html",
        content: "<!DOCTYPE html><html><body><h1>Hello</h1></body></html>",
        mimeType: "text/html",
      },
      {
        path: "assets/index.js",
        content: "console.log('app');",
        mimeType: "application/javascript",
      },
      {
        path: "assets/index.css",
        content: "body { margin: 0; }",
        mimeType: "text/css",
      },
      {
        path: "assets/logo.png",
        content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        mimeType: "image/png",
      },
    ];

    const result = await store.persistBuildArtifacts({
      build,
      buildInput,
      artifacts,
    });

    expect(result.artifactPrefix).toBe("storefronts/store-1/themes/theme-1/builds/build-101");
    expect(result.manifest.buildId).toBe("build-101");
    expect(result.manifest.storefrontId).toBe("store-1");
    expect(result.manifest.themeId).toBe("theme-1");
    expect(result.manifest.inputHash).toBe("hash-12345");
    expect(result.manifest.filesCount).toBe(4);
    expect(result.manifest.files).toHaveLength(4);
    expect(result.manifest.cssChunks).toEqual(["assets/index.css"]);
    expect(result.manifest.jsChunks).toEqual(["assets/index.js"]);
    expect(result.manifest.createdAt).toBe("2026-08-17T00:00:00.000Z");

    // Verify R2 objects
    const prefix = "storefronts/store-1/themes/theme-1/builds/build-101";
    expect(storage.has(`${prefix}/index.html`)).toBe(true);
    expect(storage.has(`${prefix}/assets/index.js`)).toBe(true);
    expect(storage.has(`${prefix}/assets/index.css`)).toBe(true);
    expect(storage.has(`${prefix}/assets/logo.png`)).toBe(true);
    expect(storage.has(`${prefix}/manifest.json`)).toBe(true);

    // Verify SHA-256 consistency in manifest
    const htmlEntry = result.manifest.files.find((f) => f.path === "index.html");
    expect(htmlEntry?.sha256).toBe(calculateArtifactSha256(artifacts[0].content));

    const pngEntry = result.manifest.files.find((f) => f.path === "assets/logo.png");
    expect(pngEntry?.sha256).toBe(calculateArtifactSha256(artifacts[3].content));
  });

  it("blocks path traversal in artifact paths with specific errors", () => {
    const invalidPaths = [
      "../secret.txt",
      "/index.html",
      "assets/../../secret.js",
      "assets\\index.js",
      "assets/..\\evil.js",
      "%2e%2e/secret.js",
      "manifest.json",
      "MANIFEST.JSON",
      "assets/\0null.js",
    ];

    for (const invalid of invalidPaths) {
      expect(() => validateAndCanonicalizeArtifactPath(invalid)).toThrow();
    }
  });

  it("enforces immutability: rejects overwriting existing artifact with different SHA-256 via conditional write", async () => {
    const { r2Bucket } = createMockR2();
    const store = new CloudflareR2ThemeBuildArtifactStore({ r2Bucket });

    const build = createDummyBuild();
    const buildInput = createDummyBuildInput();

    const artifacts1: ThemeBuildArtifactFile[] = [
      { path: "index.html", content: "version 1", mimeType: "text/html" },
    ];

    await store.persistBuildArtifacts({
      build,
      buildInput,
      artifacts: artifacts1,
    });

    const artifacts2: ThemeBuildArtifactFile[] = [
      { path: "index.html", content: "version 2 with DIFFERENT bytes", mimeType: "text/html" },
    ];

    await expect(
      store.persistBuildArtifacts({
        build,
        buildInput,
        artifacts: artifacts2,
      }),
    ).rejects.toThrow(/IMMUTABLE_ARTIFACT_OVERWRITE_FORBIDDEN/);
  });

  it("allows idempotent retry when artifact SHA-256 is identical via conditional write collision", async () => {
    const { r2Bucket } = createMockR2();
    const store = new CloudflareR2ThemeBuildArtifactStore({ r2Bucket });

    const build = createDummyBuild();
    const buildInput = createDummyBuildInput();

    const artifacts: ThemeBuildArtifactFile[] = [
      { path: "index.html", content: "deterministic content", mimeType: "text/html" },
    ];

    const result1 = await store.persistBuildArtifacts({
      build,
      buildInput,
      artifacts,
    });

    // Second call with identical content (triggers onlyIf precondition failure, then verifies identical SHA-256)
    const result2 = await store.persistBuildArtifacts({
      build,
      buildInput,
      artifacts,
    });

    expect(result1.manifest.files[0].sha256).toBe(result2.manifest.files[0].sha256);
    expect(result1.manifest.createdAt).toBe(result2.manifest.createdAt);
  });

  it("verifies full content bytes when existing R2 object has no customMetadata.sha256", async () => {
    const { r2Bucket, storage } = createMockR2();
    const store = new CloudflareR2ThemeBuildArtifactStore({ r2Bucket });

    const build = createDummyBuild();
    const buildInput = createDummyBuildInput();

    const key = "storefronts/store-1/themes/theme-1/builds/build-101/index.html";
    const existingBytes = new TextEncoder().encode("pre-existing content without metadata");
    storage.set(key, {
      body: existingBytes.buffer,
      httpMetadata: { contentType: "text/html" },
      customMetadata: undefined, // Missing sha256!
      httpEtag: "pre-existing-etag",
    });

    // Attempt to write DIFFERENT content -> MUST download and reject
    await expect(
      store.persistBuildArtifacts({
        build,
        buildInput,
        artifacts: [{ path: "index.html", content: "different incoming content", mimeType: "text/html" }],
      }),
    ).rejects.toThrow(/IMMUTABLE_ARTIFACT_OVERWRITE_FORBIDDEN/);

    // Attempt to write IDENTICAL content -> MUST download, verify matching hash, and accept idempotently
    const result = await store.persistBuildArtifacts({
      build,
      buildInput,
      artifacts: [{ path: "index.html", content: "pre-existing content without metadata", mimeType: "text/html" }],
    });

    expect(result.manifest.files[0].sha256).toBe(calculateArtifactSha256(existingBytes));
  });

  it("rejects when runner declares a mismatched sizeBytes", async () => {
    const { r2Bucket } = createMockR2();
    const store = new CloudflareR2ThemeBuildArtifactStore({ r2Bucket });

    const build = createDummyBuild();
    const buildInput = createDummyBuildInput();

    await expect(
      store.persistBuildArtifacts({
        build,
        buildInput,
        artifacts: [
          {
            path: "index.html",
            content: "1234567890", // 10 bytes
            sizeBytes: 5, // Conflicting runner declaration
            mimeType: "text/html",
          },
        ],
      }),
    ).rejects.toThrow(/ARTIFACT_SIZE_MISMATCH/);
  });

  it("enforces provenance: rejects non-building status or mismatched identity", async () => {
    const { r2Bucket } = createMockR2();
    const store = new CloudflareR2ThemeBuildArtifactStore({ r2Bucket });

    const buildInput = createDummyBuildInput();

    // 1. Rejects queued build
    const queuedBuild = createDummyBuild({ status: "queued" });
    await expect(
      store.persistBuildArtifacts({
        build: queuedBuild,
        buildInput,
        artifacts: [{ path: "index.html", content: "hello", mimeType: "text/html" }],
      }),
    ).rejects.toThrow(/BUILD_PROVENANCE_MISMATCH/);

    // 2. Rejects mismatched inputHash
    const mismatchedHashBuild = createDummyBuild({ inputHash: "wrong-hash" });
    await expect(
      store.persistBuildArtifacts({
        build: mismatchedHashBuild,
        buildInput,
        artifacts: [{ path: "index.html", content: "hello", mimeType: "text/html" }],
      }),
    ).rejects.toThrow(/BUILD_PROVENANCE_MISMATCH/);
  });

  it("retrieves stored artifact via getArtifact", async () => {
    const { r2Bucket } = createMockR2();
    const store = new CloudflareR2ThemeBuildArtifactStore({ r2Bucket });

    const build = createDummyBuild();
    const buildInput = createDummyBuildInput();

    await store.persistBuildArtifacts({
      build,
      buildInput,
      artifacts: [
        { path: "index.html", content: "<h1>Home</h1>", mimeType: "text/html" },
        { path: "assets/binary.dat", content: new Uint8Array([1, 2, 3, 4]), mimeType: "application/octet-stream" },
      ],
    });

    const textArtifact = await store.getArtifact({
      storefrontId: "store-1",
      themeId: "theme-1",
      buildId: "build-101",
      path: "index.html",
    });

    expect(textArtifact?.content).toBe("<h1>Home</h1>");
    expect(textArtifact?.mimeType).toBe("text/html");

    const binaryArtifact = await store.getArtifact({
      storefrontId: "store-1",
      themeId: "theme-1",
      buildId: "build-101",
      path: "assets/binary.dat",
    });

    expect(binaryArtifact?.content instanceof Uint8Array).toBe(true);
    expect(Array.from(binaryArtifact?.content as Uint8Array)).toEqual([1, 2, 3, 4]);
  });
});
