import type { StorefrontPreviewAccessDAL } from "../../dal/storefront-preview-access.dal";
import { normalizeStorefrontHostname } from "../storefront-host-resolver";
import { readPreviewAccessCandidates } from "./preview-access-cookies";
import {
  verifyPreviewAccessCandidates,
  type PreviewAccessRefusal,
  type VerifiedPreviewAccessGrant,
} from "./preview-access";

/**
 * The Live Preview host that asks for a credential on every request
 * (handoff/2026-10-28/preview-access-design.md §2, §5; #214 P2).
 *
 * `pv-<previewId>.<THEME_PREVIEW_HOSTNAME>` names one preview. Its address is
 * not a credential: each request must carry a grant cookie that verifies
 * against D1 — grant, session, user, role and Theme — at that request, so
 * signing out, a ban, a role change or a removed Theme refuses the next one.
 * Only then is the request, with every platform credential removed, sent on
 * to that preview's container.
 *
 * Failure is closed. No credential, a refused one, an over-full cookie set or
 * a D1 error is answered here with no Theme bytes, and never falls through to
 * the rest of the Worker.
 */

/** The flow-id-shaped preview id the host names (theme-preview-session-id.ts). */
const PREVIEW_ID = /^[0-9a-f]{32}$/;
const LABEL_PREFIX = "pv-";
/** Reserved for the authorization flow's own pages (P2b). */
export const PREVIEW_ACCESS_AUTH_PATH_PREFIX = "/__morph/preview-auth/";

/** The `pv-` hostname of one preview under the configured preview host. */
export function previewAccessHostname(
  previewId: string,
  previewParentHostname: string,
): string {
  return `${LABEL_PREFIX}${previewId}.${previewParentHostname}`;
}

/** The preview id a `pv-` host names, or null when the host is not one. */
export function parsePreviewAccessHost(
  hostname: string,
  previewParentHostname: string | null,
): string | null {
  const parent = previewParentHostname
    ? normalizeStorefrontHostname(previewParentHostname)
    : null;
  if (!parent) return null;
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host.endsWith(`.${parent}`)) return null;
  const label = host.slice(0, host.length - parent.length - 1);
  if (!label.startsWith(LABEL_PREFIX)) return null;
  const previewId = label.slice(LABEL_PREFIX.length);
  return PREVIEW_ID.test(previewId) ? previewId : null;
}

export type PreviewAccessRequestDeps = Readonly<{
  /** `THEME_PREVIEW_HOSTNAME`: the parent of every preview host. */
  previewParentHostname: string | null;
  dal: StorefrontPreviewAccessDAL;
  /**
   * Sends a verified request, already stripped of platform credentials, to
   * the named preview's container. Null when that preview is not running.
   */
  forward(previewId: string, request: Request): Promise<Response | null>;
  /** Removes platform credentials; the same rule every preview proxy uses. */
  stripCredentials(request: Request): Request;
  now?: () => Date;
}>;

/** What a refused request is told, by reason; never a Theme byte. */
function refusalStatus(reason: PreviewAccessRefusal): 401 | 403 {
  return reason === "GRANT_UNKNOWN" ? 401 : 403;
}

function plainResponse(
  status: number,
  body: string,
  extra: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}

/** A credentialed answer may never be stored, or leak its address onward. */
function credentialedResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
    ...("webSocket" in response && response.webSocket
      ? { webSocket: response.webSocket }
      : {}),
  } as ResponseInit);
}

export type PreviewAccessDecision =
  | Readonly<{ kind: "served"; grant: VerifiedPreviewAccessGrant }>
  | Readonly<{
      kind: "refused";
      reason: PreviewAccessRefusal | "OVERFLOW" | "UNAVAILABLE";
    }>;

/**
 * Answers a request on a `pv-` host, or null when the host is not one. The
 * decision is reported for observation only; it never changes the answer.
 */
export async function handlePreviewAccessRequest(
  request: Request,
  deps: PreviewAccessRequestDeps,
  observe?: (decision: PreviewAccessDecision) => void,
): Promise<Response | null> {
  const url = new URL(request.url);
  const previewId = parsePreviewAccessHost(
    url.hostname,
    deps.previewParentHostname,
  );
  if (!previewId) return null;

  if (url.pathname.startsWith(PREVIEW_ACCESS_AUTH_PATH_PREFIX)) {
    // The authorization flow's pages are not served yet; nothing under this
    // path may reach the Theme either.
    return plainResponse(404, "Not found.");
  }

  const candidates = readPreviewAccessCandidates(request.headers.get("cookie"));
  if (candidates.kind === "overflow") {
    observe?.({ kind: "refused", reason: "OVERFLOW" });
    // Refused, never served from a chosen subset (addendum A4.1).
    return plainResponse(
      431,
      "Too many preview sign-ins are stored in this browser. Sign out of the other sessions under Settings › Profile › Sessions, or sign out and sign in again, then choose Retry.",
    );
  }

  let verified: Awaited<ReturnType<typeof verifyPreviewAccessCandidates>>;
  try {
    verified = await verifyPreviewAccessCandidates({
      dal: deps.dal,
      tokens: candidates.tokens,
      previewHost: url.hostname.toLowerCase().replace(/\.$/, ""),
      ...(deps.now ? { clock: deps.now } : {}),
    });
  } catch {
    observe?.({ kind: "refused", reason: "UNAVAILABLE" });
    return plainResponse(503, "Preview access cannot be checked right now.", {
      "Retry-After": "5",
    });
  }
  if (!verified.ok) {
    observe?.({ kind: "refused", reason: verified.reason });
    return plainResponse(
      refusalStatus(verified.reason),
      "Preview access required. Open this preview from the editor.",
    );
  }
  // The grant names its host, and the host names this preview; both must
  // agree, so a grant can never open another preview's container.
  if (verified.grant.previewId !== previewId) {
    observe?.({ kind: "refused", reason: "HOST_MISMATCH" });
    return plainResponse(
      403,
      "Preview access required. Open this preview from the editor.",
    );
  }

  observe?.({ kind: "served", grant: verified.grant });
  let response: Response | null;
  try {
    response = await deps.forward(previewId, deps.stripCredentials(request));
  } catch {
    response = null;
  }
  if (!response) {
    return plainResponse(
      503,
      "This preview is not running. Retry Preview in the editor.",
      {
        "Retry-After": "5",
      },
    );
  }
  return credentialedResponse(response);
}
