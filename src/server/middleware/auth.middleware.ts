import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAuthWithAdmin } from "../auth/helpers";

export const authMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();
    const auth = getAuthWithAdmin();

    const session = await auth.api.getSession({
      headers: request.headers,
      query: {
        disableCookieCache: true,
      },
    });

    if (!session?.user) {
      throw new Error("Unauthorized: Please sign in to continue");
    }

    return next({
      context: {
        session,
        auth,
      },
    });
  },
);
