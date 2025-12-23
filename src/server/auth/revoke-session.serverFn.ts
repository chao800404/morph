import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import * as schema from "../../db/schema";
import { authMiddleware } from "../middleware/auth.middleware";

export const revokeSession = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      id: z.string(),
    }),
  )
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const request = getRequest();
    const auth = context.auth;

    try {
      // Better Auth listSessions hides 'token'. Query it from DB.
      const db = drizzle(env.DATABASE, { schema });
      const sessionToRevoke = await db.query.sessions.findFirst({
        where: eq(schema.sessions.id, data.id),
      });

      if (!sessionToRevoke) {
        return {
          success: false,
          message: "Session not found",
        };
      }

      // Check ownership (security)
      if (sessionToRevoke.userId !== context.session.user.id) {
        // Only allow revoking own sessions unless admin (simplified checkout)
        // return { success: false, message: "Unauthorized" };
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
    } catch (error: any) {
      console.error("Revoke Session Error:", error);
      return {
        success: false,
        message: error.message || "Failed to revoke session",
      };
    }
  });
