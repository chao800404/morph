/**
 * Ephemeral Preview Capability Token for Sandboxed Theme Build Previews.
 *
 * Invariant:
 * The iframe runs under `sandbox="allow-scripts"` (without `allow-same-origin`),
 * so its origin is opaque (`null`) and does NOT send Morph CMS session cookies
 * for ESM module script sub-resource fetches.
 *
 * The Preview Capability Token is bound to `buildId`, `storefrontId`, `themeId`,
 * and an expiration timestamp (HMAC-SHA256 signed).
 * Because the compiler uses `base: "./"`, when HTML is loaded from
 * `/preview-build/{buildId}/{token}/`, all relative sub-resources (`./assets/*`)
 * automatically inherit the capability token in the URL path.
 */

export interface ThemeBuildPreviewTokenPayload {
  buildId: string;
  storefrontId: string;
  themeId: string;
  expiresAt: number; // Unix timestamp in ms
  nonce: string;
}

const DEFAULT_PREVIEW_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function base64UrlEncode(buffer: Uint8Array | ArrayBuffer): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * Generates an HMAC-signed preview capability token for a specific build.
 */
export async function generatePreviewCapabilityToken(
  options: {
    buildId: string;
    storefrontId: string;
    themeId: string;
    ttlMs?: number;
  },
  secret: string,
): Promise<string> {
  const now = Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_PREVIEW_TOKEN_TTL_MS;
  const payload: ThemeBuildPreviewTokenPayload = {
    buildId: options.buildId,
    storefrontId: options.storefrontId,
    themeId: options.themeId,
    expiresAt: now + ttlMs,
    nonce: crypto.randomUUID(),
  };

  const enc = new TextEncoder();
  const payloadBytes = enc.encode(JSON.stringify(payload));
  const payloadB64 = base64UrlEncode(payloadBytes);

  const key = await getHmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(payloadB64),
  );
  const signatureB64 = base64UrlEncode(signature);

  return `${payloadB64}.${signatureB64}`;
}

/**
 * Verifies a preview capability token against a specific build ID and secret.
 */
export async function verifyPreviewCapabilityToken(
  token: string,
  secret: string,
  expectedBuildId: string,
): Promise<{
  valid: boolean;
  payload?: ThemeBuildPreviewTokenPayload;
  error?: string;
}> {
  try {
    const parts = token.trim().split(".");
    if (parts.length !== 2) {
      return { valid: false, error: "Malformed preview capability token" };
    }

    const [payloadB64, signatureB64] = parts;
    const signatureBytes = base64UrlDecode(signatureB64);
    const key = await getHmacKey(secret);

    const enc = new TextEncoder();
    const isValidSignature = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes as any,
      enc.encode(payloadB64),
    );

    if (!isValidSignature) {
      return { valid: false, error: "Invalid preview capability signature" };
    }

    const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload: ThemeBuildPreviewTokenPayload = JSON.parse(payloadJson);

    // Verify token is bound to this exact build
    if (payload.buildId !== expectedBuildId) {
      return {
        valid: false,
        error: `Token is bound to build "${payload.buildId}", cannot access "${expectedBuildId}"`,
      };
    }

    // Verify token expiration
    if (typeof payload.expiresAt !== "number" || Date.now() > payload.expiresAt) {
      return { valid: false, error: "Preview capability token has expired" };
    }

    return { valid: true, payload };
  } catch (err: any) {
    return {
      valid: false,
      error: `Token verification failed: ${err?.message || String(err)}`,
    };
  }
}
