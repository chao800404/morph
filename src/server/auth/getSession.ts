import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAuthWithAdmin } from "./helpers";

export const getSession = createServerFn({ method: "GET" }).handler(
  async () => {
    const request = getRequest();
    const auth = getAuthWithAdmin();
    const session = await auth.api.getSession({
      headers: request.headers,
    });
    return session;
  },
);
