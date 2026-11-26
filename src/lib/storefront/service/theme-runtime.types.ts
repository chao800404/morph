import type { ResolvedStorefrontHost } from "./storefront-host-resolver";

function toScriptNameSegment(value: string, label: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (!normalized || normalized.length > 54) {
    throw new Error(`${label}: "${value}" cannot form a Worker script name.`);
  }
  return normalized;
}

/**
 * The variable that moves a deployment's storefront Theme Worker scripts off
 * the default `morph-theme-` names. Script names are unique per Cloudflare
 * account, and the first storefront on every fresh D1 gets the same fixed id,
 * so a second Morph deployment in the same account (staging) would otherwise
 * replace the first one's Theme Worker on publish.
 */
export const THEME_WORKER_SCRIPT_PREFIX_VAR = "MORPH_THEME_WORKER_SCRIPT_PREFIX";

/** The prefix every deployment uses when the variable is not set. */
export const DEFAULT_THEME_WORKER_SCRIPT_PREFIX = "morph-theme-";

/** Cloudflare's limit on a Worker script name (Wrangler's own check). */
export const WORKER_SCRIPT_NAME_MAX_LENGTH = 63;

/**
 * Longest accepted prefix: 63 minus the 36 characters of a UUID storefront id,
 * so every UUID storefront fits under any accepted prefix.
 */
export const THEME_WORKER_SCRIPT_PREFIX_MAX_LENGTH = 27;

/**
 * Starts with a letter, ends with the `-` that separates it from the storefront
 * segment, and uses only what a Worker name may contain. Mirrored by
 * `scripts/theme-runtime-wiring-scan.mjs`.
 */
const THEME_WORKER_SCRIPT_PREFIX_SHAPE = /^[a-z][a-z0-9-]*-$/;

export type ThemeWorkerScriptPrefixResult =
  | { ok: true; prefix: string }
  | { ok: false; message: string };

/**
 * Checks a configured prefix. Fails closed: an invalid value is refused and
 * never replaced by the default, because the default is exactly the name the
 * variable exists to avoid.
 *
 * A prefix starting with `morph-theme-` is refused too: it would put the
 * deployment back inside the default namespace, where `morph-theme-stg-` plus
 * storefront `a` and the default prefix plus storefront `stg-a` name the same
 * script.
 */
export function validateThemeWorkerScriptPrefix(
  value: unknown,
): ThemeWorkerScriptPrefixResult {
  const invalid = (reason: string): ThemeWorkerScriptPrefixResult => ({
    ok: false,
    message: `${THEME_WORKER_SCRIPT_PREFIX_VAR} is invalid: ${reason} Theme Worker deployment is refused until it is fixed or removed.`,
  });
  if (typeof value !== "string") return invalid("it is not a string.");
  if (
    value.length < 2 ||
    value.length > THEME_WORKER_SCRIPT_PREFIX_MAX_LENGTH
  ) {
    return invalid(
      `it must be 2 to ${THEME_WORKER_SCRIPT_PREFIX_MAX_LENGTH} characters long.`,
    );
  }
  if (!THEME_WORKER_SCRIPT_PREFIX_SHAPE.test(value)) {
    return invalid(
      "it must start with a lowercase letter, contain only lowercase letters, digits and dashes, and end with a dash.",
    );
  }
  if (value.startsWith(DEFAULT_THEME_WORKER_SCRIPT_PREFIX)) {
    return invalid(
      `it must not start with the default "${DEFAULT_THEME_WORKER_SCRIPT_PREFIX}"; leave it unset to use the default.`,
    );
  }
  return { ok: true, prefix: value };
}

/**
 * The storefront Theme Worker script prefix this environment deploys under:
 * the default when the variable is absent, otherwise the validated value.
 */
export function resolveThemeWorkerScriptPrefix(
  env: Readonly<Record<string, unknown>> | undefined,
): ThemeWorkerScriptPrefixResult {
  const raw = env?.[THEME_WORKER_SCRIPT_PREFIX_VAR];
  if (raw === undefined) {
    return { ok: true, prefix: DEFAULT_THEME_WORKER_SCRIPT_PREFIX };
  }
  return validateThemeWorkerScriptPrefix(raw);
}

/**
 * Stable Worker script name that a storefront's service binding points at.
 *
 * The binding is declared in configuration and cannot be swapped per request,
 * so the deployed script name must not change between releases. Which build the
 * script currently contains is reconciled from `storefronts.active_release_id`
 * by the deployment plane — the deployed bytes follow the SSOT rather than
 * becoming a second one.
 *
 * With the default prefix the name and its checks are exactly what they were
 * before the prefix existed. A configured prefix is validated again here, and
 * the whole name must fit Cloudflare's 63-character limit.
 */
export function themeWorkerScriptNameForStorefront(
  storefrontId: string,
  prefix: string = DEFAULT_THEME_WORKER_SCRIPT_PREFIX,
): string {
  const segment = toScriptNameSegment(storefrontId, "INVALID_STOREFRONT_ID");
  if (prefix === DEFAULT_THEME_WORKER_SCRIPT_PREFIX) {
    return `morph-theme-${segment}`;
  }
  const checked = validateThemeWorkerScriptPrefix(prefix);
  if (!checked.ok) throw new Error(checked.message);
  const name = `${checked.prefix}${segment}`;
  if (name.length > WORKER_SCRIPT_NAME_MAX_LENGTH) {
    throw new Error(
      `INVALID_STOREFRONT_ID: "${storefrontId}" under ${THEME_WORKER_SCRIPT_PREFIX_VAR} "${checked.prefix}" makes a ${name.length}-character Worker script name; the limit is ${WORKER_SCRIPT_NAME_MAX_LENGTH}.`,
    );
  }
  return name;
}

/**
 * Deterministic Worker script name for one immutable Theme build.
 *
 * Only used by the Workers for Platforms transport, where each build is its own
 * dispatchable script and activation is a pointer change. Kept separate from the
 * storefront-stable name so the two topologies cannot silently share a target.
 *
 * `MORPH_THEME_WORKER_SCRIPT_PREFIX` does not apply here: these scripts live
 * inside a dispatch namespace, whose names are scoped to that namespace, and
 * nothing in Morph uploads them yet.
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
