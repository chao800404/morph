import { describe, expect, it, vi } from "vitest";
import type { R2BucketLike } from "@/lib/storefront/compiler/cloudflare-r2-theme-build-artifact-store";
import {
  calculateThemeSourceSha256,
  CloudflareR2ThemeSourceBlobStore,
} from "./cloudflare-r2-theme-source-blob-store";

function createMockR2() {
  const objects = new Map<string, Uint8Array>();
  const bucket: R2BucketLike = {
    get: vi.fn(async (key: string) => {
      const bytes = objects.get(key);
      if (!bytes) return null;
      return {
        body: null,
        async arrayBuffer() {
          return bytes.slice().buffer;
        },
        async text() {
          return new TextDecoder().decode(bytes);
        },
      };
    }),
    head: vi.fn(async () => null),
    put: vi.fn(async (key: string, value: any, options: any) => {
      if (options?.onlyIf?.etagDoesNotMatch === "*" && objects.has(key)) {
        return null;
      }
      const bytes =
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : value instanceof Uint8Array
            ? value
            : new Uint8Array(value);
      objects.set(key, bytes.slice());
      return { key, size: bytes.byteLength };
    }),
    delete: vi.fn(async () => undefined),
  };
  return { bucket, objects };
}

describe("CloudflareR2ThemeSourceBlobStore", () => {
  it("stores content-addressed UTF-8 blobs idempotently and verifies reads", async () => {
    const { bucket, objects } = createMockR2();
    const store = new CloudflareR2ThemeSourceBlobStore(bucket);
    const content = "export default () => 'hello';";
    const digest = calculateThemeSourceSha256(content);

    await store.putImmutable({ digest, content, mimeType: "text/typescript" });
    await store.putImmutable({ digest, content, mimeType: "text/typescript" });

    expect(objects.has(`theme-source/${digest}`)).toBe(true);
    expect(Array.from((await store.getImmutable(digest)) ?? [])).toEqual(
      Array.from(new TextEncoder().encode(content)),
    );
    expect(bucket.put).toHaveBeenCalledTimes(2);
  });

  it("rejects a digest that does not match the bytes", async () => {
    const { bucket } = createMockR2();
    const store = new CloudflareR2ThemeSourceBlobStore(bucket);
    const digest = calculateThemeSourceSha256("expected");

    await expect(
      store.putImmutable({ digest, content: "tampered", mimeType: "text/plain" }),
    ).rejects.toThrow("THEME_SOURCE_DIGEST_MISMATCH");
  });

  it("fails closed when an existing object is corrupted", async () => {
    const { bucket, objects } = createMockR2();
    const store = new CloudflareR2ThemeSourceBlobStore(bucket);
    const content = "immutable";
    const digest = calculateThemeSourceSha256(content);
    objects.set(`theme-source/${digest}`, new TextEncoder().encode("corrupt"));

    await expect(store.getImmutable(digest)).rejects.toThrow(
      "THEME_SOURCE_BLOB_INTEGRITY_FAILURE",
    );
  });
});
