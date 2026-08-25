import type { ResolvedStorefrontHost } from "./storefront-host-resolver";
import {
  themeWorkerScriptName,
  type ThemeRuntime,
  type ThemeRuntimeInvocation,
  type ThemeRuntimeResult,
} from "./theme-runtime.types";

/** Minimal shape of a Worker-to-Worker service binding. */
export type ThemeServiceBinding = Readonly<{
  fetch(request: Request): Promise<Response>;
}>;

export type ThemeServiceBindingResolver = (
  resolved: ResolvedStorefrontHost,
) => ThemeServiceBinding | null | undefined;

/**
 * Copies the resolved storefront identity onto the forwarded request.
 *
 * The Theme Worker is bound statically and cannot resolve releases itself, so
 * Morph Core states which storefront and release this request belongs to. These
 * headers are set (not merged) so a client cannot spoof them from the outside.
 */
function applyStorefrontContext(
  request: Request,
  resolved: ResolvedStorefrontHost,
): Request {
  const forwarded = new Request(request);
  forwarded.headers.set("x-morph-storefront-host", resolved.hostname);
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

  constructor(private readonly resolveBinding: ThemeServiceBindingResolver) {}

  async handle(invocation: ThemeRuntimeInvocation): Promise<ThemeRuntimeResult> {
    const binding = this.resolveBinding(invocation.resolved);
    if (!binding || typeof binding.fetch !== "function") {
      return {
        success: false,
        reason: "RUNTIME_NOT_CONFIGURED",
        status: 503,
        message: `No Theme Worker service binding is configured for storefront "${invocation.resolved.storefrontId}".`,
      };
    }

    try {
      const response = await binding.fetch(
        applyStorefrontContext(invocation.request, invocation.resolved),
      );
      return { success: true, response };
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
      const response = await stub.fetch(invocation.request);
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
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async handle(invocation: ThemeRuntimeInvocation): Promise<ThemeRuntimeResult> {
    let target: URL;
    try {
      const incoming = new URL(invocation.request.url);
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
    );

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
    };
  }
}
