import { createAuth } from "@/auth";
import { themeSourceStore } from "@/lib/storefront/storage/theme-storage.server";
import { handleThemeBinaryUpload } from "@/server/storefront/theme-binary-upload";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

/** Writes one binary Theme file; see `handleThemeBinaryUpload`. */
export const Route = createFileRoute(
  "/_backend/api/storefront/theme-binary-file",
)({
  server: {
    handlers: {
      POST: async ({ request }) =>
        handleThemeBinaryUpload(request, {
          getSessionUser: async (incoming) => {
            const auth = createAuth(env, incoming.url);
            const session = await auth.api.getSession({
              headers: incoming.headers,
            });
            return session?.user ?? null;
          },
          saveBinaryFile: (...args) => themeSourceStore.saveBinaryFile(...args),
        }),
    },
  },
});
