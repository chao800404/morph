import { isPlatformCredentialCookieName } from "@/lib/auth/platform-cookies";
import { normalizeStorefrontHostname } from "./storefront-host-resolver";

/**
 * What of a browser's request reaches a Live Preview container, and what of
 * the container's response reaches the browser.
 *
 * Theme code runs in the container, so whatever is forwarded there is handed
 * to it. Most of a request is the Theme's own business — its cookies, its
 * `Authorization`, whatever its routes read — and passes untouched, because a
 * preview that runs real TanStack Start has to see what a deployed one would.
 * Two things are not the Theme's:
 *
 * - cookies Morph issues as credentials. A preview on a site of its own never
 *   receives them from a browser; removing them here means that staying true
 *   does not rest on configuration alone.
 * - `x-morph-*` headers. Core uses them to tell a Theme Worker what it has
 *   resolved, so a browser must not be able to assert them to Theme code.
 *
 * `Authorization` passes: Morph never places one on a browser, so what reaches
 * a preview host is what the Theme's own code sent.
 *
 * In the other direction a container's `Set-Cookie` may not carry a platform
 * credential's name, nor a nameless value that would come back under one. This
 * is defence in depth for server-set cookies only: Theme code in the browser
 * can still write `document.cookie` or send `Clear-Site-Data`.
 *
 * Not covered, and not coverable here: Theme code in the browser can write
 * `document.cookie` with a `Domain` of the preview host's parent, which then
 * reaches every other preview under it. Previews are not isolated from each
 * other in that respect; it is a known limit, not a solved one.
 */

/** The shape of the first label of a sandbox preview host: `<port>-...`. */
const SANDBOX_PREVIEW_LABEL = /^\d{4,5}-[^.]+$/;

/**
 * Whether a request is addressed to a sandbox preview: a `<port>-...` label
 * directly under the configured preview host.
 *
 * Asked before the request is rewritten, because rewriting it takes its body.
 * A request this says no to is left exactly as it arrived for Morph to handle.
 * The label is only read for its shape here; the Sandbox SDK parses it.
 */
export function isSandboxPreviewRequest(
  url: URL,
  env: Record<string, unknown> | undefined,
): boolean {
  const configured =
    typeof env?.THEME_PREVIEW_HOSTNAME === "string"
      ? normalizeStorefrontHostname(env.THEME_PREVIEW_HOSTNAME)
      : null;
  if (!configured) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.endsWith(`.${configured}`)) return false;
  const label = host.slice(0, host.length - configured.length - 1);
  return SANDBOX_PREVIEW_LABEL.test(label);
}

/** The request as it may reach Theme code. Takes the original's body. */
export function previewRequestFor(request: Request): Request {
  return new Request(request, {
    headers: previewRequestHeaders(request.headers),
  });
}

export function previewRequestHeaders(headers: Headers): Headers {
  const forwarded = new Headers(headers);
  for (const name of [...forwarded.keys()]) {
    if (name.startsWith("x-morph-")) forwarded.delete(name);
  }
  const cookie = forwarded.get("cookie");
  if (cookie !== null) {
    const kept = cookie
      .split(";")
      .map((pair) => pair.trim())
      .filter(
        (pair) => pair !== "" && !isPlatformCredentialCookieName(cookieName(pair)),
      );
    if (kept.length > 0) forwarded.set("cookie", kept.join("; "));
    else forwarded.delete("cookie");
  }
  return forwarded;
}

/**
 * The response without any `Set-Cookie` under a platform credential's name,
 * including a nameless one whose value would come back under such a name.
 *
 * Every other `Set-Cookie` is kept, each as its own header, in order: they
 * are never joined, since a joined `Set-Cookie` is not one a browser can read
 * back apart. A response with nothing to remove is returned as it is.
 *
 * Applied where a Theme's server response reaches a browser: Live Preview,
 * Build Preview and the public storefront. Defence in depth for server-set
 * cookies; it does not stop Theme code in the browser.
 */
export function withoutPlatformCookies(response: Response): Response {
  const setCookies = response.headers.getSetCookie();
  const kept = setCookies.filter(
    (value) => !isPlatformCredentialCookieName(setCookieSentName(value)),
  );
  if (kept.length === setCookies.length) return response;

  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  for (const value of kept) headers.append("set-cookie", value);
  // A WebSocket upgrade is answered with its socket; a rebuilt response has
  // to carry it on, or the upgrade would be lost.
  const webSocket = (response as { webSocket?: unknown }).webSocket;
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
    ...(webSocket ? { webSocket } : {}),
  } as ResponseInit);
}

/**
 * A cookie's name: what precedes the first `=`. A pair without one has an
 * empty name, as browsers read it. In a `Cookie` header that makes it no
 * platform cookie; a `Set-Cookie` goes through `setCookieSentName` instead.
 */
function cookieName(pair: string): string {
  const equals = pair.indexOf("=");
  return equals === -1 ? "" : pair.slice(0, equals).trim();
}

/**
 * The name a `Set-Cookie` would come back under in a later `Cookie` header.
 *
 * Usually its own name. A nameless one (`=a=b`, or `a` with no `=` at all) is
 * sent back as its bare value, which a server then reads as `a=b` or `a`; so
 * for those the value's own leading name is what is checked. Without this,
 * `=better-auth.session_token=<t>` would pass as a cookie with no name and
 * could come back as the platform's session.
 */
function setCookieSentName(setCookie: string): string {
  const semicolon = setCookie.indexOf(";");
  const pair = semicolon === -1 ? setCookie : setCookie.slice(0, semicolon);
  const name = cookieName(pair);
  if (name !== "") return name;
  const value = pair.slice(pair.indexOf("=") + 1).trim();
  const equals = value.indexOf("=");
  return (equals === -1 ? value : value.slice(0, equals)).trim();
}
