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
import {
  BuildPreviewInstanceUnavailableError,
  type BuildPreviewServer,
} from "./build-preview-server.types";

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

/** Seconds before the browser asks again for an instance that is starting. */
export const BUILD_PREVIEW_STARTING_RETRY_SECONDS = 3;
/**
 * How many page loads in a row may find the container unavailable before
 * the page stops reloading and says so. Each load already asks the
 * container twice, so five loads span roughly 20 seconds — the failure seen
 * was over by the next request, and a container that is still not starting
 * after that is not going to by itself (a broken image looks exactly like a
 * transient failure from here).
 */
export const BUILD_PREVIEW_START_MAX_ATTEMPTS = 5;
/**
 * The reload's attempt counter, on the address the starting page reloads.
 * Core's own: removed before the request reaches the instance, and a page
 * load carrying it is redirected to the address without it once the instance
 * answers, so the Theme never sees it — not in the request, not in
 * `location`. A counter on the address rather than a record or a cookie:
 * it belongs to that one frame's loads and leaves nothing behind.
 */
export const BUILD_PREVIEW_START_ATTEMPT_PARAM = "__morph_bp_start";

/** The address without the attempt counter, other parameters byte-for-byte. */
function withoutAttemptParam(url: URL): {
  url: URL;
  attempt: number | null;
} {
  if (!url.search) return { url, attempt: null };
  let attempt: number | null = null;
  const kept = url.search
    .slice(1)
    .split("&")
    .filter((pair) => {
      const [key, value = ""] = pair.split("=");
      if (key !== BUILD_PREVIEW_START_ATTEMPT_PARAM) return true;
      const parsed = Number.parseInt(value, 10);
      attempt = Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
      return false;
    });
  if (attempt === null) return { url, attempt: null };
  const clean = new URL(url);
  clean.search = kept.length ? `?${kept.join("&")}` : "";
  return { url: clean, attempt };
}

function isPageLoad(request: Request): boolean {
  const destination = request.headers.get("sec-fetch-dest");
  return (
    request.method === "GET" &&
    (destination === "document" ||
      destination === "iframe" ||
      (!destination &&
        (request.headers.get("accept") ?? "").includes("text/html")))
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * The address as a path on this same origin, for everything Core sends the
 * browser to (the redirect, the reload, the "try again" link). The request's
 * own pathname is not one: `//evil.example/x` is a valid pathname and, used as
 * a URL, a different host. Leading slashes collapse to one, so it can only
 * ever be a path here.
 */
function sameOriginPath(url: URL): string {
  return `/${url.pathname.replace(/^\/+/, "")}${url.search}`;
}

/**
 * The answer while the instance's container could not be started: 503 with
 * `Retry-After`, and for a page load a document that loads the same address
 * again — the editor's frame is cross-origin and cannot tell an error page
 * from the Theme's, so without this the user stayed on the error until they
 * reloaded by hand. Up to `BUILD_PREVIEW_START_MAX_ATTEMPTS` loads; then the
 * page stops and names the failure by its code, with a link to try again.
 * The document is Core's own: no script, nothing loaded from anywhere
 * (`default-src 'none'`), and only this address to go to.
 */
function starting(request: Request, url: URL, attempt: number): Response {
  const headers = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex",
  };
  if (!isPageLoad(request)) {
    return new Response(
      "BUILD_PREVIEW_STARTING: the preview is starting; retry shortly.",
      {
        status: 503,
        headers: {
          ...headers,
          "retry-after": String(BUILD_PREVIEW_STARTING_RETRY_SECONDS),
          "content-type": "text/plain; charset=utf-8",
        },
      },
    );
  }
  const htmlHeaders = {
    ...headers,
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": "default-src 'none'",
  };
  if (attempt >= BUILD_PREVIEW_START_MAX_ATTEMPTS) {
    return new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Preview unavailable</title></head><body><p>BUILD_PREVIEW_CONTAINER_UNAVAILABLE: the preview could not be started.</p><p><a href="${escapeHtml(sameOriginPath(url))}">Try again</a></p></body></html>`,
      { status: 503, headers: htmlHeaders },
    );
  }
  const next = new URL(url);
  next.search = `${url.search ? `${url.search}&` : "?"}${BUILD_PREVIEW_START_ATTEMPT_PARAM}=${attempt + 1}`;
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="${BUILD_PREVIEW_STARTING_RETRY_SECONDS}; url=${escapeHtml(sameOriginPath(next))}"><title>Starting preview</title></head><body><p>The preview is starting. This page reloads by itself.</p></body></html>`,
    {
      status: 503,
      headers: {
        ...htmlHeaders,
        "retry-after": String(BUILD_PREVIEW_STARTING_RETRY_SECONDS),
      },
    },
  );
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
  // The starting page's attempt counter never reaches the instance.
  const { url: forwardUrl, attempt } = withoutAttemptParam(url);
  try {
    const response = await answerFromInstance(
      request,
      forwardUrl,
      capability,
      selection.server,
      deps,
    );
    if (attempt !== null && isPageLoad(request)) {
      // Started: load the address without the counter, so the Theme's page
      // does not find it in `location` either. The instance is running now;
      // the next load is answered by it.
      await response.body?.cancel();
      return new Response(null, {
        status: 302,
        headers: {
          location: sameOriginPath(forwardUrl),
          "cache-control": "no-store",
          "x-robots-tag": "noindex",
        },
      });
    }
    return response;
  } catch (error) {
    if (!(error instanceof BuildPreviewInstanceUnavailableError)) throw error;
    console.warn(
      JSON.stringify({
        scope: "storefront.build-preview.instance-unavailable",
        capabilityId: capability.id,
        buildId: capability.buildId,
        attempt: attempt ?? 1,
        message: error.message,
      }),
    );
    return starting(request, forwardUrl, attempt ?? 1);
  }
}

/** The instance's answer, starting it first when there is none. */
async function answerFromInstance(
  request: Request,
  url: URL,
  capability: VerifiedBuildPreviewCapability,
  server: BuildPreviewServer,
  deps: BuildPreviewRequestDeps,
): Promise<Response> {
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
