// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { StorefrontThemeWorkspaceEntryDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import { CloudflareR2ThemeSourceBlobStore } from "../storage/cloudflare-r2-theme-source-blob-store";
import { readThemeBinaryFile } from "../storage/d1-theme-storage";
import {
  materializeThemeSandboxWorkspace,
  type ThemeWorkspaceWriter,
} from "../compiler/theme-sandbox-workspace";
import { LocalPreviewSidecarClient } from "./local-preview-sidecar-client";
import { themePreviewWorkspaceInput } from "./theme-preview-workspace-files";

vi.mock("cloudflare:workers", () => ({ env: {} }));

/**
 * A preview is started from the whole workspace, and its binary files are
 * read through the blob store that checks them against their digest — the
 * real one here, over an in-memory bucket.
 */

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

function png(size: number, fill = 7) {
  const bytes = new Uint8Array(size).fill(fill);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
}

function memoryBucket() {
  const objects = new Map<string, Uint8Array>();
  const bucket = {
    async get(key: string) {
      const bytes = objects.get(key);
      return bytes
        ? {
            body: bytes,
            size: bytes.byteLength,
            arrayBuffer: async () => new Uint8Array(bytes).buffer,
            text: async () => new TextDecoder().decode(bytes),
          }
        : null;
    },
    async head(key: string) {
      const bytes = objects.get(key);
      return bytes ? { size: bytes.byteLength } : null;
    },
    async put(
      key: string,
      value: Uint8Array,
      options?: { onlyIf?: { etagDoesNotMatch?: string } },
    ) {
      if (options?.onlyIf?.etagDoesNotMatch === "*" && objects.has(key)) {
        return null;
      }
      objects.set(key, new Uint8Array(value));
      return { key, size: value.byteLength };
    },
    async delete(key: string) {
      objects.delete(key);
    },
    async list() {
      return { objects: [], truncated: false };
    },
  };
  return { objects, bucket };
}

const common = {
  storefrontId: "s",
  themeId: "t",
  mimeType: "text/plain",
  version: 3,
  createdAt: "now",
  updatedAt: "now",
};

function workspace(bytes: Uint8Array): StorefrontThemeWorkspaceEntryDTO[] {
  return [
    {
      ...common,
      id: "1",
      path: "src/routes/index.tsx",
      content: "export default 1;",
      isEntry: true,
    },
    {
      ...common,
      id: "2",
      path: "public/images/hero.png",
      encoding: "binary",
      blobDigest: sha256(bytes),
      sizeBytes: bytes.byteLength,
      mimeType: "image/png",
      isEntry: false,
      version: 5,
    },
  ];
}

function recordingWriter() {
  const written = new Map<string, string | Uint8Array>();
  const writer: ThemeWorkspaceWriter = {
    async writeFile(path, content) {
      written.set(path, content);
    },
    async mkdir() {},
  };
  return { written, writer };
}

describe("themePreviewWorkspaceInput", () => {
  it("starts from every file, binary ones by reference", () => {
    const bytes = png(64);
    const input = themePreviewWorkspaceInput(workspace(bytes), async () => {
      throw new Error("not read while planning");
    });

    expect(input.files).toEqual([
      { path: "src/routes/index.tsx", content: "export default 1;" },
      {
        path: "public/images/hero.png",
        binary: { digest: sha256(bytes), sizeBytes: 64 },
      },
    ]);
    expect(input.entry).toBe("src/routes/index.tsx");
    expect(input.fileVersions).toEqual({
      "src/routes/index.tsx": 3,
      "public/images/hero.png": 5,
    });
  });

  it("writes the stored bytes, read through the blob store", async () => {
    const r2 = memoryBucket();
    const store = new CloudflareR2ThemeSourceBlobStore(r2.bucket);
    const bytes = png(2048);
    await store.putImmutable({
      digest: sha256(bytes),
      content: bytes,
      mimeType: "image/png",
    });
    const input = themePreviewWorkspaceInput(workspace(bytes), (digest) =>
      readThemeBinaryFile(store, digest),
    );
    const { written, writer } = recordingWriter();

    await materializeThemeSandboxWorkspace(
      writer,
      input.files.map((file) => ({ ...file, path: `/workspace/${file.path}` })),
      { loadBinary: input.loadBinary },
    );

    expect(written.get("/workspace/public/images/hero.png")).toEqual(bytes);
  });

  it("fails the whole write when the stored bytes are not the file", async () => {
    const r2 = memoryBucket();
    const store = new CloudflareR2ThemeSourceBlobStore(r2.bucket);
    const bytes = png(2048);
    // Other bytes of the same size under the file's digest.
    r2.objects.set(`theme-source/${sha256(bytes)}`, png(2048, 9));
    const input = themePreviewWorkspaceInput(workspace(bytes), (digest) =>
      readThemeBinaryFile(store, digest),
    );
    const { written, writer } = recordingWriter();

    await expect(
      materializeThemeSandboxWorkspace(
        writer,
        input.files.map((file) => ({
          ...file,
          path: `/workspace/${file.path}`,
        })),
        { loadBinary: input.loadBinary },
      ),
    ).rejects.toThrow("THEME_SOURCE_BLOB_INTEGRITY_FAILURE");
    expect(written.has("/workspace/public/images/hero.png")).toBe(false);
  });

  it("fails when the bytes are gone", async () => {
    const store = new CloudflareR2ThemeSourceBlobStore(memoryBucket().bucket);
    await expect(readThemeBinaryFile(store, "a".repeat(64))).rejects.toThrow(
      "SOURCE_BLOB_NOT_FOUND",
    );
  });
});

describe("the local preview sidecar and binary files", () => {
  it("refuses a start it cannot carry, without sending it", async () => {
    const fetchImpl = vi.fn();
    const client = new LocalPreviewSidecarClient({
      origin: "http://127.0.0.1:1",
      token: "t".repeat(32),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const input = themePreviewWorkspaceInput(workspace(png(8)), async () =>
      png(8),
    );

    const result = await client.start({
      previewId: "p",
      files: input.files,
      entry: "src/routes/index.tsx",
      previewHostname: "preview.localhost",
      env: {},
      loadBinary: input.loadBinary,
    });

    expect(result).toMatchObject({
      ok: false,
      stage: "preview-sidecar",
      errorMessage: expect.stringContaining("public/images/hero.png"),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
