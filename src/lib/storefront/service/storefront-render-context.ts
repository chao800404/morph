/**
 * The release one storefront page render is pinned to (M1 source isolation,
 * G3).
 *
 * A page request is resolved to the active release and handed to that
 * release's Theme build. The Theme then reads its content by calling Core back
 * on `/_morph/content`, which is a separate request. Resolving the active
 * release again there would let a render that straddles a publish or a
 * rollback combine build N with release N+1's content, or two reads from two
 * releases. So Core states, with the page request, which release and which
 * ContentPublication the render belongs to, and signs that statement. The
 * Theme's reads carry it back unchanged, and the content endpoint serves what
 * it names. A new page request is resolved, and pinned, afresh: a publish or
 * rollback takes effect from the next request on.
 *
 * The context is not an access grant. It can only name a publication that
 * Core itself resolved for this storefront and this host, within its
 * lifetime, and publications are immutable, so the endpoint needs no further
 * lookup to trust it. A context that is forged, expired, malformed or bound to
 * another storefront or host is refused by the caller; it is never replaced
 * with the active release, which would be the unpinned behaviour again with no
 * sign of it.
 */

/** Set by Core on the page request; sent back by the SDK on content reads. */
export const STOREFRONT_RENDER_CONTEXT_HEADER = "x-morph-render-context";

/** How long one render may keep reading the release its page was resolved to. */
export const STOREFRONT_RENDER_CONTEXT_TTL_MS = 5 * 60 * 1000;

const SIGNATURE_CONTEXT = "morph-render-context:v1";
const VERSION = "v1";
/** Far above any real context; refused before decoding. */
const MAX_TOKEN_LENGTH = 2048;

export type StorefrontRenderPin = Readonly<{
  storefrontId: string;
  hostname: string;
  releaseId: string;
  contentPublicationId: string | null;
}>;

export type StorefrontRenderContextVerification =
  | Readonly<{ ok: true; pin: StorefrontRenderPin }>
  | Readonly<{
      ok: false;
      reason: "malformed" | "forged" | "expired" | "other-storefront";
    }>;

type Payload = Readonly<{
  v: 1;
  s: string;
  h: string;
  r: string;
  p: string | null;
  exp: number;
}>;

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function signedMessage(encodedPayload: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    [SIGNATURE_CONTEXT, encodedPayload].join("\n"),
  );
}

function base64Url(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  let base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 300;
}

function readPayload(bytes: Uint8Array<ArrayBuffer>): Payload | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    record.v !== 1 ||
    !isNonEmptyString(record.s) ||
    !isNonEmptyString(record.h) ||
    !isNonEmptyString(record.r) ||
    !(record.p === null || isNonEmptyString(record.p)) ||
    typeof record.exp !== "number" ||
    !Number.isSafeInteger(record.exp)
  ) {
    return null;
  }
  return record as Payload;
}

/** Signs the pin for one page request; valid for the render that follows. */
export async function signStorefrontRenderContext(args: {
  pin: StorefrontRenderPin;
  secret: string;
  now: number;
}): Promise<string> {
  const payload: Payload = {
    v: 1,
    s: args.pin.storefrontId,
    h: args.pin.hostname,
    r: args.pin.releaseId,
    p: args.pin.contentPublicationId,
    exp: args.now + STOREFRONT_RENDER_CONTEXT_TTL_MS,
  };
  const encoded = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(args.secret),
    signedMessage(encoded),
  );
  return [VERSION, encoded, base64Url(new Uint8Array(signature))].join(".");
}

/**
 * Whether a content read's context is one Core issued, still current, for
 * the storefront and host this request resolved to.
 *
 * An expiry further out than this code would issue now is refused as well, so
 * shortening the lifetime also retires every longer-lived context already out.
 */
export async function verifyStorefrontRenderContext(args: {
  token: string;
  secret: string;
  now: number;
  storefrontId: string;
  hostname: string;
}): Promise<StorefrontRenderContextVerification> {
  if (args.token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: "malformed" };
  }
  const parts = args.token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) {
    return { ok: false, reason: "malformed" };
  }
  const [, encoded, encodedSignature] = parts as [string, string, string];
  const payloadBytes = fromBase64Url(encoded);
  const signature = fromBase64Url(encodedSignature);
  if (!payloadBytes || !signature) return { ok: false, reason: "malformed" };

  const authentic = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(args.secret),
    signature,
    signedMessage(encoded),
  );
  if (!authentic) return { ok: false, reason: "forged" };

  const payload = readPayload(payloadBytes);
  if (!payload) return { ok: false, reason: "malformed" };
  if (
    payload.exp <= args.now ||
    payload.exp > args.now + STOREFRONT_RENDER_CONTEXT_TTL_MS
  ) {
    return { ok: false, reason: "expired" };
  }
  if (payload.s !== args.storefrontId || payload.h !== args.hostname) {
    return { ok: false, reason: "other-storefront" };
  }
  return {
    ok: true,
    pin: {
      storefrontId: payload.s,
      hostname: payload.h,
      releaseId: payload.r,
      contentPublicationId: payload.p,
    },
  };
}
