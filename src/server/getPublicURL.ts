import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import {
  DEFAULT_DEV_ORIGIN,
  resolvePublicOrigin,
  type PublicOriginEnv,
} from "./public-origin";

/**
 * The origin the browser should address this app by.
 *
 * Runs on the server only. In production that is `PUBLIC_URL` and nothing else;
 * outside it, the origin the request actually arrived on, so a dev server on a
 * port other than 3000 hands its own pages a base URL that points back at
 * itself. `public-origin.ts` holds the rule, shared with `createAuth`, because
 * this value is the auth client's base URL and that one decides which origins
 * the server accepts — they have to agree.
 */
export const getPublicURL = createServerFn({ method: "GET" }).handler(
  async () => {
    // `CF_PAGES` and `ENVIRONMENT` are injected by the platform and are not in
    // the generated `Env`, so they are declared here rather than erased.
    const _env = env as Env & PublicOriginEnv;

    return resolvePublicOrigin({
      env: _env,
      configured: _env.PUBLIC_URL ?? DEFAULT_DEV_ORIGIN,
      // Absent when a server function runs outside a request, which falls
      // through to the configured value rather than failing.
      requestUrl: safeRequestUrl(),
    });
  },
);

function safeRequestUrl(): string | null {
  try {
    return getRequest().url;
  } catch {
    return null;
  }
}
