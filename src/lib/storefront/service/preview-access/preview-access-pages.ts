import type { StorefrontPreviewAccessDAL } from "../../dal/storefront-preview-access.dal";
import {
  PREVIEW_ACCESS_BINDER_COOKIE_PREFIX,
  PREVIEW_ACCESS_GRANT_COOKIE_PREFIX,
  readPreviewAccessCandidates,
} from "./preview-access-cookies";
import {
  createPreviewAccessSecret,
  hashPreviewAccessSecret,
  redeemPreviewAccessExchange,
} from "./preview-access";

/**
 * The two pages of the authorization flow on a `pv-` host
 * (handoff/2026-10-28/preview-access-design.md §4a, addendum A1, A3).
 *
 * - **begin** sets this flow's binder cookie and tells the editor, the frame's
 *   parent, only the binder's hash. It then waits for the code the editor was
 *   issued for that hash, and submits it to redeem in a form body. The binder
 *   itself is never in a response body, a URL or a message.
 * - **redeem** consumes the code with the binder the browser presents, sets
 *   the grant cookie, and answers 303 to the preview path.
 *
 * Messages carry the flow id both ways, and each side checks the other's
 * window and origin, so a Theme document later loaded on the same host can
 * never obtain a code.
 */

export const PREVIEW_ACCESS_BEGIN_PATH = "/__morph/preview-auth/begin";
export const PREVIEW_ACCESS_REDEEM_PATH = "/__morph/preview-auth/redeem";
export const PREVIEW_ACCESS_BEGIN_MESSAGE = "morph:preview-auth-begin";
export const PREVIEW_ACCESS_CODE_MESSAGE = "morph:preview-auth-code";
export const PREVIEW_ACCESS_FAILED_MESSAGE = "morph:preview-auth-failed";

/** How long a binder cookie lives: two exchange lifetimes. */
const BINDER_MAX_AGE_S = 120;
/** A reused grant must have at least this long left (addendum A4.1). */
const REUSE_MIN_REMAINING_MS = 10 * 60_000;
const FLOW_ID = /^[0-9a-f]{32}$/;
const MAX_RETURN_LENGTH = 2000;

/** A path on this host to land on after redeem, or null. Never another origin. */
export function previewAccessReturnPath(value: string | null): string | null {
  if (!value || value.length > MAX_RETURN_LENGTH) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return null;
  // The flow's own pages are never a destination.
  if (value.startsWith("/__morph/preview-auth/")) return null;
  return value;
}

export type PreviewAccessPagesDeps = Readonly<{
  dal: StorefrontPreviewAccessDAL;
  /**
   * Whether an origin is one of Morph's own, the only parent a begin page
   * may talk to. The editor names itself in the begin URL; this decides
   * whether that name is believed.
   */
  isAppOrigin(origin: string): boolean;
  now?: () => Date;
}>;

function cookie(name: string, value: string, maxAgeSeconds: number): string {
  return [
    `${name}=${value}`,
    "Path=/",
    "Secure",
    "HttpOnly",
    "SameSite=None",
    "Partitioned",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ].join("; ");
}

/** JSON safe to place inside an inline script. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function page(
  status: number,
  args: Readonly<{
    appOrigin: string | null;
    script: string;
    body: string;
    setCookies?: readonly string[];
  }>,
): Response {
  const nonce = createPreviewAccessSecret().slice(0, 32);
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      "form-action 'self'",
      "base-uri 'none'",
      `frame-ancestors ${args.appOrigin ?? "'none'"}`,
    ].join("; "),
  });
  for (const value of args.setCookies ?? [])
    headers.append("Set-Cookie", value);
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Preview</title>${args.body}<script nonce="${nonce}">${args.script}</script>`,
    { status, headers },
  );
}

function plain(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** The editor's origin as the begin URL names it, if Morph owns it. */
function appOriginFrom(
  value: string | null,
  deps: PreviewAccessPagesDeps,
): string | null {
  if (!value) return null;
  let origin: string;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    origin = url.origin;
  } catch {
    return null;
  }
  return origin === value && deps.isAppOrigin(origin) ? origin : null;
}

/**
 * GET begin: `?flow=<flowId>&return=<path>&editorOrigin=<origin>`. Sets this
 * flow's binder and reports its hash to the editor.
 */
export async function previewAccessBegin(
  request: Request,
  deps: PreviewAccessPagesDeps,
): Promise<Response> {
  if (request.method !== "GET") return plain(405, "Method not allowed.");
  const url = new URL(request.url);
  const flowId = url.searchParams.get("flow");
  const returnPath = previewAccessReturnPath(url.searchParams.get("return"));
  const appOrigin = appOriginFrom(url.searchParams.get("editorOrigin"), deps);
  if (!flowId || !FLOW_ID.test(flowId) || !returnPath || !appOrigin) {
    return plain(400, "Open this preview from the editor.");
  }
  const binder = createPreviewAccessSecret();
  const binderHash = await hashPreviewAccessSecret(binder);
  const state = scriptJson({
    flowId,
    binderHash,
    appOrigin,
    begin: PREVIEW_ACCESS_BEGIN_MESSAGE,
    code: PREVIEW_ACCESS_CODE_MESSAGE,
  });
  return page(200, {
    appOrigin,
    setCookies: [
      cookie(
        `${PREVIEW_ACCESS_BINDER_COOKIE_PREFIX}${flowId}`,
        binder,
        BINDER_MAX_AGE_S,
      ),
    ],
    body:
      `<form id="redeem" method="post" action="${PREVIEW_ACCESS_REDEEM_PATH}">` +
      `<input type="hidden" name="flow" value="${escapeAttribute(flowId)}">` +
      `<input type="hidden" name="return" value="${escapeAttribute(returnPath)}">` +
      `<input type="hidden" name="editorOrigin" value="${escapeAttribute(appOrigin)}">` +
      `<input type="hidden" name="code" value=""></form>`,
    script:
      `(()=>{const s=${state};let done=false;` +
      `addEventListener("message",(e)=>{` +
      `if(done||e.source!==parent||e.origin!==s.appOrigin)return;` +
      `const d=e.data;` +
      `if(!d||d.type!==s.code||d.flowId!==s.flowId||typeof d.code!=="string"||!/^[0-9a-f]{64}$/.test(d.code))return;` +
      `done=true;const f=document.getElementById("redeem");f.elements.code.value=d.code;f.submit();});` +
      `if(parent!==window)parent.postMessage({type:s.begin,flowId:s.flowId,binderHash:s.binderHash},s.appOrigin);` +
      `})();`,
  });
}

/** Grants the redeem request already carries that this flow may reuse. */
function reuseCandidates(request: Request): readonly string[] {
  const read = readPreviewAccessCandidates(request.headers.get("cookie"));
  return read.kind === "candidates" ? read.tokens : [];
}

/**
 * POST redeem, from begin's own form. Consumes the code with this flow's
 * binder; on success sets the grant and answers 303 to the preview path.
 */
export async function previewAccessRedeem(
  request: Request,
  deps: PreviewAccessPagesDeps,
): Promise<Response> {
  if (request.method !== "POST") return plain(405, "Method not allowed.");
  const url = new URL(request.url);
  // The form is begin's own: posted from this origin, never another.
  if (request.headers.get("origin") !== url.origin) {
    return plain(403, "Open this preview from the editor.");
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return plain(400, "Open this preview from the editor.");
  }
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : null;
  };
  const flowId = field("flow");
  const returnPath = previewAccessReturnPath(field("return"));
  const appOrigin = appOriginFrom(field("editorOrigin"), deps);
  const code = field("code");
  if (!flowId || !FLOW_ID.test(flowId) || !returnPath || !appOrigin || !code) {
    return plain(400, "Open this preview from the editor.");
  }
  const binderName = `${PREVIEW_ACCESS_BINDER_COOKIE_PREFIX}${flowId}`;
  const binder = readCookie(request.headers.get("cookie"), binderName);
  const now = deps.now?.() ?? new Date();
  const previewHost = url.hostname.toLowerCase().replace(/\.$/, "");

  const redeemed = await redeemPreviewAccessExchange({
    dal: deps.dal,
    flowId,
    code,
    binder: binder ?? "",
    previewHost,
    kind: "iframe",
    now,
    reuse: {
      tokens: reuseCandidates(request),
      minRemainingMs: REUSE_MIN_REMAINING_MS,
    },
  });
  const clearBinder = cookie(binderName, "", 0);
  if (!redeemed.ok) {
    return page(403, {
      appOrigin,
      setCookies: [clearBinder],
      body: "<p>Preview sign-in expired. Retry from the editor.</p>",
      script:
        `(()=>{const s=${scriptJson({ appOrigin, flowId, type: PREVIEW_ACCESS_FAILED_MESSAGE, reason: redeemed.reason })};` +
        `if(parent!==window)parent.postMessage({type:s.type,flowId:s.flowId,reason:s.reason},s.appOrigin);})();`,
    });
  }
  const headers = new Headers({
    Location: returnPath,
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  });
  headers.append("Set-Cookie", clearBinder);
  if (redeemed.token) {
    headers.append(
      "Set-Cookie",
      cookie(
        `${PREVIEW_ACCESS_GRANT_COOKIE_PREFIX}${flowId}`,
        redeemed.token,
        (Date.parse(redeemed.grant.expiresAt) - now.getTime()) / 1000,
      ),
    );
  }
  return new Response(null, { status: 303, headers });
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}
