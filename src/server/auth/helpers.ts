import { createAuth } from "@/auth";
import { env } from "cloudflare:workers";

/**
 * Get authenticated auth instance with admin plugin support
 * This helper provides runtime access to admin plugin APIs
 */
export function getAuthWithAdmin() {
  const auth = createAuth(env as any);

  // Type-safe wrapper for admin plugin APIs
  return {
    ...auth,
    admin: {
      createUser: async (options: {
        email: string;
        password: string;
        name: string;
        role?: string | string[];
        data?: Record<string, any>;
      }) => {
        return await (auth.api as any).createUser({
          body: options,
        });
      },

      setRole: async (options: { userId: string; role: string | string[] }) => {
        return await (auth.api as any).setRole({
          body: options,
        });
      },

      listUsers: async (options?: {
        limit?: number;
        offset?: number;
        sortBy?: string;
        sortDirection?: "asc" | "desc";
      }) => {
        return await (auth.api as any).listUsers({
          query: options,
        });
      },

      banUser: async (options: {
        userId: string;
        reason?: string;
        expiresIn?: number;
      }) => {
        return await (auth.api as any).banUser({
          body: options,
        });
      },

      unbanUser: async (options: { userId: string }) => {
        return await (auth.api as any).unbanUser({
          body: options,
        });
      },

      removeUser: async (options: { userId: string }) => {
        return await (auth.api as any).removeUser({
          body: options,
        });
      },
    },
  };
}

export type AuthWithAdmin = ReturnType<typeof getAuthWithAdmin>;
