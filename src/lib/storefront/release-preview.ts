import type { Metadata } from "@/db/json";

/** Key the capture occupies inside a release's free-form metadata. */
const RELEASE_PREVIEW_KEY = "preview";

/** The two shapes a release is looked at in. */
export const RELEASE_PREVIEW_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

export type ReleasePreviewViewport = keyof typeof RELEASE_PREVIEW_VIEWPORTS;

/**
 * Where a release's captured images live, and when they were taken.
 *
 * Held per release rather than per storefront because a release is immutable:
 * the picture of what shipped must not change when the next one ships, or
 * rolling back would show the wrong thing. `capturedAt` is kept so a stale
 * capture is recognisable rather than silently trusted.
 */
export interface ReleasePreview {
  desktopKey: string;
  mobileKey: string;
  capturedAt: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Reads the capture from a release's metadata, if it carries a complete one. */
export function readReleasePreview(
  metadata: Metadata | null | undefined,
): ReleasePreview | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }
  const raw = (metadata as Record<string, unknown>)[RELEASE_PREVIEW_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const { desktopKey, mobileKey, capturedAt } = raw as Record<string, unknown>;
  // Both images or neither: a half-written capture would render one viewport
  // from this release beside a placeholder for the other, which reads as a
  // broken page rather than as a capture that has not happened yet.
  if (
    !isNonEmptyString(desktopKey) ||
    !isNonEmptyString(mobileKey) ||
    !isNonEmptyString(capturedAt)
  ) {
    return undefined;
  }
  return { desktopKey, mobileKey, capturedAt };
}

/**
 * Returns metadata with the capture set, or removed when there is none.
 *
 * Other keys are preserved: the column is shared free-form metadata, and the
 * publish note lives beside this one.
 */
export function withReleasePreview(
  metadata: Metadata | null | undefined,
  preview: ReleasePreview | undefined,
): Metadata | null {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};

  if (preview) {
    base[RELEASE_PREVIEW_KEY] = { ...preview };
  } else {
    delete base[RELEASE_PREVIEW_KEY];
  }
  return Object.keys(base).length > 0 ? (base as Metadata) : null;
}

/**
 * Where a release's capture is stored.
 *
 * Keyed by release rather than by storefront so a capture can never overwrite
 * the picture of an earlier release, and so deleting a release's images needs
 * no index.
 */
export function releasePreviewKey(
  releaseId: string,
  viewport: ReleasePreviewViewport,
): string {
  return `storefront-release-previews/${releaseId}/${viewport}.png`;
}
