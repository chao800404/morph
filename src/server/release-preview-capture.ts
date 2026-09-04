import { env } from "cloudflare:workers";

import { storefrontReleaseDal } from "@/lib/storefront/dal/storefront-release.dal";
import { createBrowserRunScreenshotter } from "@/lib/storefront/service/browser-run-screenshot.service";
import { captureReleasePreview } from "@/lib/storefront/service/release-preview.service";
import {
  generatePreviewCapabilityToken,
  resolveThemePreviewSecret,
} from "@/lib/storefront/service/theme-build-preview-token";

type CaptureEnv = {
  R2_BUCKET?: { put: (key: string, bytes: Uint8Array) => Promise<unknown> };
  PUBLIC_ORIGIN?: unknown;
  CLOUDFLARE_ACCOUNT_ID?: unknown;
  BROWSER_RENDERING_API_TOKEN?: unknown;
};

/**
 * Captures what a published release looks like.
 *
 * The capture targets the release's own build preview URL rather than the
 * storefront's primary domain: publishing creates a release but does not
 * necessarily make it live, so the domain would photograph whatever is
 * currently serving — the previous release — and label it as this one.
 *
 * Every missing piece resolves to "no capture" rather than an error. This runs
 * after a release is already durable, so nothing here may report failure in a
 * way that suggests the publish did not land.
 */
export async function runReleasePreviewCapture(payload: {
  storefrontId: string;
  releaseId: string;
}): Promise<void> {
  const bindings = env as unknown as CaptureEnv;
  const bucket = bindings.R2_BUCKET;
  if (!bucket) return;

  const result = await captureReleasePreview(payload.releaseId, {
    screenshotter: createBrowserRunScreenshotter(bindings),

    resolvePreviewUrl: async (releaseId) => {
      const origin = bindings.PUBLIC_ORIGIN;
      // Browser Run reaches the page over the public internet, so a capture is
      // only possible once this Worker has an address that is not localhost.
      if (typeof origin !== "string" || !origin.startsWith("https://")) {
        return null;
      }

      const release = await storefrontReleaseDal.getById(
        payload.storefrontId,
        releaseId,
      );
      if (!release?.themeBuildId) return null;

      let token: string;
      try {
        token = await generatePreviewCapabilityToken(
          {
            buildId: release.themeBuildId,
            storefrontId: payload.storefrontId,
            themeId: release.themeId,
          },
          resolveThemePreviewSecret(undefined, bindings),
        );
      } catch {
        // `resolveThemePreviewSecret` fails closed when nothing is configured.
        return null;
      }

      return `${origin.replace(/\/$/, "")}/preview-build/${encodeURIComponent(
        release.themeBuildId,
      )}/${encodeURIComponent(token)}/`;
    },

    putObject: async (key, bytes) => {
      await bucket.put(key, bytes);
    },

    getReleaseMetadata: async (releaseId) => {
      const release = await storefrontReleaseDal.getById(
        payload.storefrontId,
        releaseId,
      );
      return release?.metadata ?? null;
    },

    setReleaseMetadata: async (releaseId, metadata) => {
      await storefrontReleaseDal.setReleaseMetadata({
        storefrontId: payload.storefrontId,
        releaseId,
        metadata,
      });
    },
  });

  if (result.status === "failed") {
    console.error("Release preview capture failed:", result.message);
  }
}
