import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { authMiddleware } from "../middleware/auth.middleware";

export const listSessions = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const request = getRequest();
    const auth = context.auth;

    // session is provided by authMiddleware context
    const session = context.session;

    try {
      const sessions = await auth.api.listSessions({
        headers: request.headers,
      });

      return {
        sessions,
        currentSessionId: session.session.id,
      };
    } catch (error: any) {
      throw new Error(error.message || "Failed to list sessions");
    }
  });
