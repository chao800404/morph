import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";

// This function guarantees execution ONLY on the server
export const getPublicURL = createServerFn({ method: "GET" }).handler(
  async () => {
    const _env = env as any;

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
