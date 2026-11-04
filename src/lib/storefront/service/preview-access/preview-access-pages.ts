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
 *   issued for that hash, posts it to redeem with a same-origin `fetch`, and
 *   on success replaces itself with the preview path. A form would not do:
 *   the editor frames previews sandboxed without `allow-forms`, which blocks
 *   every form submission, a scripted one included. The binder itself is
 *   never in a response body, a URL or a message.
 * - **redeem** consumes the code with the binder the browser presents, sets
 *   the grant cookie, and answers whether it did.
 *
 * Messages carry the flow id both ways, and each side checks the other's
 * window and origin, so a Theme document later loaded on the same host can
 * never obtain a code.
 *
 * A separate tab (#214 P3, design §4b) runs the same flow with `mode=tab`:
 * its peer is the editor that opened it (`window.opener`) instead of a
 * parent frame, its grant has kind "tab", and the page may not be framed.
 * Opened without an opener (a pasted URL, a bookmark) it says to open the
 * preview from the editor and grants nothing. On success it drops its
 * opener before leaving, so the Theme it lands on can never reach the
 * editor's window; served documents also send COOP (preview-access-request).
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
export const PREVIEW_ACCESS_NO_OPENER_TEXT =
  "Open this preview from the editor.";
export const PREVIEW_ACCESS_TAB_FAILED_TEXT =
  "Preview sign-in expired. Open the preview again from the editor.";

/** The flow's mode as begin and redeem are told it; null when invalid. */
function previewAccessMode(value: string | null): "iframe" | "tab" | null {
  if (value === null) return "iframe";
  return value === "tab" ? "tab" : null;
}

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

function page(
  status: number,
  args: Readonly<{
    appOrigin: string | null;
    script: string;
    body: string;
    setCookies?: readonly string[];
    /** A tab's page is top-level only; a frame's may be framed by the editor. */
    framable: boolean;
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
      // Only begin's own redeem request.
      "connect-src 'self'",
      "form-action 'none'",
      "base-uri 'none'",
      `frame-ancestors ${(args.framable && args.appOrigin) || "'none'"}`,
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
 * GET begin: `?flow=<flowId>&return=<path>&editorOrigin=<origin>[&mode=tab]`.
 * Sets this flow's binder and reports its hash to the editor.
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
  const mode = previewAccessMode(url.searchParams.get("mode"));
  if (!flowId || !FLOW_ID.test(flowId) || !returnPath || !appOrigin || !mode) {
    return plain(400, PREVIEW_ACCESS_NO_OPENER_TEXT);
  }
  const binder = createPreviewAccessSecret();
  const binderHash = await hashPreviewAccessSecret(binder);
  const state = scriptJson({
    flowId,
    binderHash,
    appOrigin,
    returnPath,
    tab: mode === "tab",
    noOpener: PREVIEW_ACCESS_NO_OPENER_TEXT,
    expired: PREVIEW_ACCESS_TAB_FAILED_TEXT,
    redeem: PREVIEW_ACCESS_REDEEM_PATH,
    begin: PREVIEW_ACCESS_BEGIN_MESSAGE,
    code: PREVIEW_ACCESS_CODE_MESSAGE,
    failed: PREVIEW_ACCESS_FAILED_MESSAGE,
  });
  return page(200, {
    appOrigin,
    framable: mode === "iframe",
    setCookies: [
      cookie(
        `${PREVIEW_ACCESS_BINDER_COOKIE_PREFIX}${flowId}`,
        binder,
        BINDER_MAX_AGE_S,
      ),
    ],
    body: "<p>Opening the preview…</p>",
    // The peer is the window that started this flow: the parent frame, or
    // for a tab the editor that opened it. Without one nothing is posted.
    script:
      `(()=>{const s=${state};let done=false;` +
      `const peer=s.tab?window.opener:(parent!==window?parent:null);` +
      `const say=(t)=>{document.body.textContent=t;};` +
      `if(!peer){if(s.tab)say(s.noOpener);return;}` +
      `const failed=(reason)=>{peer.postMessage({type:s.failed,flowId:s.flowId,reason},s.appOrigin);if(s.tab)say(s.expired);};` +
      `addEventListener("message",(e)=>{` +
      `if(done||e.source!==peer||e.origin!==s.appOrigin)return;` +
      `const d=e.data;` +
      `if(!d||d.type!==s.code||d.flowId!==s.flowId||typeof d.code!=="string"||!/^[0-9a-f]{64}$/.test(d.code))return;` +
      `done=true;` +
      `fetch(s.redeem,{method:"POST",credentials:"same-origin",cache:"no-store",` +
      `headers:{"content-type":"application/x-www-form-urlencoded"},` +
      `body:new URLSearchParams(Object.assign({flow:s.flowId,return:s.returnPath,editorOrigin:s.appOrigin,code:d.code},s.tab?{mode:"tab"}:{})).toString()})` +
      `.then((r)=>r.json().then((a)=>{if(r.ok&&a&&a.ok===true){if(s.tab)window.opener=null;location.replace(s.returnPath);}else failed(a&&typeof a.reason==="string"?a.reason:"REDEEM_FAILED");}))` +
      `.catch(()=>failed("REDEEM_UNAVAILABLE"));});` +
      `peer.postMessage({type:s.begin,flowId:s.flowId,binderHash:s.binderHash},s.appOrigin);` +
      `})();`,
  });
}

/** Grants the redeem request already carries that this flow may reuse. */
function reuseCandidates(request: Request): readonly string[] {
  const read = readPreviewAccessCandidates(request.headers.get("cookie"));
  return read.kind === "candidates" ? read.tokens : [];
}

/** Redeem's answer to begin's request: whether the grant is in place. */
function redeemAnswer(
  status: number,
  body: Readonly<{ ok: boolean; reason?: string }>,
  setCookies: readonly string[] = [],
): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  for (const value of setCookies) headers.append("Set-Cookie", value);
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * POST redeem, from begin's own same-origin request. Consumes the code with
 * this flow's binder; on success sets the grant and says so.
 */
export async function previewAccessRedeem(
  request: Request,
  deps: PreviewAccessPagesDeps,
): Promise<Response> {
  if (request.method !== "POST") {
    return redeemAnswer(405, { ok: false, reason: "METHOD_NOT_ALLOWED" });
  }
  const url = new URL(request.url);
  // Begin's own request: sent from this origin, never another.
  if (request.headers.get("origin") !== url.origin) {
    return redeemAnswer(403, { ok: false, reason: "ORIGIN_REFUSED" });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redeemAnswer(400, { ok: false, reason: "REQUEST_INVALID" });
  }
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : null;
  };
  const flowId = field("flow");
  const returnPath = previewAccessReturnPath(field("return"));
  const appOrigin = appOriginFrom(field("editorOrigin"), deps);
  const code = field("code");
  // The kind the code was issued for must match; a frame's code never
  // redeems a tab's grant, or the other way round.
  const kind = previewAccessMode(field("mode"));
  if (
    !flowId ||
    !FLOW_ID.test(flowId) ||
    !returnPath ||
    !appOrigin ||
    !code ||
    !kind
  ) {
    return redeemAnswer(400, { ok: false, reason: "REQUEST_INVALID" });
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
    kind,
    now,
    reuse: {
      tokens: reuseCandidates(request),
      minRemainingMs: REUSE_MIN_REMAINING_MS,
    },
  });
  const clearBinder = cookie(binderName, "", 0);
  if (!redeemed.ok) {
    return redeemAnswer(403, { ok: false, reason: redeemed.reason }, [
      clearBinder,
    ]);
  }
  const setCookies = [clearBinder];
  if (redeemed.token) {
    setCookies.push(
      cookie(
        `${PREVIEW_ACCESS_GRANT_COOKIE_PREFIX}${flowId}`,
        redeemed.token,
        (Date.parse(redeemed.grant.expiresAt) - now.getTime()) / 1000,
      ),
    );
  }
  return redeemAnswer(200, { ok: true }, setCookies);
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
