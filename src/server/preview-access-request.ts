import { env } from "cloudflare:workers";
import { storefrontPreviewAccessDal } from "@/lib/storefront/dal/storefront-preview-access.dal";
import { handlePreviewAccessRequest } from "@/lib/storefront/service/preview-access/preview-access-request";
import { isMorphAppOrigin } from "@/lib/storefront/service/preview-access/preview-access-app-origin";
import { previewRequestFor } from "@/lib/storefront/service/preview-proxy-credentials";
import { currentPreviewSdkUrl } from "./preview-access-sandbox";

/**
 * The `pv-` preview host's composition root: the handler with this Worker's
 * bindings. Null when the request is not for one.
 *
 * A verified request reaches the container the way every Live Preview
 * request does today: through the Sandbox SDK's own preview proxy, so its
 * running-state and activity bookkeeping are unchanged. The SDK address with
 * its port token is read from the preview's own Durable Object for each
 * request and used only inside this Worker; the browser is never given it.
 */
export function servePreviewAccessRequest(
  request: Request,
  /** Sends a request addressed to the SDK host into its container. */
  forwardToSandbox: (request: Request) => Promise<Response | null>,
): Promise<Response | null> {
  const bindings = env as unknown as Record<string, unknown>;
  const previewParentHostname =
    typeof bindings.THEME_PREVIEW_HOSTNAME === "string"
      ? bindings.THEME_PREVIEW_HOSTNAME
      : null;
  return handlePreviewAccessRequest(request, {
    previewParentHostname,
    dal: storefrontPreviewAccessDal,
    stripCredentials: previewRequestFor,
    isAppOrigin: (origin) =>
      isMorphAppOrigin(origin, bindings, import.meta.env.DEV),
    forward: async (previewId, verified) => {
      if (!previewParentHostname) return null;
      const exposedUrl = await currentPreviewSdkUrl(
        bindings,
        previewId,
        previewParentHostname,
      );
      if (!exposedUrl) return null;
      const target = new URL(verified.url);
      const internal = new URL(exposedUrl);
      target.protocol = internal.protocol;
      target.host = internal.host;
      return forwardToSandbox(new Request(target, verified));
    },
  });
}
