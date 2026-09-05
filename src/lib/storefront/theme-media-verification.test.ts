import { describe, expect, it } from "vitest";
import {
  collectMediaAssetIds,
  verifyMediaReferences,
  verifyThemeMediaValue,
} from "./theme-media-verification";

const asset = { id: "a1", type: "image", url: "/assets/real.png" };

describe("verifyThemeMediaValue", () => {
  // The stored shape only proved the id parsed as a UUID and the URL was safe.
  // Nothing asked whether the id named an asset, or whether that URL was its.
  it("replaces a claimed URL with the asset's own", () => {
    const result = verifyThemeMediaValue({
      media: {
        source: "asset",
        mediaType: "image",
        assetId: "a1",
        url: "https://example.invalid/not-an-asset.png",
      },
      asset,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        source: "asset",
        mediaType: "image",
        assetId: "a1",
        url: "/assets/real.png",
      },
    });
  });

  it("refuses an id that names nothing", () => {
    expect(
      verifyThemeMediaValue({
        media: { source: "asset", mediaType: "image", assetId: "a1", url: "" },
        asset: null,
      }),
    ).toEqual({ ok: false, reason: "unknown-asset" });
  });

  it("refuses an asset of the wrong kind", () => {
    expect(
      verifyThemeMediaValue({
        media: { source: "asset", mediaType: "video", assetId: "a1", url: "" },
        asset,
      }),
    ).toEqual({ ok: false, reason: "wrong-asset-type" });
  });

  it("leaves external media alone", () => {
    const media = {
      source: "external" as const,
      mediaType: "image" as const,
      url: "https://cdn.example.com/a.png",
    };
    expect(verifyThemeMediaValue({ media, asset: null })).toEqual({
      ok: true,
      value: media,
    });
  });
});

describe("verifyMediaReferences", () => {
  const assetsById = new Map([["a1", asset]]);

  it("finds references at any depth, including array rows", () => {
    const ids = collectMediaAssetIds({
      hero: { source: "asset", assetId: "a1" },
      items: [{ picture: { source: "asset", assetId: "a2" } }],
    });
    expect([...ids].sort()).toEqual(["a1", "a2"]);
  });

  it("rewrites nested references to the verified asset", () => {
    const result = verifyMediaReferences({
      props: {
        items: [
          {
            picture: {
              source: "asset",
              mediaType: "image",
              assetId: "a1",
              url: "https://elsewhere.invalid/x.png",
            },
          },
        ],
      },
      assetsById,
    });

    expect((result.items as never[])[0]).toEqual({
      picture: {
        source: "asset",
        mediaType: "image",
        assetId: "a1",
        url: "/assets/real.png",
      },
    });
  });

  // Rejected rather than dropped: a silently discarded image looks to the
  // author like a save that worked.
  it("fails the write on a reference it cannot verify", () => {
    expect(() =>
      verifyMediaReferences({
        props: {
          hero: {
            source: "asset",
            mediaType: "image",
            assetId: "ghost",
            url: "",
          },
        },
        assetsById,
      }),
    ).toThrow("INVALID_THEME_MEDIA_REFERENCE:ghost:unknown-asset");
  });
});
