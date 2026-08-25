import { describe, expect, it, vi } from "vitest";
import {
  PREVIEW_ARTIFACT_POLICY,
  PRODUCTION_ARTIFACT_POLICY,
  sanitizeArtifactPath,
  serveThemeArtifact,
} from "./theme-artifact-server";
import type { CanonicalThemeBuildManifest } from "../compiler/theme-build-artifact-store.types";

function file(path: string, contentType: string) {
  return { path, contentType, sizeBytes: 10, sha256: "0".repeat(64) };
}

/** Shape a TanStack Start build produces: the entry lives under `preview/`. */
const manifest = {
  artifactEntry: "preview/index.html",
  files: [
    file("preview/index.html", "text/html"),
    file("preview/assets/index-abc.js", "application/javascript"),
    file("preview/assets/index-abc.css", "text/css"),
    file("runtime/server/index.js", "application/javascript"),
  ],
} as unknown as CanonicalThemeBuildManifest;

function r2() {
  return {
    get: vi.fn(async () => ({
      body: null,
      httpEtag: '"etag"',
      httpMetadata: {},
      arrayBuffer: async () => new TextEncoder().encode("x").buffer,
    })),
  } as any;
}

async function serve(artifactPath: string | undefined, bucket = r2()) {
  return {
    bucket,
    result: await serveThemeArtifact({
      request: new Request("https://example.test/"),
      artifactPrefix: "builds/b1",
      manifest,
      artifactPath,
      r2Bucket: bucket,
      policy: PREVIEW_ARTIFACT_POLICY,
    }),
  };
}

describe("entry-relative sub-resource resolution", () => {
  it("serves the entry document when the artifact root is requested", async () => {
    const { bucket, result } = await serve(undefined);
    expect(result.success).toBe(true);
    expect(bucket.get).toHaveBeenCalledWith("builds/b1/preview/index.html");
  });

  it("resolves a relative sub-resource against the entry directory", async () => {
    // The browser resolves `./assets/index-abc.js` from `preview/index.html`
    // to `assets/index-abc.js`, which is not a manifest path on its own.
    const { bucket, result } = await serve("assets/index-abc.js");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(bucket.get).toHaveBeenCalledWith(
      "builds/b1/preview/assets/index-abc.js",
    );
    expect(result.response.headers.get("Content-Type")).toContain(
      "application/javascript",
    );
  });

  it("still serves a fully qualified artifact path", async () => {
    const { bucket, result } = await serve("preview/assets/index-abc.css");
    expect(result.success).toBe(true);
    expect(bucket.get).toHaveBeenCalledWith(
      "builds/b1/preview/assets/index-abc.css",
    );
  });

  it("does not invent files: an undeclared sibling is still refused", async () => {
    const { bucket, result } = await serve("assets/not-built.js");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.failure.kind).toBe("NOT_IN_MANIFEST");
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("keeps path traversal refused even through the entry-relative retry", async () => {
    for (const attempt of ["../secret", "%2e%2e%2fsecret", "assets/../../etc"]) {
      const { result } = await serve(attempt);
      expect(result.success, `path ${attempt}`).toBe(false);
      if (result.success) return;
      expect(["INVALID_PATH", "NOT_IN_MANIFEST"]).toContain(result.failure.kind);
    }
  });
});

describe("serving policies", () => {
  it("keeps the editor preview sandboxed and uncached", async () => {
    const { result } = await serve("preview/index.html");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.response.headers.get("Cache-Control")).toBe(
      "private, no-store",
    );
    expect(result.response.headers.get("Content-Security-Policy")).toContain(
      "sandbox allow-scripts",
    );
  });

  it("serves production assets publicly and without the preview sandbox", async () => {
    const result = await serveThemeArtifact({
      request: new Request("https://shop.example.com/"),
      artifactPrefix: "builds/b1",
      manifest,
      artifactPath: "preview/assets/index-abc.js",
      r2Bucket: r2(),
      policy: PRODUCTION_ARTIFACT_POLICY,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.response.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(result.response.headers.get("Content-Security-Policy")).toBeNull();
  });
});

describe("sanitizeArtifactPath", () => {
  it("rejects every traversal shape", () => {
    for (const value of [
      "../x",
      "a/../../b",
      "%2e%2e%2fx",
      "a\\b",
      "a%00b",
      "%2fetc",
    ]) {
      expect(() => sanitizeArtifactPath(value), value).toThrow();
    }
  });
});
