import { createAuth } from "@/auth";
import { themeSourceStore } from "@/lib/storefront/storage/theme-storage.server";
import { handleThemeBinaryRead } from "@/server/storefront/theme-binary-read";
import { handleThemeBinaryUpload } from "@/server/storefront/theme-binary-upload";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

async function getSessionUser(incoming: Request) {
  const auth = createAuth(env, incoming.url);
  const session = await auth.api.getSession({ headers: incoming.headers });
  return session?.user ?? null;
}

/**
 * Writes one binary Theme file (`handleThemeBinaryUpload`), and reads one
 * back at a named digest for the admin's own views (`handleThemeBinaryRead`).
 */
export const Route = createFileRoute(
  "/_backend/api/storefront/theme-binary-file",
)({
  server: {
    handlers: {
      GET: async ({ request }) =>
        handleThemeBinaryRead(request, {
          getSessionUser,
          getBinaryFileByPath: (...args) =>
            themeSourceStore.getBinaryFileByPath(...args),
          readBinaryFile: (...args) => themeSourceStore.readBinaryFile(...args),
        }),
      POST: async ({ request }) =>
        handleThemeBinaryUpload(request, {
          getSessionUser,
          saveBinaryFile: (...args) => themeSourceStore.saveBinaryFile(...args),
        }),
    },
  },
});
