import { createAuth } from "@/auth";
import { isProductionEnvironment } from "@/lib/storefront/service/storefront-domain-provider";
import { themeSourceStore } from "@/lib/storefront/storage/theme-storage.server";
import { handleThemeBinaryUpload } from "@/server/dev/theme-binary-upload";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

/** See `handleThemeBinaryUpload`: off unless a local flag opens it. */
export const Route = createFileRoute("/_backend/api/dev/theme-binary-file")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const vars = env as unknown as Record<string, unknown>;
        return handleThemeBinaryUpload(request, {
          vars,
          isProduction: isProductionEnvironment(vars),
          getSessionUser: async (incoming) => {
            const auth = createAuth(env, incoming.url);
            const session = await auth.api.getSession({
              headers: incoming.headers,
            });
            return session?.user ?? null;
          },
          saveBinaryFile: (...args) => themeSourceStore.saveBinaryFile(...args),
        });
      },
    },
  },
});
