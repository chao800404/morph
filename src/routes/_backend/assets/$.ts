import { createAuth } from "@/auth";
import { assetDal } from "@/lib/asset/dal/asset.dal";
import { hasAnyRole } from "@/server/middleware/auth.middleware";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

export const Route = createFileRoute("/_backend/assets/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let session = null;
        try {
          const auth = createAuth(env as any);
          session = await auth.api.getSession({ headers: request.headers });
        } catch {
          return new Response("Unauthorized", { status: 401 });
        }
        if (!session?.user) {
          return new Response("Unauthorized", { status: 401 });
        }
        if (!hasAnyRole(session.user.role, ["admin", "user"])) {
          return new Response("Forbidden", { status: 403 });
        }

        const pathname = decodeURIComponent(new URL(request.url).pathname);
        const key = pathname.replace(/^\/+/, "");
        if (!key.startsWith("assets/") || key.includes("..")) {
          return new Response("Invalid asset path", { status: 400 });
        }

        // D1 is the authorization/source-of-truth layer. A soft-deleted row
        // must become inaccessible even if best-effort R2 archival later fails.
        const asset = await assetDal.findByStorageKey(key);
        if (!asset) {
          return new Response("Asset not found", { status: 404 });
        }

        const object = await env.R2_BUCKET.get(key);
        if (!object) {
          return new Response("Asset not found", { status: 404 });
        }

        if (request.headers.get("if-none-match") === object.httpEtag) {
          return new Response(null, { status: 304 });
        }

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        if (headers.get("content-type") === "image/svg+xml") {
          const isValidatedSvg = object.customMetadata?.svgValidated === "true";
          headers.set(
            "content-disposition",
            isValidatedSvg ? "inline" : "attachment",
          );
          headers.set(
            "content-security-policy",
            "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
          );
        }
        headers.set("etag", object.httpEtag);
        headers.set("cache-control", "private, max-age=3600");
        headers.set("x-content-type-options", "nosniff");

        return new Response(object.body, { headers });
      },
    },
  },
});
