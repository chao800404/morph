import {
  clearResetAccessCookieHeader,
  readResetAccessCookie,
  resetAccessCookieHeader,
} from "@/lib/auth/reset-access-token";
import { resetAccessDal } from "@/lib/auth/dal/reset-access.dal";
import { forgotPasswordSchema } from "@/lib/validations/auth";
import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { getAuthWithAdmin } from "./helpers";

const requestSecurity = () => {
  const request = getRequest();
  return {
    request,
    secure: new URL(request.url).protocol === "https:",
  };
};

export const requestPasswordResetAccessServerFn = createServerFn({
  method: "POST",
})
  .validator((data: unknown) => forgotPasswordSchema.shape.email.parse(data))
  .handler(async ({ data: email }) => {
    const { request, secure } = requestSecurity();
    await getAuthWithAdmin().api.sendVerificationOTP({
      body: { email, type: "forget-password" },
      headers: request.headers,
    });
    const access = await resetAccessDal.issue(email);
    setResponseHeader(
      "Set-Cookie",
      resetAccessCookieHeader(access.token, secure),
    );
    return { success: true, expiresAt: access.expiresAt };
  });

export const checkVerifyAccessServerFn = createServerFn({
  method: "GET",
}).handler(async () => {
  const { request } = requestSecurity();
  const token = readResetAccessCookie(request.headers.get("Cookie"));
  if (!token) return { email: null, expiresAt: null };
  const access = await resetAccessDal.resolve(token);
  return access ?? { email: null, expiresAt: null };
});

export const clearVerifyAccessCookieServerFn = createServerFn({
  method: "POST",
}).handler(async () => {
  const { request, secure } = requestSecurity();
  const token = readResetAccessCookie(request.headers.get("Cookie"));
  if (token) await resetAccessDal.revoke(token);
  setResponseHeader("Set-Cookie", clearResetAccessCookieHeader(secure));
  return { success: true };
});
