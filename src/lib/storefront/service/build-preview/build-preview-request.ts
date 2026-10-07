import { isolateSvgResponse } from "@/lib/storefront/theme-svg-isolation";
import type { R2BucketLike } from "../../compiler/cloudflare-r2-theme-build-artifact-store";
import type { StorefrontBuildPreviewCapabilityDAL } from "../../dal/storefront-build-preview-capability.dal";
import {
  previewRequestHeaders,
  withoutPlatformCookies,
} from "../preview-proxy-credentials";
import type { ContentRuntimePorts } from "../storefront-content-runtime";
import {
  readBuildPreviewArtifact,
  type BuildPreviewBuildRecord,
} from "./build-preview-artifact";
import {
  buildPreviewTokenFromHost,
  verifyBuildPreviewCapability,
  type BuildPreviewCapabilityRefusal,
  type VerifiedBuildPreviewCapability,
} from "./build-preview-capability";
import { serveBuildPreviewContent } from "./build-preview-content";
import type { BuildPreviewServerSelection } from "./build-preview-server.factory";
import type { BuildPreviewServer } from "./build-preview-server.types";

/**
 * Core's handling of a request on a Build Preview host.
 *
 * Every request, the document and each sub-resource alike, is verified
 * against its capability before anything else happens; nothing is cached
 * between requests. Then:
 *
 * - `/_morph/content` is Core's own, answered from the build's content
 *   snapshot. It never reaches the instance, so a Theme cannot answer it
 *   for itself.
 * - everything else goes to the capability's instance, started on demand
 *   from the build's verified artifact (the first request, or the first after
 *   an idle stop). On the way, the platform's cookies and every `x-morph-*`
 *   header the browser sent are removed, and Core states the build's identity
 *   in the headers a published Theme reads; on the way back a cookie under a
 *   platform name is dropped and SVG is isolated, as on a storefront.
 */

export type BuildPreviewRequestDeps = Readonly<{
  env: Record<string, unknown>;
  capabilityDal: StorefrontBuildPreviewCapabilityDAL;
  readBuild(buildId: string): Promise<BuildPreviewBuildRecord | null>;
  r2Bucket: R2BucketLike | undefined;
  contentPorts: ContentRuntimePorts;
  server(): BuildPreviewServerSelection;
  now?: Date;
}>;

const REFUSAL_STATUS: Record<BuildPreviewCapabilityRefusal, number> = {
  CAPABILITY_UNKNOWN: 404,
  CAPABILITY_REVOKED: 410,
  CAPABILITY_EXPIRED: 410,
  BUILD_NOT_PREVIEWABLE: 409,
  RELEASE_NOT_PREVIEWABLE: 409,
  USER_NOT_AUTHORIZED: 403,
};

function plain(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex",
    },
  });
}

/**
 * Where the instance connects for `contentOrigin` when it runs on this
 * machine: Core's own port on loopback, because `bp-<token>.preview.localhost`
 * does not resolve from Node. `localhost` rather than an address, so it is
 * whichever loopback the dev server is listening on.
 */
function localContentUpstream(url: URL): string {
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return `${url.protocol}//localhost:${port}`;
}

/**
 * The origin the Theme is told to read its content from.
 *
 * Locally, the preview host as the browser reached it: the instance's egress
 * connects there through Core's loopback. In a container, the same host on
 * its scheme's default port: the container's outbound policy answers the
 * request inside the Worker without any network, and only ports 80 and 443
 * reach that policy at all — the first real run, on a dev server's port,
 * had the Theme's content request refused by the network before the policy
 * ever saw it, and the page fell back to its defaults without a word.
 */
export function buildPreviewContentOrigin(
  url: URL,
  kind: BuildPreviewServer["kind"],
): string {
  return kind === "cloudflare-sandbox"
    ? `${url.protocol}//${url.hostname}`
    : url.origin;
}

function forwardedRequest(
  request: Request,
  url: URL,
  capability: VerifiedBuildPreviewCapability,
  body: ArrayBuffer | null,
  contentOrigin: string,
): Request {
  const headers = previewRequestHeaders(request.headers);
  headers.set("x-morph-storefront-host", url.host);
  headers.set("x-morph-content-origin", contentOrigin);
  headers.set("x-morph-storefront-id", capability.storefrontId);
  headers.set("x-morph-theme-build-id", capability.buildId);
  if (capability.contentPublicationId) {
    headers.set(
      "x-morph-content-publication-id",
      capability.contentPublicationId,
    );
  }
  return new Request(url.href, {
    method: request.method,
    headers,
    body,
    redirect: "manual",
  });
}

/** The response for a Build Preview host, or null when this is not one. */
export async function handleBuildPreviewRequest(
  request: Request,
  deps: BuildPreviewRequestDeps,
): Promise<Response | null> {
  const url = new URL(request.url);
  const token = buildPreviewTokenFromHost(
    request.headers.get("host") ?? url.host,
    deps.env,
  );
  if (!token) return null;

  const verified = await verifyBuildPreviewCapability({
    dal: deps.capabilityDal,
    token,
    now: deps.now,
  });
  if (!verified.ok) {
    return plain(
      REFUSAL_STATUS[verified.reason],
      `${verified.reason}: this Build Preview address cannot be used.`,
    );
  }
  const { capability } = verified;

  if (url.pathname === "/_morph/content") {
    return serveBuildPreviewContent({
      request,
      capability,
      ports: deps.contentPorts,
    });
  }

  const selection = deps.server();
  if (!selection.enabled) {
    return plain(503, `${selection.reason}: ${selection.message}`);
  }
  const { server } = selection;
  const contentOrigin = buildPreviewContentOrigin(url, server.kind);

  // Read once: a request may have to be sent twice, before and after a start.
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? null
      : await request.arrayBuffer();
  const send = () =>
    server.fetch(
      capability.id,
      forwardedRequest(request, url, capability, body, contentOrigin),
    );

  let response = await send();
  if (!response) {
    const build = await deps.readBuild(capability.buildId);
    if (!build || !deps.r2Bucket) {
      return plain(
        503,
        "BUILD_PREVIEW_ARTIFACT_UNAVAILABLE: the build's files cannot be read.",
      );
    }
    const artifact = await readBuildPreviewArtifact({
      build,
      r2Bucket: deps.r2Bucket,
    });
    if (!artifact.ok) {
      return plain(409, `${artifact.reason}: ${artifact.message}`);
    }
    await server.start({
      instanceId: capability.id,
      artifact: artifact.artifact,
      contentOrigin,
      ...(server.kind === "local-sidecar"
        ? { contentUpstream: localContentUpstream(url) }
        : {}),
    });
    response = await send();
    if (!response) {
      return plain(
        503,
        "BUILD_PREVIEW_NOT_RUNNING: the preview stopped as it started.",
      );
    }
  }
  const answered = withoutPlatformCookies(isolateSvgResponse(response));
  const headers = new Headers(answered.headers);
  headers.set("x-robots-tag", "noindex");
  const nullBody = [101, 204, 205, 304].includes(answered.status);
  return new Response(nullBody ? null : answered.body, {
    status: answered.status,
    statusText: answered.statusText,
    headers,
  });
}
