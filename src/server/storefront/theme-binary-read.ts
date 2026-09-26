import { z } from "zod";
import type { ThemeSourceStore } from "@/lib/storefront/storage/theme-storage.types";
import { hasAnyRole } from "@/server/middleware/auth.middleware";
import type { ThemeBinaryUploadUser } from "./theme-binary-upload";

/**
 * The read entry for a binary Theme file's bytes, for the admin's own views
 * of the workspace — Assets thumbnails — before anything is published.
 *
 * The storefront serves published files itself; this serves the draft, so it
 * is held to what the write entry is: an administrator's session and a Theme
 * that belongs to the storefront. The request names the digest it expects,
 * and the bytes are sent only while the path still holds that digest: a
 * thumbnail URL names one version of a file, and one replaced since gets a
 * 404 rather than other bytes under the old name. The blob store checks the
 * bytes against the digest as it reads them.
 *
 * Drafts change, so nothing here is cached. The type comes from the file's
 * record, which the public-file contract set from the verified format, and
 * the response forbids sniffing and running anything, since the bytes are
 * an author's upload.
 */

export type ThemeBinaryReadDeps = Readonly<{
  getSessionUser(request: Request): Promise<ThemeBinaryUploadUser | null>;
  getBinaryFileByPath: ThemeSourceStore["getBinaryFileByPath"];
  readBinaryFile: ThemeSourceStore["readBinaryFile"];
}>;

const querySchema = z.object({
  storefrontId: z.string().min(1).max(128),
  themeId: z.string().min(1).max(128),
  path: z.string().min(1).max(512),
  digest: z.string().regex(/^[0-9a-f]{64}$/, "digest must be a SHA-256 hex"),
});

const refuse = (status: number, error: string, message: string) =>
  new Response(JSON.stringify({ success: false, error, message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

export async function handleThemeBinaryRead(
  request: Request,
  deps: ThemeBinaryReadDeps,
): Promise<Response> {
  let user: ThemeBinaryUploadUser | null;
  try {
    user = await deps.getSessionUser(request);
  } catch {
    user = null;
  }
  if (!user) {
    return refuse(401, "UNAUTHORIZED", "Please sign in to continue");
  }
  if (!hasAnyRole(user.role, ["admin"])) {
    return refuse(403, "FORBIDDEN", "Administrator access is required");
  }

  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) {
    return refuse(
      400,
      "INVALID_INPUT",
      query.error.issues.map((issue) => issue.message).join(" "),
    );
  }
  const { storefrontId, themeId, path, digest } = query.data;

  try {
    const file = await deps.getBinaryFileByPath(storefrontId, themeId, path);
    if (!file || file.blobDigest !== digest) {
      return refuse(404, "NOT_FOUND", "No such file at that version.");
    }
    const bytes = await deps.readBinaryFile(file.blobDigest);
    // A copy whose buffer is a plain ArrayBuffer, which is what a body takes.
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": file.mimeType,
        "content-length": String(bytes.byteLength),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cross-origin-resource-policy": "same-origin",
      },
    });
  } catch (error) {
    console.error("Theme binary read failed:", error);
    return refuse(500, "READ_FAILED", "Failed to read the file.");
  }
}
