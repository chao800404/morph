const RESET_ACCESS_COOKIE = "verify_access";
const RESET_ACCESS_PREFIX = "reset-access:";
export const RESET_ACCESS_MAX_AGE_SECONDS = 300;

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export const createResetAccessToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
};

export const hashResetAccessToken = async (token: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return toHex(new Uint8Array(digest));
};

export const resetAccessIdentifier = (tokenHash: string) =>
  `${RESET_ACCESS_PREFIX}${tokenHash}`;

export const readResetAccessCookie = (cookieHeader: string | null) => {
  if (!cookieHeader) return null;
  for (const segment of cookieHeader.split(";")) {
    const [name, ...valueParts] = segment.trim().split("=");
    if (name !== RESET_ACCESS_COOKIE) continue;
    const value = valueParts.join("=");
    return /^[0-9a-f]{64}$/.test(value) ? value : null;
  }
  return null;
};

export const resetAccessCookieHeader = (token: string, secure: boolean) =>
  [
    `${RESET_ACCESS_COOKIE}=${token}`,
    "Path=/reset-password",
    `Max-Age=${RESET_ACCESS_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Strict",
    secure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");

export const clearResetAccessCookieHeader = (secure: boolean) =>
  [
    `${RESET_ACCESS_COOKIE}=`,
    "Path=/reset-password",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Strict",
    secure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
