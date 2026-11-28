import { previewRequestFor } from "./preview-proxy-credentials";
import type { ResolvedStorefrontHost } from "./storefront-host-resolver";
import { STOREFRONT_RENDER_CONTEXT_HEADER } from "./storefront-render-context";
import {
  themeWorkerScriptName,
  type ThemeRuntime,
  type ThemeRuntimeInvocation,
  type ThemeRuntimeResult,
  type ThemeServiceBindingUnmappedSubcode,
} from "./theme-runtime.types";
import {
  EXPECTED_THEME_BUILD_HEADER,
  themeWorkerBuildMismatch,
} from "./theme-worker-build-match";

/** Minimal shape of a Worker-to-Worker service binding. */
export type ThemeServiceBinding = Readonly<{
  fetch(request: Request): Promise<Response>;
}>;

/**
 * A resolver's answer: the binding to use, or a fixed code saying why there is
 * none (never the configured map or binding name).
 *
 * The outcome is carried by `ok` on this wrapper, which Core builds itself,
 * and never read off the binding. A real Cloudflare service binding is a
 * `Fetcher` RPC stub: in workerd (compatibility date 2026-03-24) it answers
 * `true` to `"<any name>" in binding` and returns a callable for every
 * property, so any `in`, property or shape probe on it — such as the former
 * `"unmapped" in value` — reads the live Theme Worker binding as a miss.
 */
export type ThemeServiceBindingResolution =
  | Readonly<{ ok: true; binding: ThemeServiceBinding }>
  | Readonly<{ ok: false; unmapped: ThemeServiceBindingUnmappedSubcode }>;

/** Returns which binding serves a resolved storefront, or why none does. */
export type ThemeServiceBindingResolver = (
  resolved: ResolvedStorefrontHost,
) => ThemeServiceBindingResolution;

/**
 * Copies the resolved storefront identity onto the forwarded request.
 *
 * The Theme Worker is bound statically and cannot resolve releases itself, so
 * Morph Core states which storefront and release this request belongs to. These
 * headers are set (not merged) so a client cannot spoof them from the outside.
 *
 * Before that, the request is reduced to what Theme code may see, by the same
 * rule Live Preview applies: platform credential cookies are removed from
 * `cookie` (the Theme's own cookies pass, in order) and every inbound
 * `x-morph-*` header is dropped, so no name Core may later give meaning to
 * can arrive from a browser. `Authorization` is removed only when it is a
 * Morph secret API key in the Basic form the Admin API accepts (a syntactic
 * check, no lookup); every other value is the Theme's and is forwarded, as it
 * is to a preview. Filtering comes first so it can never remove a header Core
 * sets below.
 */
function applyStorefrontContext(
  request: Request,
  resolved: ResolvedStorefrontHost,
  /**
   * Origin Morph Core was reached on, taken from the invocation rather than
   * from `request`: a transport may already have rewritten the URL to the
   * Theme's own address, and a Theme told to fetch content from there would
   * call itself and silently render defaults.
   */
  contentOrigin: string,
  /** The invocation's signed render context, when Core issued one. */
  renderContext: string | undefined,
): Request {
  const forwarded = previewRequestFor(request);
  forwarded.headers.set("x-morph-storefront-host", resolved.hostname);
  // Absolute origin the Theme calls back on for published content. Sent rather
  // than left to be rebuilt from the hostname: only Morph Core knows the scheme
  // and port it was actually reached on, and a Theme guessing "https://" plus a
  // bare hostname is wrong on every non-default port.
  forwarded.headers.set("x-morph-content-origin", contentOrigin);
  forwarded.headers.set("x-morph-storefront-id", resolved.storefrontId);
  forwarded.headers.set("x-morph-release-id", resolved.releaseId);
  forwarded.headers.set("x-morph-theme-build-id", resolved.themeBuildId);
  if (resolved.contentPublicationId) {
    forwarded.headers.set(
      "x-morph-content-publication-id",
      resolved.contentPublicationId,
    );
  } else {
    forwarded.headers.delete("x-morph-content-publication-id");
  }
  // The Theme's content reads send this back, so they stay on the release
  // resolved above even if a publish or rollback lands mid-render (G3).
  if (renderContext) {
    forwarded.headers.set(STOREFRONT_RENDER_CONTEXT_HEADER, renderContext);
  }
  return forwarded;
}

/**
 * Production transport for a single-tenant Morph deployment: forwards to the
 * Theme Worker deployed in the same Cloudflare account over a service binding.
 *
 * The binding target is a stable script name per storefront, so which build is
 * live is decided by what the deployment plane reconciled from
 * `storefronts.active_release_id` — never by this transport.
 */
export class ServiceBindingThemeRuntime implements ThemeRuntime {
  readonly kind = "service-binding" as const;

  constructor(
    private readonly resolveBinding: ThemeServiceBindingResolver,
    /**
     * The release/Worker build match (`theme-worker-build-match.ts`). Off
     * unless the server sets `MORPH_RELEASE_WORKER_MATCH=1`; off, requests
     * and answers pass exactly as before.
     */
    private readonly options: Readonly<{ releaseWorkerMatch?: boolean }> = {},
  ) {}

  async handle(invocation: ThemeRuntimeInvocation): Promise<ThemeRuntimeResult> {
    const resolution = this.resolveBinding(invocation.resolved);
    if (!resolution.ok) {
      return {
        success: false,
        reason: "RUNTIME_NOT_CONFIGURED",
        status: 503,
        message: `No Theme Worker service binding is configured for storefront "${invocation.resolved.storefrontId}".`,
        notConfigured: {
          code: "BINDING_UNMAPPED",
          subcode: resolution.unmapped,
        },
      };
    }
    const { binding } = resolution;

    try {
      const forwarded = applyStorefrontContext(
        invocation.request,
        invocation.resolved,
        new URL(invocation.request.url).origin,
        invocation.renderContext,
      );
      const matching = this.options.releaseWorkerMatch === true;
      // Set after the inbound filter, which drops every x-morph-* header a
      // browser sent, so only Core can ask a Worker to check its build.
      if (matching) {
        forwarded.headers.set(
          EXPECTED_THEME_BUILD_HEADER,
          invocation.resolved.themeBuildId,
        );
      }
      const response = await binding.fetch(forwarded);
      if (!matching) return { success: true, response };

      // Only the module's refusal is read; every other answer is the
      // Theme's and passes exactly as it came (theme-worker-build-match.ts,
      // threat model).
      const mismatch = themeWorkerBuildMismatch(response);
      if (mismatch === null) return { success: true, response };
      try {
        await response.body?.cancel();
      } catch {}
      return {
        success: false,
        reason: "RUNTIME_MISMATCH",
        status: 503,
        message: `The Theme Worker for storefront "${invocation.resolved.storefrontId}" does not run release "${invocation.resolved.releaseId}"'s build.`,
        mismatch,
      };
    } catch (error) {
      return {
        success: false,
        reason: "RUNTIME_ERROR",
        status: 502,
        message:
          error instanceof Error
            ? error.message
            : "Theme Worker service binding failed.",
      };
    }
  }
}

/** Minimal shape of a Workers for Platforms dispatch namespace binding. */
export type DispatchNamespaceBinding = Readonly<{
  get(
    scriptName: string,
    args?: unknown,
    options?: unknown,
  ): { fetch(request: Request): Promise<Response> };
}>;

function isScriptNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("Worker not found") ||
    message.includes("script not found") ||
    message.includes("could not be found")
  );
}

/**
 * Production transport: dispatches into the Workers for Platforms namespace
 * that holds one uploaded script per immutable Theme build.
 */
export class DispatchNamespaceThemeRuntime implements ThemeRuntime {
  readonly kind = "dispatch-namespace" as const;

  constructor(private readonly binding?: DispatchNamespaceBinding) {}

  async handle(invocation: ThemeRuntimeInvocation): Promise<ThemeRuntimeResult> {
    if (!this.binding) {
      return {
        success: false,
        reason: "RUNTIME_NOT_CONFIGURED",
        status: 503,
        message: "Theme dispatch namespace binding is not configured.",
        notConfigured: { code: "DISPATCH_UNBOUND" },
      };
    }

    let scriptName: string;
    try {
      scriptName = themeWorkerScriptName(invocation.resolved.themeBuildId);
    } catch (error) {
      return {
        success: false,
        reason: "RUNTIME_ERROR",
        status: 500,
        message: error instanceof Error ? error.message : "Invalid script name.",
      };
    }

    try {
      const stub = this.binding.get(scriptName);
      // Same storefront context as every other transport: without it the Theme
      // has no content origin and renders component defaults, and a client could
      // supply its own x-morph-content-origin and have the Theme render content
      // fetched from an origin of their choosing.
      const response = await stub.fetch(
        applyStorefrontContext(
          invocation.request,
          invocation.resolved,
          new URL(invocation.request.url).origin,
          invocation.renderContext,
        ),
      );
      return { success: true, response };
    } catch (error) {
      if (isScriptNotFound(error)) {
        return {
          success: false,
          reason: "SCRIPT_NOT_DEPLOYED",
          status: 503,
          message: `Released Theme Worker "${scriptName}" is not deployed.`,
        };
      }
      return {
        success: false,
        reason: "RUNTIME_ERROR",
        status: 502,
        message:
          error instanceof Error
            ? error.message
            : "Theme Worker dispatch failed.",
      };
    }
  }
}

/**
 * Development transport: forwards to a Theme Worker already running locally
 * (for example under `wrangler dev`). The dispatch hop is the one part of the
 * production path with no local emulation, so this keeps the rest of the chain
 * — resolution, artifact contract, fail-closed behaviour — testable offline.
 *
 * It is not a second production path: it performs no resolution of its own and
 * must never be selected outside local development.
 */
export class LocalDirectThemeRuntime implements ThemeRuntime {
  readonly kind = "local-direct" as const;

  constructor(
    private readonly originUrl: string,
    /**
     * Wrapped rather than passed as a bare reference: the Workers runtime
     * requires `fetch` to be invoked with the global as its receiver, and
     * storing it on an instance would call it with the instance instead —
     * which fails at runtime with "Illegal invocation".
     */
    private readonly fetchImpl: typeof fetch = (input, init) =>
      fetch(input, init),
  ) {}

  async handle(invocation: ThemeRuntimeInvocation): Promise<ThemeRuntimeResult> {
    let target: URL;
    let incomingOrigin: string;
    try {
      const incoming = new URL(invocation.request.url);
      incomingOrigin = incoming.origin;
      target = new URL(this.originUrl);
      target.pathname = incoming.pathname;
      target.search = incoming.search;
    } catch (error) {
      return {
        success: false,
        reason: "RUNTIME_ERROR",
        status: 500,
        message:
          error instanceof Error
            ? error.message
            : "Invalid local theme runtime origin.",
      };
    }

    const forwarded = applyStorefrontContext(
      new Request(target, invocation.request),
      invocation.resolved,
      incomingOrigin,
      invocation.renderContext,
    );
    // This hop is local HTTP, not a production service binding. Wrangler's
    // automatic gzip can withhold a small SSR shell until its deferred stream
    // ends. Negotiate uncompressed bytes explicitly upstream; leave the
    // shopper's request and the returned stream untouched.
    forwarded.headers.set("accept-encoding", "identity");

    try {
      const response = await this.fetchImpl(forwarded);
      return { success: true, response };
    } catch (error) {
      return {
        success: false,
        reason: "RUNTIME_ERROR",
        status: 502,
        message:
          error instanceof Error
            ? error.message
            : "Local theme runtime is unreachable.",
      };
    }
  }
}

/**
 * Explicit fail-closed runtime for environments where no Theme Worker
 * transport is configured. Serving a degraded page instead would misrepresent
 * an unavailable capability as a working storefront.
 */
export class UnavailableThemeRuntime implements ThemeRuntime {
  readonly kind = "unavailable" as const;

  constructor(private readonly detail?: string) {}

  async handle(): Promise<ThemeRuntimeResult> {
    return {
      success: false,
      reason: "RUNTIME_NOT_CONFIGURED",
      status: 503,
      message:
        this.detail ??
        "No Theme Worker runtime is configured for this environment.",
      notConfigured: { code: "NO_TRANSPORT" },
    };
  }
}
