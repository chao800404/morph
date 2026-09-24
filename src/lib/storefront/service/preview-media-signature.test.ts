// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  PREVIEW_MEDIA_TTL_MS,
  previewMediaExpiry,
  signPreviewMediaUrl,
  verifyPreviewMediaUrl,
} from "./preview-media-signature";

const SECRET = "test-secret";
const ASSET_ID = "43a43262-4ff6-46ee-a52b-02cdbafbabc6";
const KEY = `assets/${ASSET_ID}.png`;
const NOW = Date.UTC(2026, 8, 24, 10, 17);

const signed = async (overrides: { expiresAt?: number } = {}) =>
  new URL(
    await signPreviewMediaUrl({
      origin: "https://morph.example",
      assetId: ASSET_ID,
      storageKey: KEY,
      expiresAt: overrides.expiresAt ?? previewMediaExpiry(NOW),
      secret: SECRET,
    }),
  );

describe("preview media signatures", () => {
  it("round-trips an address it issued", async () => {
    const url = await signed();
    expect(url.origin).toBe("https://morph.example");
    expect(url.pathname).toBe(`/_morph/preview-media/${ASSET_ID}`);
    expect(await verifyPreviewMediaUrl(url, SECRET, NOW)).toEqual({
      ok: true,
      assetId: ASSET_ID,
      storageKey: KEY,
    });
  });

  it("refuses an address pointed at another asset or version", async () => {
    const otherAsset = await signed();
    otherAsset.pathname =
      "/_morph/preview-media/00000000-0000-4000-8000-000000000000";
    const otherVersion = await signed();
    otherVersion.searchParams.set("version", "assets/other.png");
    const extended = await signed();
    extended.searchParams.set(
      "expires",
      String(Number(extended.searchParams.get("expires")) - 1),
    );
    for (const url of [otherAsset, otherVersion, extended]) {
      expect(await verifyPreviewMediaUrl(url, SECRET, NOW)).toEqual({
        ok: false,
        reason: "forged",
      });
    }
    expect(
      await verifyPreviewMediaUrl(await signed(), "another-secret", NOW),
    ).toEqual({ ok: false, reason: "forged" });
  });

  it("stops honouring an address once it expires", async () => {
    const url = await signed();
    const expiresAt = Number(url.searchParams.get("expires"));
    expect((await verifyPreviewMediaUrl(url, SECRET, expiresAt)).ok).toBe(true);
    expect(await verifyPreviewMediaUrl(url, SECRET, expiresAt + 1)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("refuses an expiry further out than it would issue", async () => {
    const url = await signed({ expiresAt: NOW + 30 * PREVIEW_MEDIA_TTL_MS });
    expect(await verifyPreviewMediaUrl(url, SECRET, NOW)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("refuses anything that is not a well-formed address", async () => {
    const traversal = await signed();
    traversal.searchParams.set("version", "assets/../secrets.txt");
    const outside = await signed();
    outside.searchParams.set("version", "private/report.pdf");
    const noSignature = await signed();
    noSignature.searchParams.delete("signature");
    for (const url of [traversal, outside, noSignature]) {
      expect(await verifyPreviewMediaUrl(url, SECRET, NOW)).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
    expect(
      await verifyPreviewMediaUrl(
        new URL("https://morph.example/assets/x.png"),
        SECRET,
        NOW,
      ),
    ).toEqual({ ok: false, reason: "not-ours" });
  });

  it("issues the same address throughout an hour", async () => {
    expect(previewMediaExpiry(NOW)).toBe(previewMediaExpiry(NOW + 30 * 60_000));
    expect(previewMediaExpiry(NOW) - NOW).toBeGreaterThanOrEqual(
      PREVIEW_MEDIA_TTL_MS,
    );
  });
});
