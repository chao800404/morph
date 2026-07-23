import {
  adminClient,
  anonymousClient,
  emailOTPClient,
  inferAdditionalFields,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { auth } from ".";
import { ac, administrator, guest, user } from "./permissions";

const authClient = (baseURL: string) =>
  createAuthClient({
    baseURL,
    plugins: [
      anonymousClient(),
      adminClient({
        ac,
        roles: {
          admin: administrator,
          user,
          guest,
        },
      }),
      emailOTPClient(),
      inferAdditionalFields<typeof auth>(),
    ],
  });

export default authClient;
