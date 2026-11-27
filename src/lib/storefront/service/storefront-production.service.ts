import { applyLibrarySvgHeaders } from "@/lib/asset/svg-delivery";
import type { R2BucketLike } from "../compiler/cloudflare-r2-theme-build-artifact-store";
import type { CanonicalThemeStaticPage } from "../compiler/theme-build-artifact-store.types";
import {
  normalizedPagePath,
  readRegisteredStaticPages,
} from "../compiler/theme-static-page-reader";
import {
  lookupPublishedMedia,
  parsePublishedMediaPath,
  type PublishedMediaPorts,
} from "./storefront-media-delivery";
import {
  PRODUCTION_ARTIFACT_POLICY,
  sanitizeArtifactPath,
  serveThemeArtifact,
} from "./theme-artifact-server";
import {
  resolveStorefrontHost,
  type ResolvedStorefrontHost,
  type StorefrontHostResolverDeps,
} from "./storefront-host-resolver";
import {
  resolveStorefrontContent,
  type ContentRuntimePorts,
} from "./storefront-content-runtime";
import {
  signStorefrontRenderContext,
  STOREFRONT_RENDER_CONTEXT_HEADER,
  verifyStorefrontRenderContext,
} from "./storefront-render-context";
import type {
  ThemeRuntime,
  ThemeRuntimeFailure,
  ThemeRuntimeNotConfigured,
} from "./theme-runtime.types";
import { isolateSvgResponse, isSvgContentType } from "../theme-svg-isolation";
import { withoutPlatformCookies } from "./preview-proxy-credentials";
import { carriesPlatformCredentialCookie } from "@/lib/auth/platform-cookies";
import { refuseCrossOriginWrite } from "@/server/same-origin-write";

/**
 * A customer write on a storefront host that carries the platform session
 * cookie must come from that storefront's own origin (same-origin-write.ts),
 * as cookie-carrying writes to the Core Store API must. The cookie is
 * ambient, so a page on another host of the same site would otherwise send it
 * with a `text/plain` POST, which needs no preflight.
 *
 * The allowed origin is the request's own: this host was resolved from the
 * request by routing as an active storefront domain, so it is the store's,
 * not a value the sender picks. Writes with no platform cookie are not
 * checked: they carry no session to ride on (an order transfer's accept and
 * decline are authorised by their token).
 */
async function refuseCredentialedCrossOriginWrite(
  request: Request,
): Promise<Response | null> {
  return carriesPlatformCredentialCookie(request.headers)
    ? refuseCrossOriginWrite(request)
    : null;
}

const DEFAULT_CLIENT_ASSETS_DIRECTORY = "runtime/client";
const STOREFRONT_AUTH_POST_PATHS = new Set([
  "/sign-in/email",
  "/sign-up/email",
  "/sign-out",
  "/email-otp/send-verification-otp",
  "/email-otp/verify-email",
  "/email-otp/reset-password",
]);

const STOREFRONT_CUSTOMER_PATH =
  /^customers\/me(?:\/addresses(?:\/[A-Za-z0-9_-]{1,128})?|\/orders(?:\/[A-Za-z0-9_-]{1,128}(?:\/(?:returns(?:\/[A-Za-z0-9_-]{1,128})?|returnable-items|claims|exchanges))?)?)?$/;

/**
 * Platform-owned path a Theme reads its published content from.
 *
 * Served by Morph Core rather than the Theme Worker: only Morph Core knows
 * which release is active, and content must come from that release's immutable
 * publication, never from a draft.
 */
export const STOREFRONT_CONTENT_PATH = "/_morph/content";

/**
 * Reads the client assets directory from the canonical manifest.
 *
 * The artifact store maps the runner's `metadata` onto the canonical `runtime`
 * block before persisting, and D1 stores the canonical shape — so production
 * must read `runtime`, not `metadata`.
 */
function readClientAssetsDirectory(resolved: ResolvedStorefrontHost): string {
  const runtime = resolved.manifest?.runtime;
  const value = runtime?.clientAssetsDirectory;
  if (typeof value === "string" && value.trim() !== "") {
    return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  }
  return DEFAULT_CLIENT_ASSETS_DIRECTORY;
}

function errorResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * What a shopper sees when the Theme runtime cannot serve the request.
 *
 * Fixed copy: it names no variable, binding, origin or reason. What an
 * operator needs goes to the server log as a fixed code instead.
 */
export const THEME_RUNTIME_UNAVAILABLE_PUBLIC_MESSAGE =
  "This store is temporarily unavailable. Please try again later.";

/** Fixed operator hint per not-configured code. Never built from env values. */
const THEME_RUNTIME_NOT_CONFIGURED_HINTS: Record<
  ThemeRuntimeNotConfigured["code"],
  string
> = {
  NO_TRANSPORT:
    "Set THEME_WORKER, or MORPH_LOCAL_THEME_ORIGIN for local development.",
  BINDING_UNMAPPED:
    "Map this storefront in MORPH_THEME_SERVICE_BINDINGS to a declared service binding.",
  DISPATCH_UNBOUND: "Bind THEME_DISPATCHER to the dispatch namespace.",
};

export const THEME_RUNTIME_FAILURE_LOG_LABEL =
  "[storefront] Theme runtime failure";

/**
 * The one place a failed Theme runtime result becomes a public response.
 *
 * A not-configured failure keeps the runtime's status and the standard error
 * headers, sends fixed public copy, and logs one line of fixed fields: a code,
 * the runtime kind, the status, the storefront id, and allow-listed fields
 * (sub-code, operator hint). The runtime's free-text message is never logged
 * or sent for this class.
 *
 * Other reasons still pass their message through unchanged; moving them onto
 * the same fixed-code path is a separate follow-up.
 */
function themeRuntimeFailureResponse(
  failure: ThemeRuntimeFailure,
  runtimeKind: ThemeRuntime["kind"],
  resolved: ResolvedStorefrontHost,
): Response {
  if (failure.reason !== "RUNTIME_NOT_CONFIGURED") {
    return errorResponse(failure.status, failure.message);
  }
  const { notConfigured } = failure;
  console.error(THEME_RUNTIME_FAILURE_LOG_LABEL, {
    code: notConfigured.code,
    ...(notConfigured.code === "BINDING_UNMAPPED"
      ? { subcode: notConfigured.subcode }
      : {}),
    runtime: runtimeKind,
    status: failure.status,
    storefrontId: resolved.storefrontId,
    hint: THEME_RUNTIME_NOT_CONFIGURED_HINTS[notConfigured.code],
  });
  return errorResponse(failure.status, THEME_RUNTIME_UNAVAILABLE_PUBLIC_MESSAGE);
}

export const STATIC_PAGE_FAILURE_LOG_LABEL =
  "[storefront] Static page unavailable";

/** Fixed public copy; what an operator needs goes to the log as a code. */
export const STATIC_PAGE_UNAVAILABLE_MESSAGE =
  "SSG_ARTIFACT_UNAVAILABLE: This page is temporarily unavailable. Please try again later.";

/**
 * The registered page a request path names: `/about`, `/about/` and
 * `/about/index.html` are one page, as are `/` and `/index.html`.
 */
function matchRegisteredStaticPage(
  pages: readonly CanonicalThemeStaticPage[],
  pathname: string,
): CanonicalThemeStaticPage | null {
  let path: string;
  try {
    path = sanitizeArtifactPath(pathname);
  } catch {
    return null;
  }
  if (path === "index.html") path = "";
  else if (path.endsWith("/index.html")) {
    path = path.slice(0, -"/index.html".length);
  }
  const key = path === "" ? "/" : `/${path}`;
  return pages.find((page) => normalizedPagePath(page.path) === key) ?? null;
}

function privateSameOriginResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const name of Array.from(headers.keys())) {
    if (name.toLowerCase().startsWith("access-control-")) headers.delete(name);
  }
  headers.set("Cache-Control", "private, no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * What every Theme Worker response on a storefront host is sent with until
 * ISR ships: no shared cache, and no browser copy, may keep it.
 *
 * Core cannot tell from a Theme's answer whether it was personalised (a
 * session, a cart, a `Set-Cookie`) or which release it was rendered from, so
 * a Theme's own `Cache-Control` or CDN header could put one shopper's page,
 * or an old release's, in Cloudflare's edge for everyone. ISR will allow an
 * author's TTL again only for public GET and HEAD responses Core has
 * verified, keyed by storefront and release.
 */
export const THEME_RESPONSE_CACHE_CONTROL = "private, no-store";

/** Headers that would let a CDN cache a response beyond `Cache-Control`. */
const THEME_CDN_CACHE_HEADERS = [
  "CDN-Cache-Control",
  "Cloudflare-CDN-Cache-Control",
  "Surrogate-Control",
] as const;

/**
 * Applies THEME_RESPONSE_CACHE_CONTROL to a Theme Worker response, whatever
 * its status, and drops the CDN cache headers. Only headers change: the body
 * stream is handed on unread, so a streamed render stays streamed. `ETag` and
 * `Last-Modified` are kept; with `no-store` nothing stores them.
 *
 * A WebSocket upgrade is passed on untouched: it is answered with its socket,
 * is never cached, and a rebuilt 101 response cannot be constructed.
 */
function withThemeResponseCachePolicy(response: Response): Response {
  if (
    response.status === 101 ||
    (response as { webSocket?: unknown }).webSocket
  ) {
    return response;
  }
  const headers = new Headers(response.headers);
  for (const name of THEME_CDN_CACHE_HEADERS) headers.delete(name);
  headers.set("Cache-Control", THEME_RESPONSE_CACHE_CONTROL);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export type StorefrontProductionServiceOptions = Readonly<{
  runtime: ThemeRuntime;
  r2Bucket?: R2BucketLike;
  resolverDeps?: StorefrontHostResolverDeps;
  contentPorts?: ContentRuntimePorts;
  /** Required to serve published CMS media on the merchant hostname. */
  mediaPorts?: PublishedMediaPorts;
  catalogHandler?: (
    request: Request,
    resolved: ResolvedStorefrontHost,
  ) => Promise<Response | null>;
  /** Better Auth endpoints allowed on the resolved, first-party store host. */
  storefrontAuthHandler?: (
    request: Request,
    resolved: ResolvedStorefrontHost,
  ) => Promise<Response>;
  /** Customer-owned Store API paths, with identity resolved from the session cookie. */
  storefrontCustomerApiHandler?: (
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    request: Request,
    resolved: ResolvedStorefrontHost,
  ) => Promise<Response | null>;
  /** The one token-authorized Store API mutation exposed on merchant hosts. */
  orderTransferConfirmationHandler?: (
    request: Request,
    resolved: ResolvedStorefrontHost,
    orderId: string,
    action: "accept" | "decline",
  ) => Promise<Response | null>;
  /**
   * Signs the render context that pins a page render's content reads to the
   * release its page request resolved (G3). Without it no context is issued,
   * and a content read that carries one is refused, since it cannot be
   * checked.
   */
  renderContextSecret?: string;
  /** Milliseconds since the epoch; a test clock. */
  now?: () => number;
}>;

/**
 * Production storefront request handler.
 *
 * Request path:
 *   hostname -> active release -> immutable build artifact
 *     -> client asset from R2, or the released Theme Worker.
 *
 * Static assets are served through the same artifact core the editor preview
 * uses, so the manifest boundary and path sanitization cannot diverge between
 * the two planes. Anything not declared as a client asset is a page request and
 * belongs to the Theme Worker; the service never renders a fallback page, since
 * substituting one would present an unavailable release as a working store.
 */
export class StorefrontProductionService {
  constructor(private readonly options: StorefrontProductionServiceOptions) {}

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const resolution = await resolveStorefrontHost(
      request.headers.get("host") ?? url.hostname,
      this.options.resolverDeps,
    );

    if (!resolution.success) {
      return errorResponse(resolution.status, resolution.message);
    }

    const resolved = resolution.value;

    if (url.pathname === "/api/auth" || url.pathname.startsWith("/api/auth/")) {
      const authPath = url.pathname.slice("/api/auth".length);
      const allowed =
        (request.method === "GET" && authPath === "/get-session") ||
        (request.method === "POST" && STOREFRONT_AUTH_POST_PATHS.has(authPath));
      if (!allowed) return errorResponse(404, "Not found.");
      if (!this.options.storefrontAuthHandler) {
        return errorResponse(503, "Storefront authentication unavailable.");
      }
      return privateSameOriginResponse(
        await this.options.storefrontAuthHandler(request, resolved),
      );
    }

    const customerApiPath = /^\/api\/store\/customers\/me(?:\/|$)/.test(
      url.pathname,
    );
    if (customerApiPath) {
      if (!STOREFRONT_CUSTOMER_PATH.test(
        url.pathname.replace(/^\/api\/store\//, "").replace(/\/$/, ""),
      )) {
        return errorResponse(404, "Not found.");
      }
      if (
        request.method !== "GET" &&
        request.method !== "POST" &&
        request.method !== "PATCH" &&
        request.method !== "DELETE"
      ) {
        return errorResponse(405, "Method not allowed.");
      }
      const refused = await refuseCredentialedCrossOriginWrite(request);
      if (refused) return refused;
      if (!this.options.storefrontCustomerApiHandler) {
        return errorResponse(503, "Store customer API unavailable.");
      }
      const response = await this.options.storefrontCustomerApiHandler(
        request.method,
        url.pathname.replace(/^\/api\/store\//, "").replace(/\/$/, ""),
        request,
        resolved,
      );
      return response
        ? privateSameOriginResponse(response)
        : errorResponse(404, "Not found.");
    }

    const transferPath =
      /^\/api\/store\/orders\/([A-Za-z0-9_-]{1,128})\/transfer\/(request|accept|decline|cancel)$/.exec(
        url.pathname,
      );
    if (
      transferPath ||
      /^\/api\/store\/orders\/[^/]+\/transfer(?:\/|$)/.test(url.pathname)
    ) {
      if (!transferPath) return errorResponse(404, "Not found.");
      if (request.method !== "POST") {
        return errorResponse(405, "Method not allowed.");
      }
      const refused = await refuseCredentialedCrossOriginWrite(request);
      if (refused) return refused;
      const action = transferPath[2] as
        | "request"
        | "accept"
        | "decline"
        | "cancel";
      if (action === "request" || action === "cancel") {
        if (!this.options.storefrontCustomerApiHandler) {
          return errorResponse(503, "Store customer API unavailable.");
        }
        const response = await this.options.storefrontCustomerApiHandler(
          "POST",
          `orders/${transferPath[1]}/transfer/${action}`,
          request,
          resolved,
        );
        return response
          ? privateSameOriginResponse(response)
          : errorResponse(404, "Not found.");
      }
      if (!this.options.orderTransferConfirmationHandler) {
        return errorResponse(503, "Order transfer confirmation unavailable.");
      }
      const response = await this.options.orderTransferConfirmationHandler(
        request,
        resolved,
        transferPath[1]!,
        action,
      );
      return response
        ? privateSameOriginResponse(response)
        : errorResponse(404, "Not found.");
    }

    // Merchant hosts never enter the dashboard router. Only resolved catalog,
    // account/authentication, and transfer capabilities are exposed here.
    if (/^\/api\/store\/(?:products(?:\/|$)|assets\/)/.test(url.pathname)) {
      if (request.method !== "GET")
        return errorResponse(405, "Method not allowed.");
      if (!this.options.catalogHandler)
        return errorResponse(503, "Catalog unavailable.");
      return (
        (await this.options.catalogHandler(request, resolved)) ??
        errorResponse(404, "Not found.")
      );
    }

    if (url.pathname === STOREFRONT_CONTENT_PATH) {
      return this.serveContent(request, url, resolved);
    }

    const mediaAssetId = parsePublishedMediaPath(url.pathname);
    if (mediaAssetId) {
      return this.servePublishedMedia(request, mediaAssetId, resolved);
    }

    if (request.method === "GET" || request.method === "HEAD") {
      const page = await this.tryServeStaticPage(request, url, resolved);
      if (page) return page;
      const asset = await this.tryServeClientAsset(request, url, resolved);
      if (asset) return asset;
    }

    const runtimeResult = await this.options.runtime.handle({
      request,
      resolved,
      renderContext: this.options.renderContextSecret
        ? await signStorefrontRenderContext({
            pin: {
              storefrontId: resolved.storefrontId,
              hostname: resolved.hostname,
              releaseId: resolved.releaseId,
              contentPublicationId: resolved.contentPublicationId,
            },
            secret: this.options.renderContextSecret,
            now: this.now(),
          })
        : undefined,
    });
    if (!runtimeResult.success) {
      return themeRuntimeFailureResponse(
        runtimeResult,
        this.options.runtime.kind,
        resolved,
      );
    }
    // A Theme route may answer with an SVG of its own; it is isolated like
    // any other the storefront sends. Its Set-Cookie may not carry a platform
    // credential's name either, as in Live and Build Preview: defence in depth
    // for server-set cookies. Theme code in the browser can still write
    // document.cookie or send Clear-Site-Data; this does not cover that.
    // Whatever the Theme said about caching, nothing may store it (until ISR).
    return withThemeResponseCachePolicy(
      withoutPlatformCookies(isolateSvgResponse(runtimeResult.response)),
    );
  }

  /**
   * Serves the published content for one route of the active release.
   *
   * Immutable for a given release, so it is cached hard and keyed by the
   * release id: a new release changes the URL's meaning only through a new
   * release id, and rollback restores the previous content without a purge.
   */
  private async serveContent(
    request: Request,
    url: URL,
    resolved: ResolvedStorefrontHost,
  ): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return errorResponse(405, "Method not allowed.");
    }
    if (!this.options.contentPorts) {
      return errorResponse(503, "Storefront content is not configured.");
    }

    const requestedPath = url.searchParams.get("path") ?? "/";
    if (requestedPath.length > 500 || !requestedPath.startsWith("/")) {
      return errorResponse(400, "Invalid content path.");
    }

    // A read made while rendering a page names the release that page was
    // resolved to (G3). It is served from that release even if another one
    // has gone live since; a context that does not verify is refused rather
    // than read as the active release. A read without one — a browser's own
    // navigation fetch — is a new request, and gets the active release.
    const renderContext = request.headers.get(STOREFRONT_RENDER_CONTEXT_HEADER);
    let pinned: { releaseId: string; publicationId: string | null } | null =
      null;
    if (renderContext !== null) {
      const verification = this.options.renderContextSecret
        ? await verifyStorefrontRenderContext({
            token: renderContext,
            secret: this.options.renderContextSecret,
            now: this.now(),
            storefrontId: resolved.storefrontId,
            hostname: resolved.hostname,
          })
        : null;
      if (!verification?.ok) {
        return errorResponse(
          409,
          "RENDER_CONTEXT_INVALID: this content read's render context cannot be verified.",
        );
      }
      pinned = {
        releaseId: verification.pin.releaseId,
        publicationId: verification.pin.contentPublicationId,
      };
    }

    const content = await resolveStorefrontContent({
      publicationId: pinned ? pinned.publicationId : resolved.contentPublicationId,
      pathname: requestedPath,
      ports: this.options.contentPorts,
    });

    return new Response(JSON.stringify(content), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // Content is immutable within a release; the release id is the version.
        // A pinned read answers for one render, not for the URL: it must not
        // be stored and served to a read naming no release, or another one.
        "Cache-Control": pinned
          ? "private, no-store"
          : "public, max-age=60, must-revalidate",
        ETag: `"${pinned ? pinned.releaseId : resolved.releaseId}:${requestedPath}"`,
        // Both answers depend on the render-context header: a cache keyed on
        // the URL alone must not answer a pinned read with the active one.
        Vary: STOREFRONT_RENDER_CONTEXT_HEADER,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  /**
   * Serves a CMS asset that the active release published.
   *
   * Authorised by the publication rather than by a session: a visitor may read
   * exactly the media the live release refers to, and nothing else in the
   * library. The asset is only looked up after that check, so an unpublished id
   * cannot be used to find out whether it exists.
   */
  private async servePublishedMedia(
    request: Request,
    assetId: string,
    resolved: ResolvedStorefrontHost,
  ): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return errorResponse(405, "Method not allowed.");
    }
    if (!this.options.mediaPorts || !this.options.r2Bucket) {
      return errorResponse(503, "Storefront media is not configured.");
    }

    const lookup = await lookupPublishedMedia({
      assetId,
      storageKey: new URL(request.url).searchParams.get("version"),
      publicationId: resolved.contentPublicationId,
      ports: this.options.mediaPorts,
    });
    // Both cases answer the same way: whether an asset exists is not something
    // an unpublished id should be able to distinguish.
    if (lookup.status !== "found") return errorResponse(404, "Not found.");

    const object = await this.options.r2Bucket.get(lookup.storageKey);
    if (!object) return errorResponse(404, "Not found.");

    const headers = new Headers();
    // The stored asset row is the type authority; R2 metadata is a fallback
    // for objects written before a type was recorded.
    const contentType =
      lookup.contentType ??
      object.httpMetadata?.contentType ??
      "application/octet-stream";
    headers.set("Content-Type", contentType);
    // Bytes are immutable for an asset id, and the release id keeps a rollback
    // from serving a stale cache entry under the same URL.
    headers.set("Cache-Control", "public, max-age=300, must-revalidate");
    headers.set(
      "ETag",
      `"${resolved.releaseId}:${encodeURIComponent(lookup.storageKey)}"`,
    );
    headers.set("X-Content-Type-Options", "nosniff");
    // Never inline: a stored SVG is script-capable, and this route has no
    // session to lose but the storefront's own origin to protect. Isolated
    // too, whatever its stored verdict.
    if (isSvgContentType(headers.get("Content-Type"))) {
      applyLibrarySvgHeaders(headers, null, { inlineAllowed: false });
    }

    if (request.headers.get("if-none-match") === headers.get("ETag")) {
      return new Response(null, { status: 304, headers });
    }

    return new Response(request.method === "HEAD" ? null : object.body, {
      status: 200,
      headers,
    });
  }

  /**
   * Serves a page the active release registered as static HTML, or returns
   * `null` when the path is not one.
   *
   * The page list is the one frozen in the active release's build manifest
   * (theme-static-pages.ts), so publish, a later publish and a rollback each
   * change which HTML answers by changing `active_release_id` alone. The
   * bytes come from that build's immutable artifact through the shared
   * artifact core. The ETag names the release and the HTML's hash, and a
   * 304 is only answered after the active release was resolved, so an old
   * validator never revalidates another release's page.
   *
   * A registered page Core cannot serve is an error, never the Theme
   * Worker's SSR: the production Theme Worker was deployed without this
   * HTML, and a silent SSR answer would present a broken release as working.
   */
  private async tryServeStaticPage(
    request: Request,
    url: URL,
    resolved: ResolvedStorefrontHost,
  ): Promise<Response | null> {
    const registered = readRegisteredStaticPages(resolved.manifest);
    // Intended: a release whose registration cannot be read cannot say which
    // paths are static, so every GET and HEAD of that release answers 503,
    // its JS and CSS included, until another release is active.
    if (!registered.ok) {
      console.error(STATIC_PAGE_FAILURE_LOG_LABEL, {
        storefrontId: resolved.storefrontId,
        releaseId: resolved.releaseId,
        themeBuildId: resolved.themeBuildId,
        reason: "REGISTRATION_INVALID",
      });
      return errorResponse(503, STATIC_PAGE_UNAVAILABLE_MESSAGE);
    }
    if (registered.pages.length === 0) return null;
    const page = matchRegisteredStaticPage(registered.pages, url.pathname);
    if (!page) return null;

    const served = await serveThemeArtifact({
      request,
      artifactPrefix: resolved.artifactPrefix,
      manifest: resolved.manifest,
      artifactPath: page.artifactPath,
      r2Bucket: this.options.r2Bucket,
      policy: PRODUCTION_ARTIFACT_POLICY,
      etagScope: `ssg:${resolved.releaseId}`,
      verifySize: true,
    });
    if (!served.success) {
      console.error(STATIC_PAGE_FAILURE_LOG_LABEL, {
        storefrontId: resolved.storefrontId,
        releaseId: resolved.releaseId,
        themeBuildId: resolved.themeBuildId,
        reason: served.failure.kind,
        page: page.path,
      });
      return errorResponse(503, STATIC_PAGE_UNAVAILABLE_MESSAGE);
    }
    if (request.method === "HEAD") {
      return new Response(null, {
        status: served.response.status,
        headers: served.response.headers,
      });
    }
    return served.response;
  }

  /**
   * Serves a declared client asset, or returns `null` when the path is not one,
   * in which case the request is a page request for the Theme Worker.
   */
  private async tryServeClientAsset(
    request: Request,
    url: URL,
    resolved: ResolvedStorefrontHost,
  ): Promise<Response | null> {
    let requestedPath: string;
    try {
      requestedPath = sanitizeArtifactPath(url.pathname);
    } catch {
      // A traversal-shaped path is never a valid asset; refuse rather than
      // handing an attacker-shaped path to the Theme Worker.
      return errorResponse(400, "Invalid asset path.");
    }
    if (requestedPath === "") return null;
    // Prerendered page HTML is never a plain asset. A registered page was
    // answered by the release dispatch above; any other `index.html` is a
    // page request, so a build's HTML cannot shadow the page's real mode.
    if (requestedPath === "index.html" || requestedPath.endsWith("/index.html")) {
      return null;
    }

    const assetsDirectory = readClientAssetsDirectory(resolved);
    const candidate = `${assetsDirectory}/${requestedPath}`;

    const files = Array.isArray(resolved.manifest?.files)
      ? resolved.manifest.files
      : [];
    if (!files.some((file) => file.path === candidate)) return null;

    const served = await serveThemeArtifact({
      request,
      artifactPrefix: resolved.artifactPrefix,
      manifest: resolved.manifest,
      artifactPath: candidate,
      r2Bucket: this.options.r2Bucket,
      policy: PRODUCTION_ARTIFACT_POLICY,
    });

    if (!served.success) {
      return errorResponse(served.failure.status, served.failure.message);
    }
    return served.response;
  }
}
