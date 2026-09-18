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
      GET: ({ request }) => {
        const auth = createAuth(env, request.url);
        return auth.handler(request);
      },
      POST: ({ request }) => {
        const auth = createAuth(env, request.url);
        return auth.handler(request);
      },
    },
  },
});
