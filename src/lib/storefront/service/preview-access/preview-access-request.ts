import type { StorefrontPreviewAccessDAL } from "../../dal/storefront-preview-access.dal";
import { normalizeStorefrontHostname } from "../storefront-host-resolver";
import { readPreviewAccessCandidates } from "./preview-access-cookies";
import {
  PREVIEW_ACCESS_BEGIN_PATH,
  PREVIEW_ACCESS_REDEEM_PATH,
  previewAccessBegin,
  previewAccessRedeem,
} from "./preview-access-pages";
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
  const parent =
    normalizePreviewParentHostname(previewParentHostname) ??
    previewParentHostname.toLowerCase();
  return `${LABEL_PREFIX}${previewId}.${parent}`;
}

/** The configured preview parent, normalised the one way every caller uses. */
export function normalizePreviewParentHostname(
  previewParentHostname: string | null | undefined,
): string | null {
  return previewParentHostname
    ? normalizeStorefrontHostname(previewParentHostname)
    : null;
}

/** The `pv-` label directly under the preview parent, whatever its id. */
function previewAccessLabel(
  hostname: string,
  previewParentHostname: string | null,
): string | null {
  const parent = normalizePreviewParentHostname(previewParentHostname);
  if (!parent) return null;
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host.endsWith(`.${parent}`)) return null;
  const label = host.slice(0, host.length - parent.length - 1);
  return label.startsWith(LABEL_PREFIX) && !label.includes(".") ? label : null;
}

/** The preview id a `pv-` host names, or null when the host is not one. */
export function parsePreviewAccessHost(
  hostname: string,
  previewParentHostname: string | null,
): string | null {
  const label = previewAccessLabel(hostname, previewParentHostname);
  if (!label) return null;
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
  /**
   * Whether an origin is exactly one of Morph's own app origins (scheme,
   * host and port): the only parent a begin page talks to.
   */
  isAppOrigin(origin: string): boolean;
  now?: () => Date;
}>;

/** The message a refused preview document sends its editor; it carries no secret. */
export const PREVIEW_ACCESS_ENDED_MESSAGE = "morph:preview-access-ended";

/**
 * A refusal, shaped for whoever asked. A document loading in the editor's
 * frame tells the editor, so it can offer Retry at once rather than wait for
 * its load watchdog; every other request gets plain text. Neither carries a
 * Theme byte.
 */
function refusalResponse(
  request: Request,
  status: number,
  reason: string,
  body: string,
  extra: Record<string, string> = {},
): Response {
  const destination = request.headers.get("sec-fetch-dest");
  if (destination !== "iframe" && destination !== "document") {
    return plainResponse(status, body, extra);
  }
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const message = JSON.stringify({
    type: PREVIEW_ACCESS_ENDED_MESSAGE,
    reason,
  }).replace(/</g, "\\u003c");
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Preview</title><p>${body.replace(/[<&]/g, "")}</p>` +
      // Posted to any parent: it names only that access ended, and the
      // editor checks the frame window and origin it came from.
      `<script nonce="${nonce}">if(parent!==window)parent.postMessage(${message},"*");</script>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'`,
        ...extra,
      },
    },
  );
}

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
  if (!previewAccessLabel(url.hostname, deps.previewParentHostname))
    return null;
  const previewId = parsePreviewAccessHost(
    url.hostname,
    deps.previewParentHostname,
  );
  // A `pv-` label that names no preview is still the preview domain's: it is
  // answered here, never by the rest of the Worker.
  if (!previewId) return plainResponse(404, "Not found.");

  if (url.pathname.startsWith(PREVIEW_ACCESS_AUTH_PATH_PREFIX)) {
    // The authorization flow's own pages. Nothing under this path ever
    // reaches the Theme.
    const pages = {
      dal: deps.dal,
      isAppOrigin: deps.isAppOrigin,
      ...(deps.now ? { now: deps.now } : {}),
    };
    try {
      if (url.pathname === PREVIEW_ACCESS_BEGIN_PATH) {
        return await previewAccessBegin(request, pages);
      }
      if (url.pathname === PREVIEW_ACCESS_REDEEM_PATH) {
        return await previewAccessRedeem(request, pages);
      }
    } catch {
      return plainResponse(503, "Preview access cannot be checked right now.", {
        "Retry-After": "5",
      });
    }
    return plainResponse(404, "Not found.");
  }

  // A socket must be opened by this preview's own documents: a Theme on
  // another preview host shares the cookie jar, not the origin.
  if (
    request.headers.get("upgrade")?.toLowerCase() === "websocket" &&
    request.headers.get("origin") !== url.origin
  ) {
    return plainResponse(403, "Preview access required.");
  }

  const candidates = readPreviewAccessCandidates(request.headers.get("cookie"));
  if (candidates.kind === "overflow") {
    observe?.({ kind: "refused", reason: "OVERFLOW" });
    // Refused, never served from a chosen subset (addendum A4.1).
    return refusalResponse(
      request,
      431,
      "OVERFLOW",
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
    return refusalResponse(
      request,
      503,
      "UNAVAILABLE",
      "Preview access cannot be checked right now.",
      { "Retry-After": "5" },
    );
  }
  if (!verified.ok) {
    observe?.({ kind: "refused", reason: verified.reason });
    return refusalResponse(
      request,
      refusalStatus(verified.reason),
      verified.reason,
      "Preview access required. Open this preview from the editor.",
    );
  }
  // The grant names its host, and the host names this preview; both must
  // agree, so a grant can never open another preview's container.
  if (verified.grant.previewId !== previewId) {
    observe?.({ kind: "refused", reason: "HOST_MISMATCH" });
    return refusalResponse(
      request,
      403,
      "HOST_MISMATCH",
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
