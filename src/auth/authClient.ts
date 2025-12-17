import { cloudflareClient } from "better-auth-cloudflare/client";
import {
  adminClient,
  anonymousClient,
  emailOTPClient,
  inferAdditionalFields,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { auth } from ".";
import { ac, staff } from "./permissions";

const authClient = (baseURL: string) =>
  createAuthClient({
    baseURL,
    plugins: [
      cloudflareClient(),
      anonymousClient(),
      adminClient({
        ac,
        roles: {
          staff,
        },
      }),
      emailOTPClient(),
      inferAdditionalFields<typeof auth>(),
    ],
  });

export default authClient;
