import type { ResolvedStorefrontHost } from "./storefront-host-resolver";

function toScriptNameSegment(value: string, label: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (!normalized || normalized.length > 54) {
    throw new Error(`${label}: "${value}" cannot form a Worker script name.`);
  }
  return normalized;
}

/**
 * Stable Worker script name that a storefront's service binding points at.
 *
 * The binding is declared in configuration and cannot be swapped per request,
 * so the deployed script name must not change between releases. Which build the
 * script currently contains is reconciled from `storefronts.active_release_id`
 * by the deployment plane — the deployed bytes follow the SSOT rather than
 * becoming a second one.
 */
export function themeWorkerScriptNameForStorefront(storefrontId: string): string {
  return `morph-theme-${toScriptNameSegment(storefrontId, "INVALID_STOREFRONT_ID")}`;
}

/**
 * Deterministic Worker script name for one immutable Theme build.
 *
 * Only used by the Workers for Platforms transport, where each build is its own
 * dispatchable script and activation is a pointer change. Kept separate from the
 * storefront-stable name so the two topologies cannot silently share a target.
 */
export function themeWorkerScriptName(themeBuildId: string): string {
  return `morph-theme-${toScriptNameSegment(themeBuildId, "INVALID_THEME_BUILD_ID")}`;
}

export type ThemeRuntimeFailureReason =
  | "RUNTIME_NOT_CONFIGURED"
  | "SCRIPT_NOT_DEPLOYED"
  | "RUNTIME_ERROR";

/**
 * Why a service binding could not be resolved for a storefront. A fixed code,
 * never the configured value, so it can be logged as-is.
 */
export type ThemeServiceBindingUnmappedSubcode =
  | "MAP_MALFORMED"
  | "ENTRY_MISSING"
  | "BINDING_ABSENT";

/**
 * Which part of the runtime configuration is missing, as a fixed code the
 * caller can log without carrying any configured value or free text.
 */
export type ThemeRuntimeNotConfigured =
  | Readonly<{ code: "NO_TRANSPORT" }>
  | Readonly<{ code: "DISPATCH_UNBOUND" }>
  | Readonly<{
      code: "BINDING_UNMAPPED";
      subcode: ThemeServiceBindingUnmappedSubcode;
    }>;

export type ThemeRuntimeFailure =
  | {
      success: false;
      reason: "RUNTIME_NOT_CONFIGURED";
      status: number;
      message: string;
      notConfigured: ThemeRuntimeNotConfigured;
    }
  | {
      success: false;
      reason: Exclude<ThemeRuntimeFailureReason, "RUNTIME_NOT_CONFIGURED">;
      status: number;
      message: string;
    };

export type ThemeRuntimeResult =
  | { success: true; response: Response }
  | ThemeRuntimeFailure;

export type ThemeRuntimeInvocation = Readonly<{
  request: Request;
  resolved: ResolvedStorefrontHost;
  /**
   * The signed render context Core issued for this page request
   * (`storefront-render-context.ts`), sent to the Theme so its content reads
   * stay on this request's release. Absent when Core has no signing secret.
   */
  renderContext?: string;
}>;

/**
 * Executes the released Theme Worker for one production request.
 *
 * Host resolution, authorization and the artifact contract are identical for
 * every implementation; only the transport to the Theme Worker differs. An
 * implementation must never resolve releases, read the theme workspace or
 * relax the fail-closed behaviour of the caller.
 */
export interface ThemeRuntime {
  readonly kind:
    | "service-binding"
    | "dispatch-namespace"
    | "local-direct"
    | "unavailable";
  handle(invocation: ThemeRuntimeInvocation): Promise<ThemeRuntimeResult>;
}
