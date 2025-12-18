import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";

/**
 * Set a short-lived cookie to allow access to the /reset-password/verify page
 * Valid for 5 minutes (300 seconds)
 */
export const setVerifyAccessCookieServerFn = createServerFn({ method: "POST" })
  .inputValidator(z.string())
  .handler(async ({ data: email }) => {
    const expiresAt = Date.now() + 300 * 1000;
    const value = `${encodeURIComponent(email)}|${expiresAt}`;
    setResponseHeader(
      "Set-Cookie",
      `verify_access=${value}; Path=/; Max-Age=300; HttpOnly; SameSite=Lax`,
    );
    return { success: true };
  });

/**
 * Check if the user has access to the verify page
 * This can be called within beforeLoad
 */
export const checkVerifyAccessServerFn = createServerFn({
  method: "GET",
}).handler(async () => {
  const request = getRequest();
  const cookies = request.headers.get("Cookie") || "";
  const match = cookies.match(/verify_access=([^;]+)/);
  if (!match) return { email: null, expiresAt: null };

  const [encodedEmail, expiresAtStr] = match[1].split("|");
  const email = decodeURIComponent(encodedEmail);
  const expiresAt = parseInt(expiresAtStr, 10);

  // Buffer check: if expired already
  if (Date.now() > expiresAt) {
    return { email: null, expiresAt: null };
  }

  return { email, expiresAt };
});
