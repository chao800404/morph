import { env } from "cloudflare:workers";
import { getSandbox, proxyToSandbox } from "@cloudflare/sandbox";
import { THEME_PREVIEW_SERVER_PORT } from "@/lib/storefront/compiler/cloudflare-sandbox-vite-preview-server";
import { storefrontPreviewAccessDal } from "@/lib/storefront/dal/storefront-preview-access.dal";
import { handlePreviewAccessRequest } from "@/lib/storefront/service/preview-access/preview-access-request";
import { previewRequestFor } from "@/lib/storefront/service/preview-proxy-credentials";
import { collectPlatformHostnames } from "@/lib/storefront/service/storefront-request-routing";
import {
  finishPreviewResponse,
  proxyPreviewModuleRequest,
} from "@/lib/storefront/service/preview-proxy-response";
import {
  previewProxyEnv,
  previewSandboxBinding,
} from "@/lib/storefront/service/preview-sandbox-binding";

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
    isAppOrigin: (origin) => {
      const hostname = new URL(origin).hostname.toLowerCase();
      return collectPlatformHostnames(bindings).has(hostname);
    },
    forward: async (previewId, verified) => {
      if (!previewParentHostname) return null;
      const sandbox = getSandbox(
        previewSandboxBinding(bindings) as never,
        previewId,
        { normalizeId: true },
      ) as unknown as {
        getExposedPorts(
          hostname: string,
        ): Promise<Array<{ port: number; url: string }>>;
      };
      const exposed = (
        await sandbox.getExposedPorts(previewParentHostname)
      ).find((entry) => entry.port === THEME_PREVIEW_SERVER_PORT);
      if (!exposed) return null;
      const target = new URL(verified.url);
      const internal = new URL(exposed.url);
      target.protocol = internal.protocol;
      target.host = internal.host;
      const response = await proxyPreviewModuleRequest(
        new Request(target, verified),
        (moduleRequest) =>
          proxyToSandbox(moduleRequest, previewProxyEnv(bindings) as never),
      );
      return response ? finishPreviewResponse(response) : null;
    },
  });
}
