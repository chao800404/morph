import { beforeEach, describe, expect, it, vi } from "vitest";

const bucket = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { R2_BUCKET: bucket } }));

import { previewAssetDataUrls } from "./preview-asset-data-urls";

type Asset = Parameters<typeof previewAssetDataUrls>[0][number];

const asset = (overrides: Partial<Asset> = {}): Asset =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    url: "/api/store/assets/11111111-1111-4111-8111-111111111111",
    mimeType: "image/png",
    size: 1024,
    ...overrides,
  }) as Asset;

const objectOf = (bytes: number) => ({
  size: bytes,
  arrayBuffer: async () => new ArrayBuffer(bytes),
});

describe("image bytes the preview is allowed to inline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bucket.get.mockResolvedValue(objectOf(1024));
  });

  // Theme code runs in that frame. A URL would be a capability; bytes are not.
  it("hands back data URLs, never a Morph address", async () => {
    const urls = await previewAssetDataUrls([asset()]);
    expect(
      [...urls.values()].every((url) =>
        url.startsWith("data:image/png;base64,"),
      ),
    ).toBe(true);
  });

  it("declines a type that is not a still image", async () => {
    for (const mimeType of ["image/svg+xml", "text/html", "application/pdf"]) {
      expect(
        await previewAssetDataUrls([asset({ mimeType } as never)]),
      ).toHaveProperty("size", 0);
    }
    // SVG carries script, which is the whole reason it is not on the list.
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("declines one file over the per-asset budget before reading it", async () => {
    expect(
      await previewAssetDataUrls([asset({ size: 4 * 1024 * 1024 } as never)]),
    ).toHaveProperty("size", 0);
    expect(bucket.get).not.toHaveBeenCalled();
  });

  // The budget is the whole response, not each file: a page of large-enough
  // images would otherwise be inlined one acceptable file at a time.
  it("stops at the total budget rather than per file", async () => {
    const big = 3 * 1024 * 1024;
    bucket.get.mockResolvedValue(objectOf(big));
    const assets = Array.from({ length: 5 }, (_, index) =>
      asset({
        id: `1111111${index}-1111-4111-8111-111111111111`,
        url: `/api/store/assets/1111111${index}`,
        size: big,
      } as never),
    );
    const urls = await previewAssetDataUrls(assets);
    expect(urls.size).toBeLessThanOrEqual(2);
  });

  // The object is the authority on its own size; the row can disagree.
  it("declines bytes larger than the row claimed", async () => {
    bucket.get.mockResolvedValue(objectOf(4 * 1024 * 1024));
    expect(await previewAssetDataUrls([asset()])).toHaveProperty("size", 0);
  });

  it("returns nothing at all when there is no bucket to read", async () => {
    vi.resetModules();
    vi.doMock("cloudflare:workers", () => ({ env: {} }));
    const { previewAssetDataUrls: withoutBucket } =
      await import("./preview-asset-data-urls");
    expect(await withoutBucket([asset()])).toHaveProperty("size", 0);
    vi.doUnmock("cloudflare:workers");
  });
});
