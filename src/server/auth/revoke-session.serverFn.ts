import { parseInput } from "@/lib/db/server-result";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";
import { getActionErrorMessage } from "@/lib/asset/action-result";
import { sessionDal } from "@/lib/user/dal/session.dal";
import { canRevokeSession } from "@/lib/user/session-authorization";

export const revokeSession = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(
      z.object({
        id: z.string(),
      }),
      data,
    ),
  )
  .middleware([authMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;
    const request = getRequest();
    const auth = context.auth;

    try {
      // Better Auth listSessions hides the token required by revokeSession.
      const sessionToRevoke = await sessionDal.findRevocableById(data.id);

      if (!sessionToRevoke) {
        return {
          success: false,
          message: "Session not found",
        };
      }

      if (!canRevokeSession(sessionToRevoke.userId, context.session.user.id)) {
        return {
          success: false,
          message: "Unauthorized",
        };
      }

      await auth.api.revokeSession({
        headers: request.headers,
        body: {
          token: sessionToRevoke.token,
        },
      });

      return {
        success: true,
        message: "Session revoked successfully",
      };
    } catch (error) {
      console.error("Revoke Session Error:", error);
      return {
        success: false,
        message: getActionErrorMessage(error, "Failed to revoke session"),
      };
    }
  });
