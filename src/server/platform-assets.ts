import { mayServePlatformAssets } from "@/lib/storefront/service/storefront-request-routing";

type AssetsBinding = { fetch(request: Request): Promise<Response> };

/**
 * Morph Core's own static files — its `public/` and build assets — for a
 * platform hostname, and for nothing else.
 *
 * The Worker runs before static assets (`assets.run_worker_first` in
 * wrangler.jsonc), so this is the only place they are served. Without that,
 * Cloudflare answers any path matching a platform file before the Worker can
 * look at the hostname, and a storefront's `/favicon.ico`, `/robots.txt` or
 * `/manifest.json` would be Morph's rather than the merchant's.
 *
 * Returns `null` when the request is not for a platform file here, so the
 * caller goes on to the application: a storefront or preview hostname, a
 * method assets never answer, or a path that is not a platform file.
 */
export async function servePlatformAsset(
  request: Request,
  env: Record<string, unknown> | undefined,
): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const assets = env?.ASSETS as AssetsBinding | undefined;
  if (!assets || !mayServePlatformAssets(request, env)) return null;
  const response = await assets.fetch(request);
  return response.status === 404 ? null : response;
}
