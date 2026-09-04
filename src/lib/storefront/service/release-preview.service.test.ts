import { describe, expect, it, vi } from "vitest";

import type { Metadata } from "@/db/json";
import { readReleasePreview } from "@/lib/storefront/release-preview";
import {
  captureReleasePreview,
  type CaptureReleasePreviewPorts,
} from "./release-preview.service";

const RELEASE_ID = "11111111-1111-4111-8111-111111111111";

function makePorts(
  overrides: Partial<CaptureReleasePreviewPorts> = {},
): CaptureReleasePreviewPorts & {
  stored: Map<string, Uint8Array>;
  metadata: { value: Metadata | null };
} {
  const stored = new Map<string, Uint8Array>();
  const metadata: { value: Metadata | null } = { value: null };

  return {
    stored,
    metadata,
    screenshotter: {
      capture: vi.fn(async ({ width }) => new Uint8Array([width & 0xff])),
    },
    resolvePreviewUrl: async () => "https://shop.example.com/",
    putObject: async (key, bytes) => {
      stored.set(key, bytes);
    },
    getReleaseMetadata: async () => metadata.value,
    setReleaseMetadata: async (_id, next) => {
      metadata.value = next;
    },
    now: () => new Date("2026-09-02T10:00:00.000Z"),
    ...overrides,
  };
}

describe("captureReleasePreview", () => {
  it("captures both viewports and points the release at them", async () => {
    const ports = makePorts();

    const result = await captureReleasePreview(RELEASE_ID, ports);

    expect(result.status).toBe("captured");
    expect([...ports.stored.keys()].sort()).toEqual([
      `storefront-release-previews/${RELEASE_ID}/desktop.png`,
      `storefront-release-previews/${RELEASE_ID}/mobile.png`,
    ]);
    expect(readReleasePreview(ports.metadata.value)).toEqual({
      desktopKey: `storefront-release-previews/${RELEASE_ID}/desktop.png`,
      mobileKey: `storefront-release-previews/${RELEASE_ID}/mobile.png`,
      capturedAt: "2026-09-02T10:00:00.000Z",
    });
  });

  it("keeps the publish note the release already carries", async () => {
    const ports = makePorts();
    ports.metadata.value = { note: "Reworded the homepage hero" } as Metadata;

    await captureReleasePreview(RELEASE_ID, ports);

    expect(ports.metadata.value).toMatchObject({
      note: "Reworded the homepage hero",
    });
  });

  it("does nothing when the deployment has no screenshotter", async () => {
    // The token is optional infrastructure. Publishing without one has to be
    // ordinary, not an error path.
    const ports = makePorts({ screenshotter: null });

    expect(await captureReleasePreview(RELEASE_ID, ports)).toEqual({
      status: "skipped",
      reason: "no-screenshotter",
    });
    expect(ports.metadata.value).toBeNull();
    expect(ports.stored.size).toBe(0);
  });

  it("does nothing when the release is not reachable at a URL", async () => {
    const ports = makePorts({ resolvePreviewUrl: async () => null });

    expect(await captureReleasePreview(RELEASE_ID, ports)).toEqual({
      status: "skipped",
      reason: "no-url",
    });
    expect(ports.stored.size).toBe(0);
  });

  it("reports a capture failure instead of throwing at the publish path", async () => {
    const ports = makePorts({
      screenshotter: {
        capture: async () => {
          throw new Error("Browser Run screenshot failed (429): daily cap");
        },
      },
    });

    const result = await captureReleasePreview(RELEASE_ID, ports);

    expect(result).toMatchObject({ status: "failed" });
    expect(result.status === "failed" && result.message).toContain("429");
  });

  it("never points a release at images it failed to store", async () => {
    // Metadata written before the upload lands would advertise images that are
    // not there, which the page cannot tell apart from a broken bucket.
    const ports = makePorts({
      putObject: async () => {
        throw new Error("R2 unavailable");
      },
    });

    const result = await captureReleasePreview(RELEASE_ID, ports);

    expect(result.status).toBe("failed");
    expect(ports.metadata.value).toBeNull();
  });

  it("leaves an earlier capture in place when a later one fails", async () => {
    const ports = makePorts({
      screenshotter: {
        capture: async () => {
          throw new Error("timeout");
        },
      },
    });
    ports.metadata.value = {
      preview: {
        desktopKey: "old/desktop.png",
        mobileKey: "old/mobile.png",
        capturedAt: "2026-09-01T00:00:00.000Z",
      },
    } as unknown as Metadata;

    await captureReleasePreview(RELEASE_ID, ports);

    expect(readReleasePreview(ports.metadata.value)?.desktopKey).toBe(
      "old/desktop.png",
    );
  });
});
