import { normalizeStorefrontHostname } from "./storefront-host-resolver";
import { collectPlatformHostnames } from "./storefront-request-routing";

/**
 * Decides whether a Live Preview may run Theme JavaScript, and on what host.
 *
 * Unlike the artifact preview, whose origin is configured outright, a preview
 * server's URL is only known once a container hands one back. So the decision
 * splits in two: whether a host is configured that Theme code may be served
 * from at all, and whether the URL that later comes back really belongs to it.
 * Both fail closed. A preview that ends up on Morph's own origin would put
 * Theme code inside the editor's cookie jar, which is the one outcome no
 * convenience is worth.
 */

export type PreviewServerHostRefusal =
  "MISSING_PREVIEW_HOST" | "INVALID_PREVIEW_HOST" | "PLATFORM_PREVIEW_HOST";

export type PreviewServerHostConfig =
  | Readonly<{ enabled: true; hostname: string }>
  | Readonly<{ enabled: false; reason: PreviewServerHostRefusal }>;

export type ExposedPreviewUrlRefusal =
  | "INVALID_PREVIEW_URL"
  | "INSECURE_PREVIEW_URL"
  | "PREVIEW_URL_OFF_HOST"
  | "PLATFORM_PREVIEW_HOST";

export type ExposedPreviewUrlResult =
  | Readonly<{ ok: true; url: string; origin: string }>
  | Readonly<{ ok: false; reason: ExposedPreviewUrlRefusal }>;

/**
 * Resolves the host a preview server's URLs are built on.
 *
 * Rejecting any platform hostname is stricter than rejecting the editor's own
 * origin: the dashboard, the API and any configured staging host share that
 * cookie jar too, so "not the editor" would still leave ways in.
 */
export function resolveThemePreviewServerHost({
  configuredPreviewHostname,
  env,
}: {
  configuredPreviewHostname: string | undefined;
  env: Record<string, unknown> | undefined;
}): PreviewServerHostConfig {
  if (!configuredPreviewHostname?.trim()) {
    return { enabled: false, reason: "MISSING_PREVIEW_HOST" };
  }

  // The configured value is Morph's own setting, so it is held to the
  // platform's ordinary hostname rules.
  const hostname = normalizeStorefrontHostname(configuredPreviewHostname);
  if (!hostname) {
    return { enabled: false, reason: "INVALID_PREVIEW_HOST" };
  }

  if (collectPlatformHostnames(env).has(hostname)) {
    return { enabled: false, reason: "PLATFORM_PREVIEW_HOST" };
  }

  return { enabled: true, hostname };
}

/**
 * Checks that a URL handed back by a container really is a preview on the
 * configured host before the editor will frame it.
 *
 * The runner already refuses to start on the wrong host. This is the second
 * check, on the other side of the boundary: the editor should not frame a URL
 * merely because something told it to.
 *
 * The host is compared by label rather than run back through
 * `normalizeStorefrontHostname`, because a preview label legitimately carries
 * shapes that a storefront hostname may not — a Cloudflare preview token is
 * allowed to contain underscores, and rejecting it here would refuse a URL
 * that is perfectly valid.
 */
export function validateExposedPreviewUrl({
  url,
  hostname,
  env,
}: {
  url: string;
  hostname: string;
  env: Record<string, unknown> | undefined;
}): ExposedPreviewUrlResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "INVALID_PREVIEW_URL" };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: "INVALID_PREVIEW_URL" };
  }
  if (parsed.protocol !== "https:") {
    // Theme code and editor messages travel over this. A downgrade to http
    // would expose the preview capability in the URL to anyone on the path.
    return { ok: false, reason: "INSECURE_PREVIEW_URL" };
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  // A strict subdomain, never the host itself: the bare host is the Worker,
  // not a sandbox, and framing it would frame Morph.
  if (!host.endsWith(`.${hostname}`) || host.length <= hostname.length + 1) {
    return { ok: false, reason: "PREVIEW_URL_OFF_HOST" };
  }

  if (collectPlatformHostnames(env).has(host)) {
    return { ok: false, reason: "PLATFORM_PREVIEW_HOST" };
  }

  return { ok: true, url: parsed.toString(), origin: parsed.origin };
}
