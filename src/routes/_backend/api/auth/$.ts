import { createAuth } from "@/auth";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

// The request is handed to `createAuth` because this is the route that checks
// origins. Outside production the auth base URL follows the request, so a dev
// server on a port other than 3000 accepts the sign-in it just served; in
// production the request is ignored and `PUBLIC_URL` decides, so a forged
// `Host` cannot widen what the server trusts.
export const Route = createFileRoute("/_backend/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const t0 = Date.now();
        console.log(`[auth-route] GET ${url.pathname} start`);
        try {
          const auth = createAuth(env, request.url);
          const res = await auth.handler(request);
          console.log(
            `[auth-route] GET ${url.pathname} status ${res.status} in ${Date.now() - t0}ms`,
          );
          return res;
        } catch (error) {
          console.error(
            `[auth-route] GET ${url.pathname} error in ${Date.now() - t0}ms:`,
            error,
          );
          throw error;
        }
      },
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const t0 = Date.now();
        console.log(`[auth-route] POST ${url.pathname} start`);
        try {
          const auth = createAuth(env, request.url);
          const res = await auth.handler(request);
          console.log(
            `[auth-route] POST ${url.pathname} status ${res.status} in ${Date.now() - t0}ms`,
          );
          return res;
        } catch (error) {
          console.error(
            `[auth-route] POST ${url.pathname} error in ${Date.now() - t0}ms:`,
            error,
          );
          throw error;
        }
      },
    },
  },
});
