import { describe, expect, it, vi } from "vitest";
import {
  lookupPublishedMedia,
  parsePublishedMediaPath,
  publishedMediaPath,
  type PublishedMediaPorts,
} from "./storefront-media-delivery";
import { resolvePublishedThemeMediaUrl } from "../theme-media";

describe("published media paths", () => {
  it("round-trips an asset id", () => {
    const id = "3f1c9a2e-4b5d-4c6e-8f70-1a2b3c4d5e6f";
    expect(parsePublishedMediaPath(publishedMediaPath(id))).toBe(id);
  });

  it("ignores paths that are not ours", () => {
    expect(parsePublishedMediaPath("/products/shoe")).toBeNull();
    expect(parsePublishedMediaPath("/_storefront-media/")).toBeNull();
  });

  // The id is the whole remainder, so nothing can be smuggled after it.
  it("refuses anything with a further segment or a bad id", () => {
    for (const path of [
      "/_storefront-media/abc/../../etc/passwd",
      "/_storefront-media/..%2F..%2Fsecret",
      "/_storefront-media/not-a-uuid",
      "/_storefront-media/assets/a.png",
    ]) {
      expect(parsePublishedMediaPath(path)).toBeNull();
    }
  });
});

describe("resolvePublishedThemeMediaUrl", () => {
  // The stored URL is the session-gated CMS path, which is a 404 or a 401 for
  // an anonymous visitor on the merchant hostname.
  it("sends a library asset to the storefront's own published path", () => {
    expect(
      resolvePublishedThemeMediaUrl({
        source: "asset",
        mediaType: "image",
        assetId: "3f1c9a2e-4b5d-4c6e-8f70-1a2b3c4d5e6f",
        url: "/assets/abc.png",
      }),
    ).toBe("/_storefront-media/3f1c9a2e-4b5d-4c6e-8f70-1a2b3c4d5e6f");
  });

  it("leaves an external URL alone", () => {
    expect(
      resolvePublishedThemeMediaUrl({
        source: "external",
        mediaType: "image",
        url: "https://cdn.example.com/a.png",
      }),
    ).toBe("https://cdn.example.com/a.png");
  });

  it("drops an unsafe external URL", () => {
    expect(
      resolvePublishedThemeMediaUrl({
        source: "external",
        mediaType: "image",
        url: "javascript:alert(1)",
      }),
    ).toBe("");
  });
});

describe("lookupPublishedMedia", () => {
  const published = "3f1c9a2e-4b5d-4c6e-8f70-1a2b3c4d5e6f";
  const ports = (ids: string[]): PublishedMediaPorts => ({
    listPublishedAssetIds: vi.fn(async () => new Set(ids)),
    getAssetDelivery: vi.fn(async (assetId) =>
      assetId === published
        ? { storageKey: "assets/abc.png", contentType: "image/png" }
        : null,
    ),
  });

  it("resolves an asset the release published", async () => {
    expect(
      await lookupPublishedMedia({
        assetId: published,
        publicationId: "pub_1",
        ports: ports([published]),
      }),
    ).toEqual({
      status: "found",
      storageKey: "assets/abc.png",
      contentType: "image/png",
    });
  });

  // The whole point: the library is not readable, only what was published.
  it("refuses an asset the release did not publish", async () => {
    const p = ports([]);
    expect(
      await lookupPublishedMedia({
        assetId: published,
        publicationId: "pub_1",
        ports: p,
      }),
    ).toEqual({ status: "not-published" });

    // Not looked up at all, so an unpublished id cannot be used to find out
    // whether that asset exists.
    expect(p.getAssetDelivery).not.toHaveBeenCalled();
  });

  it("refuses everything when the storefront has no publication", async () => {
    const p = ports([published]);
    expect(
      await lookupPublishedMedia({
        assetId: published,
        publicationId: null,
        ports: p,
      }),
    ).toEqual({ status: "not-published" });
    expect(p.listPublishedAssetIds).not.toHaveBeenCalled();
  });

  it("reports a published asset whose bytes are gone", async () => {
    expect(
      await lookupPublishedMedia({
        assetId: "11111111-2222-4333-8444-555555555555",
        publicationId: "pub_1",
        ports: ports(["11111111-2222-4333-8444-555555555555"]),
      }),
    ).toEqual({ status: "missing" });
  });
});
