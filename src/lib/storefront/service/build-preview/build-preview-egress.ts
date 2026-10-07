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
  /** Where each decision is recorded; `console.info` unless given. */
  log?: (line: string) => void;
}>;

/**
 * Lines one container may write, per isolate. A Theme can make as many
 * requests as it likes, and each would otherwise be a log line; a decision
 * is worth seeing, a flood of them is not.
 */
const MAX_LINES_PER_CONTAINER = 20;
const MAX_TRACKED_CONTAINERS = 200;
const linesByContainer = new Map<string, number>();

function destinationOf(request: Request): string {
  try {
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}`;
  } catch {
    // Never the path or query, where data travels.
    return "unknown";
  }
}

/**
 * Records one decision: answered or refused, the destination's scheme and
 * host, and the container — so an operator can see a preview reach its
 * content, or why it did not.
 */
function record(
  containerId: string,
  request: Request,
  decision: string,
  log: (line: string) => void,
): void {
  const key = containerId.slice(0, 64);
  const written = linesByContainer.get(key) ?? 0;
  if (written >= MAX_LINES_PER_CONTAINER) return;
  if (
    !linesByContainer.has(key) &&
    linesByContainer.size >= MAX_TRACKED_CONTAINERS
  ) {
    const oldest = linesByContainer.keys().next().value;
    if (oldest !== undefined) linesByContainer.delete(oldest);
  }
  linesByContainer.set(key, written + 1);
  log(
    `[build-preview-egress] ${JSON.stringify({
      container: key.slice(0, 12),
      destination: destinationOf(request),
      decision,
    })}`,
  );
}

function refuse(request: Request, reason: string): Response {
  const destination = destinationOf(request);
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
  const log = deps.log ?? ((line: string) => console.info(line));
  const refused = (reason: string) => {
    record(containerId, request, `refused: ${reason}`, log);
    return refuse(request, reason);
  };
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return refused("not a URL");
  }
  const token = buildPreviewTokenFromHost(url.host, deps.env);
  if (!token || url.pathname !== "/_morph/content") {
    return refused("not this preview's content");
  }
  const verified = await verifyBuildPreviewCapability({
    dal: deps.capabilityDal,
    token,
    now: deps.now,
  });
  if (!verified.ok) return refused(verified.reason);
  if (deps.containerIdFor(verified.capability.id) !== containerId) {
    return refused("another preview's content");
  }
  record(containerId, request, "answered: own content", log);
  return serveBuildPreviewContent({
    request,
    capability: verified.capability,
    ports: deps.contentPorts,
  });
}
