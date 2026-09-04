import { describe, expect, it } from "vitest";

import type { Metadata } from "@/db/json";
import {
  readReleasePreview,
  releasePreviewKey,
  withReleasePreview,
} from "./release-preview";

const preview = {
  desktopKey: "storefront-release-previews/r1/desktop.png",
  mobileKey: "storefront-release-previews/r1/mobile.png",
  capturedAt: "2026-09-02T10:00:00.000Z",
};

describe("release preview metadata", () => {
  it("round-trips a capture", () => {
    expect(readReleasePreview(withReleasePreview(null, preview))).toEqual(
      preview,
    );
  });

  it("preserves the publish note beside it", () => {
    const metadata = withReleasePreview(
      { note: "Hotfix" } as Metadata,
      preview,
    );

    expect(metadata).toMatchObject({ note: "Hotfix" });
    expect(readReleasePreview(metadata)).toEqual(preview);
  });

  it("clears the capture without touching the rest", () => {
    const metadata = withReleasePreview(
      withReleasePreview({ note: "Hotfix" } as Metadata, preview),
      undefined,
    );

    expect(metadata).toEqual({ note: "Hotfix" });
    expect(readReleasePreview(metadata)).toBeUndefined();
  });

  it("returns null metadata when nothing is left", () => {
    expect(
      withReleasePreview(withReleasePreview(null, preview), undefined),
    ).toBeNull();
  });

  it("reports no capture for a release that has none", () => {
    expect(readReleasePreview(null)).toBeUndefined();
    expect(readReleasePreview({ note: "Hotfix" } as Metadata)).toBeUndefined();
  });

  it("rejects a half-written capture", () => {
    // One image without the other would render this release beside a
    // placeholder, which reads as a broken page rather than as one not yet
    // captured.
    expect(
      readReleasePreview({
        preview: {
          desktopKey: preview.desktopKey,
          capturedAt: preview.capturedAt,
        },
      } as unknown as Metadata),
    ).toBeUndefined();

    expect(
      readReleasePreview({
        preview: { ...preview, mobileKey: "   " },
      } as unknown as Metadata),
    ).toBeUndefined();
  });

  it("keys a capture by release so one can never overwrite another", () => {
    expect(releasePreviewKey("r1", "desktop")).toBe(
      "storefront-release-previews/r1/desktop.png",
    );
    expect(releasePreviewKey("r2", "desktop")).not.toBe(
      releasePreviewKey("r1", "desktop"),
    );
  });
});
