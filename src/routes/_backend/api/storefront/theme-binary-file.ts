import { createAuth, resolveAuthBaseURL } from "@/auth";
import { themeSourceStore } from "@/lib/storefront/storage/theme-storage.server";
import { handleThemeBinaryRead } from "@/server/storefront/theme-binary-read";
import { handleThemeBinaryUpload } from "@/server/storefront/theme-binary-upload";
import { originOf, refuseCrossOriginWrite } from "@/server/same-origin-write";
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
 *
 * The write is authenticated by the session cookie, so it must come from the
 * CMS's own origin, as `/api/admin/*` writes must (same-origin-write.ts).
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
        (await refuseCrossOriginWrite(
          request,
          originOf(resolveAuthBaseURL(env, request.url)),
        )) ??
        handleThemeBinaryUpload(request, {
          getSessionUser,
          saveBinaryFile: (...args) => themeSourceStore.saveBinaryFile(...args),
        }),
    },
  },
});
