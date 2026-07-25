import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";

// This function guarantees execution ONLY on the server
export const getPublicURL = createServerFn({ method: "GET" }).handler(
  async () => {
    // `CF_PAGES` and `ENVIRONMENT` are injected by the platform and are not in
    // the generated `Env`, so they are declared here rather than erased.
    const _env = env as Env & {
      CF_PAGES?: string;
      ENVIRONMENT?: string;
      PUBLIC_URL?: string;
    };

    // Check if we're in production environment
    // Cloudflare Workers sets CF_PAGES for Pages deployments
    // or we can check if NODE_ENV is production
    const isProduction =
      _env.CF_PAGES === "1" ||
      _env.ENVIRONMENT === "production" ||
      process.env.NODE_ENV === "production";

    // Only use PUBLIC_URL in production
    if (isProduction && _env.PUBLIC_URL) {
      return _env.PUBLIC_URL;
    }

    // Development fallback: use localhost
    return "http://localhost:3000";
  },
);
