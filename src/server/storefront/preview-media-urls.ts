import { env } from "cloudflare:workers";
import { getRequest } from "@tanstack/react-start/server";
import { assetDal } from "@/lib/asset/dal/asset.dal";
import {
  applyPreviewMediaUrls,
  collectPreviewMediaAssetIds,
} from "@/lib/storefront/preview-media-references";
import { signPreviewMediaAssets } from "@/lib/storefront/service/preview-media-delivery";
import { resolveThemePreviewSecret } from "@/lib/storefront/service/theme-build-preview-token";

/**
 * Signed preview addresses for assets, issued to the signed-in editor.
 *
 * Addressed at the origin the editor itself called, which is Morph's own:
 * the address has to work from a preview page on any origin, including a
 * loopback sidecar whose requests never reach this Worker.
 */
export async function signPreviewMedia(assetIds: Iterable<string>) {
  return signPreviewMediaAssets(assetIds, {
    origin: new URL(getRequest().url).origin,
    secret: resolveThemePreviewSecret(undefined, env),
    now: Date.now(),
    findAssets: (ids) => assetDal.findByIds(ids),
  });
}

/**
 * The preview content with its library media pointing at signed addresses.
 *
 * Best effort: without a signing secret the content is returned as it was,
 * and its library images stay broken rather than the preview failing to start.
 */
export async function withSignedPreviewMedia<T>(content: T): Promise<T> {
  const ids = collectPreviewMediaAssetIds(content);
  if (ids.size === 0) return content;
  try {
    const { urls } = await signPreviewMedia(ids);
    return applyPreviewMediaUrls(content, urls);
  } catch (error) {
    console.warn("Could not sign Live Preview media:", error);
    return content;
  }
}
