import { env } from "cloudflare:workers";
import { assetDal } from "@/lib/asset/dal/asset.dal";
import { servePreviewMedia } from "@/lib/storefront/service/preview-media-delivery";
import { resolveThemePreviewSecret } from "@/lib/storefront/service/theme-build-preview-token";

/** Library media a Live Preview page loads through a signed address. */
export async function handlePreviewMediaRequest(
  request: Request,
): Promise<Response> {
  const bindings = env as unknown as {
    R2_BUCKET?: {
      get(key: string): Promise<{
        body: ReadableStream | null;
        httpEtag: string;
        httpMetadata?: { contentType?: string };
      } | null>;
    };
  };
  let secret: string;
  try {
    secret = resolveThemePreviewSecret(undefined, env);
  } catch {
    return new Response("Preview media is not configured.", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  return servePreviewMedia(request, {
    secret,
    now: Date.now(),
    findAsset: async (id) => (await assetDal.findByIds([id]))[0] ?? null,
    getObject: async (key) => (await bindings.R2_BUCKET?.get(key)) ?? null,
  });
}
