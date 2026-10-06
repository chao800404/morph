import type { StorefrontBuildPreviewCapabilityDAL } from "../../dal/storefront-build-preview-capability.dal";
import {
  PREVIEW_EGRESS_DENIED,
  PREVIEW_EGRESS_HEADER,
} from "../preview-egress-policy";
import type { ContentRuntimePorts } from "../storefront-content-runtime";
import {
  buildPreviewTokenFromHost,
  verifyBuildPreviewCapability,
} from "./build-preview-capability";
import { serveBuildPreviewContent } from "./build-preview-content";

/**
 * The outbound policy of a Build Preview container.
 *
 * The container has no internet of its own; every HTTP and HTTPS request it
 * makes is handed to this function, which runs in the Worker, outside the
 * container. Exactly one kind of request is answered: the Theme reading its
 * content, `GET <preview host>/_morph/content`, on the preview host of the
 * capability this very container serves. It is answered here, from the
 * build's content snapshot, without the request touching any network. Every
 * other request is refused with `PREVIEW_EGRESS_DENIED`.
 *
 * "This very container" is checked, not assumed: the token in the host is
 * verified like any request's, and the container it belongs to
 * (`containerIdFor(capability.id)`) must be the one asking. A Theme that
 * learned another preview's address still reads only its own content.
 */

export type BuildPreviewEgressDeps = Readonly<{
  env: Record<string, unknown>;
  capabilityDal: StorefrontBuildPreviewCapabilityDAL;
  contentPorts: ContentRuntimePorts;
  /** The container id a capability's instance runs in. */
  containerIdFor(capabilityId: string): string;
  now?: Date;
}>;

function refuse(request: Request, reason: string): Response {
  let destination = "unknown";
  try {
    const url = new URL(request.url);
    destination = `${url.protocol}//${url.host}`;
  } catch {
    // Left as "unknown": never the path or query, where data travels.
  }
  return new Response(
    `Build Preview outbound policy refused ${destination} (${PREVIEW_EGRESS_DENIED}: ${reason}). ` +
      "A Build Preview can read its own content and reach nothing else.\n",
    {
      status: 403,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        [PREVIEW_EGRESS_HEADER]: PREVIEW_EGRESS_DENIED,
      },
    },
  );
}

export async function answerBuildPreviewEgress(
  request: Request,
  containerId: string,
  deps: BuildPreviewEgressDeps,
): Promise<Response> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return refuse(request, "not a URL");
  }
  const token = buildPreviewTokenFromHost(url.host, deps.env);
  if (!token || url.pathname !== "/_morph/content") {
    return refuse(request, "not this preview's content");
  }
  const verified = await verifyBuildPreviewCapability({
    dal: deps.capabilityDal,
    token,
    now: deps.now,
  });
  if (!verified.ok) return refuse(request, verified.reason);
  if (deps.containerIdFor(verified.capability.id) !== containerId) {
    return refuse(request, "another preview's content");
  }
  return serveBuildPreviewContent({
    request,
    capability: verified.capability,
    ports: deps.contentPorts,
  });
}
