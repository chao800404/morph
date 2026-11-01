import { getSandbox } from "@cloudflare/sandbox";
import { THEME_PREVIEW_SERVER_PORT } from "@/lib/storefront/compiler/cloudflare-sandbox-vite-preview-server";
import {
  parsePreviewAccessHost,
  previewAccessHostname,
} from "@/lib/storefront/service/preview-access/preview-access-request";
import { previewSandboxBinding } from "@/lib/storefront/service/preview-sandbox-binding";

/**
 * The one place a `pv-` preview host and the Sandbox SDK's own address for
 * the same preview meet.
 *
 * The SDK address carries its port token and changes whenever the port is
 * exposed again; the `pv-` address is stable and carries nothing. The editor
 * frames the `pv-` one. Inside the Worker, a verified request, or a check of
 * whether the framed preview still answers, is translated to the current SDK
 * address here, and that address never leaves the Worker.
 */

/** The preview's current SDK address for the Live Preview port, or null. */
export async function currentPreviewSdkUrl(
  bindings: Record<string, unknown>,
  previewId: string,
  previewParentHostname: string,
): Promise<string | null> {
  const sandbox = getSandbox(
    previewSandboxBinding(bindings) as never,
    previewId,
    { normalizeId: true },
  ) as unknown as {
    getExposedPorts(
      hostname: string,
    ): Promise<Array<{ port: number; url: string }>>;
  };
  const exposed = (await sandbox.getExposedPorts(previewParentHostname)).find(
    (entry) => entry.port === THEME_PREVIEW_SERVER_PORT,
  );
  return exposed?.url ?? null;
}

/** The `pv-` origin the editor frames for an SDK address, same scheme and port. */
export function previewAccessOriginFor(
  sdkUrl: string,
  previewId: string,
  previewParentHostname: string,
): string {
  const url = new URL(sdkUrl);
  url.hostname = previewAccessHostname(previewId, previewParentHostname);
  return url.origin;
}

/**
 * The SDK origin a framed `pv-` origin stands for, for the server-side checks
 * that compare against the SDK's address. Any other origin is returned as it
 * is; a `pv-` origin for another preview, or one whose port is not exposed,
 * is null, and answers as not serving.
 */
export async function sdkOriginForFramed(
  bindings: Record<string, unknown>,
  framedOrigin: string,
  previewId: string,
  previewParentHostname: string,
): Promise<string | null> {
  let hostname: string;
  try {
    hostname = new URL(framedOrigin).hostname;
  } catch {
    return framedOrigin;
  }
  const named = parsePreviewAccessHost(hostname, previewParentHostname);
  if (named === null) return framedOrigin;
  if (named !== previewId) return null;
  const sdkUrl = await currentPreviewSdkUrl(
    bindings,
    previewId,
    previewParentHostname,
  );
  if (!sdkUrl) return null;
  // The framed scheme and port are the editor's (loopback rewrites them);
  // only the host is the SDK's.
  const framed = new URL(framedOrigin);
  framed.hostname = new URL(sdkUrl).hostname;
  return framed.origin;
}
