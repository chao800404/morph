import type { Metadata } from "@/db/json";
import {
  RELEASE_PREVIEW_VIEWPORTS,
  releasePreviewKey,
  withReleasePreview,
  type ReleasePreviewViewport,
} from "@/lib/storefront/release-preview";
import type { ThemeScreenshotter } from "./theme-screenshot.types";

export type CaptureReleasePreviewOutcome =
  | { status: "captured"; desktopKey: string; mobileKey: string }
  | { status: "skipped"; reason: "no-screenshotter" | "no-url" }
  | { status: "failed"; message: string };

export interface CaptureReleasePreviewPorts {
  /** Absent when the deployment has no Browser Run credentials. */
  screenshotter: ThemeScreenshotter | null;
  /** Where the release can be reached, or null when it is not servable. */
  resolvePreviewUrl: (releaseId: string) => Promise<string | null>;
  putObject: (key: string, bytes: Uint8Array) => Promise<void>;
  /** Reads the metadata to merge into, so the publish note is not lost. */
  getReleaseMetadata: (releaseId: string) => Promise<Metadata | null>;
  setReleaseMetadata: (
    releaseId: string,
    metadata: Metadata | null,
  ) => Promise<void>;
  now?: () => Date;
}

/**
 * Captures what a release looks like, in both viewports, and records it.
 *
 * Every absent precondition is a `skipped`, never a throw: the caller runs
 * after a release already exists, so failing here must not undo a publish that
 * succeeded. A storefront with no picture is a cosmetic gap; a publish that
 * reports failure because a screenshot service was slow is a real one.
 *
 * The two images are written before the metadata that points at them. Doing it
 * the other way round would leave a release advertising images that are not
 * there yet, and the page has no way to tell that from a broken upload.
 */
export async function captureReleasePreview(
  releaseId: string,
  ports: CaptureReleasePreviewPorts,
): Promise<CaptureReleasePreviewOutcome> {
  if (!ports.screenshotter) {
    return { status: "skipped", reason: "no-screenshotter" };
  }

  const url = await ports.resolvePreviewUrl(releaseId);
  if (!url) return { status: "skipped", reason: "no-url" };

  try {
    const viewports = Object.keys(
      RELEASE_PREVIEW_VIEWPORTS,
    ) as ReleasePreviewViewport[];

    const captures = await Promise.all(
      viewports.map(async (viewport) => {
        const size = RELEASE_PREVIEW_VIEWPORTS[viewport];
        const bytes = await ports.screenshotter!.capture({
          url,
          width: size.width,
          height: size.height,
        });
        const key = releasePreviewKey(releaseId, viewport);
        await ports.putObject(key, bytes);
        return [viewport, key] as const;
      }),
    );

    const keys = Object.fromEntries(captures) as Record<
      ReleasePreviewViewport,
      string
    >;

    const existing = await ports.getReleaseMetadata(releaseId);
    await ports.setReleaseMetadata(
      releaseId,
      withReleasePreview(existing, {
        desktopKey: keys.desktop,
        mobileKey: keys.mobile,
        capturedAt: (ports.now?.() ?? new Date()).toISOString(),
      }),
    );

    return {
      status: "captured",
      desktopKey: keys.desktop,
      mobileKey: keys.mobile,
    };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
