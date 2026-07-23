import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAuthWithAdmin } from "./helpers";

// This function guarantees execution ONLY on the server
export const getSession = createServerFn({ method: "GET" }).handler(
  async () => {
    // Lazy initialize database schema if needed (Runtime Migration like Payload CMS)
    // await import("@/db/init").then((m) => m.initDatabase());

    const request = getRequest();
    const auth = getAuthWithAdmin();
    const session = await auth.api.getSession({
      headers: request.headers,
    });
    return session;
  },
);
