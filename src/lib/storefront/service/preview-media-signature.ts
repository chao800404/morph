/**
 * Signed addresses for library media shown inside a Live Preview.
 *
 * The preview page runs on its own origin — a Sandbox preview host, or a
 * loopback sidecar in local development — and holds no Morph session, so the
 * CMS `/assets` route answers it 401 and the page shows broken images. Opening
 * that route is not an option: it would expose every asset in the library.
 *
 * Instead the signed-in editor, which may already read the asset, is issued an
 * address naming exactly one asset at exactly one stored version, until a
 * fixed time. Morph serves those bytes to whoever holds the address, the way a
 * pre-signed storage URL works. It is served from Morph's own origin rather
 * than the preview's, because a loopback sidecar's requests never pass through
 * this Worker at all.
 *
 * The signature covers the storage key, not just the id: replacing the asset's
 * file, or deleting it, invalidates every address issued for the old bytes.
 */

export const PREVIEW_MEDIA_PATH_PREFIX = "/_morph/preview-media/";

/** How long an issued address stays valid, at least. */
export const PREVIEW_MEDIA_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Expiry is rounded up to this step, so every address issued within the same
 * hour is the same string: the browser can cache it, and a preview snapshot
 * signed twice does not differ only in its signatures.
 */
const PREVIEW_MEDIA_EXPIRY_STEP_MS = 60 * 60 * 1000;

const SIGNATURE_CONTEXT = "morph-preview-media:v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function previewMediaExpiry(now: number): number {
  return (
    Math.ceil((now + PREVIEW_MEDIA_TTL_MS) / PREVIEW_MEDIA_EXPIRY_STEP_MS) *
    PREVIEW_MEDIA_EXPIRY_STEP_MS
  );
}

/** An R2 key the asset library could have written, and nothing else. */
export function isLibraryStorageKey(key: string): boolean {
  return (
    key.startsWith("assets/") &&
    !key.includes("..") &&
    !key.includes("\\") &&
    key.length <= 300
  );
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function signedMessage(
  assetId: string,
  storageKey: string,
  expiresAt: number,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    [SIGNATURE_CONTEXT, assetId.toLowerCase(), storageKey, expiresAt].join(
      "\n",
    ),
  );
}

function base64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(text)) return null;
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

export async function signPreviewMediaUrl(args: {
  origin: string;
  assetId: string;
  storageKey: string;
  expiresAt: number;
  secret: string;
}): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(args.secret),
    signedMessage(args.assetId, args.storageKey, args.expiresAt),
  );
  const url = new URL(
    `${PREVIEW_MEDIA_PATH_PREFIX}${encodeURIComponent(args.assetId.toLowerCase())}`,
    args.origin,
  );
  url.searchParams.set("version", args.storageKey);
  url.searchParams.set("expires", String(args.expiresAt));
  url.searchParams.set("signature", base64Url(signature));
  return url.toString();
}

export type PreviewMediaVerification =
  | Readonly<{ ok: true; assetId: string; storageKey: string }>
  | Readonly<{
      ok: false;
      reason: "not-ours" | "malformed" | "expired" | "forged";
    }>;

/**
 * Whether a request carries a valid signed address.
 *
 * An expiry further out than this code would issue now is refused as well, so
 * shortening the lifetime also retires every longer-lived address already out.
 */
export async function verifyPreviewMediaUrl(
  url: URL,
  secret: string,
  now: number,
): Promise<PreviewMediaVerification> {
  if (!url.pathname.startsWith(PREVIEW_MEDIA_PATH_PREFIX)) {
    return { ok: false, reason: "not-ours" };
  }
  const assetId = url.pathname.slice(PREVIEW_MEDIA_PATH_PREFIX.length);
  const storageKey = url.searchParams.get("version") ?? "";
  const expiresText = url.searchParams.get("expires") ?? "";
  const signature = fromBase64Url(url.searchParams.get("signature") ?? "");
  if (
    !UUID.test(assetId) ||
    !isLibraryStorageKey(storageKey) ||
    !/^\d{1,16}$/.test(expiresText) ||
    !signature
  ) {
    return { ok: false, reason: "malformed" };
  }
  const expiresAt = Number(expiresText);
  if (expiresAt < now || expiresAt > previewMediaExpiry(now)) {
    return { ok: false, reason: "expired" };
  }
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    signature,
    signedMessage(assetId, storageKey, expiresAt),
  );
  if (!valid) return { ok: false, reason: "forged" };
  return { ok: true, assetId: assetId.toLowerCase(), storageKey };
}
