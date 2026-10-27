import { createAuth } from "@/auth";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

const DIAGNOSTICS = process.env.MORPH_E2E_AUTH_DIAGNOSTICS === "1";

// The request is handed to `createAuth` because this is the route that checks
// origins. Outside production the auth base URL follows the request, so a dev
// server on a port other than 3000 accepts the sign-in it just served; in
// production the request is ignored and `PUBLIC_URL` decides, so a forged
// `Host` cannot widen what the server trusts.
export const Route = createFileRoute("/_backend/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const pathname = new URL(request.url).pathname;
        const t0 = Date.now();
        if (DIAGNOSTICS) {
          console.log(`[auth-route] GET ${pathname} start`);
        }
        try {
          const auth = createAuth(env, request.url);
          const res = await auth.handler(request);
          if (DIAGNOSTICS) {
            console.log(
              `[auth-route] GET ${pathname} status ${res.status} in ${Date.now() - t0}ms`,
            );
          }
          return res;
        } catch (error) {
          if (DIAGNOSTICS) {
            const errCode = (error as { code?: string })?.code;
            const errName = (error as Error)?.name ?? "Error";
            console.error(
              `[auth-route] GET ${pathname} error in ${Date.now() - t0}ms: code=${errCode} name=${errName}`,
            );
          }
          throw error;
        }
      },
      POST: async ({ request }) => {
        const pathname = new URL(request.url).pathname;
        const t0 = Date.now();
        if (DIAGNOSTICS) {
          console.log(`[auth-route] POST ${pathname} start`);
        }
        try {
          const auth = createAuth(env, request.url);
          const res = await auth.handler(request);
          if (DIAGNOSTICS) {
            console.log(
              `[auth-route] POST ${pathname} status ${res.status} in ${Date.now() - t0}ms`,
            );
          }
          return res;
        } catch (error) {
          if (DIAGNOSTICS) {
            const errCode = (error as { code?: string })?.code;
            const errName = (error as Error)?.name ?? "Error";
            console.error(
              `[auth-route] POST ${pathname} error in ${Date.now() - t0}ms: code=${errCode} name=${errName}`,
            );
          }
          throw error;
        }
      },
    },
  },
});
