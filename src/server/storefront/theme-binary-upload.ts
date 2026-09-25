import { z } from "zod";
import { THEME_PUBLIC_LIMITS } from "@/lib/storefront/theme-public-files";
import type { ThemeSourceStore } from "@/lib/storefront/storage/theme-storage.types";
import { hasAnyRole } from "@/server/middleware/auth.middleware";

/**
 * The write entry for a binary Theme file: the editor's upload and replace,
 * and the end-to-end run's.
 *
 * Plain HTTP rather than a server function, because the body is the file's
 * bytes as they are — not base64 inside JSON — and because an end-to-end run
 * has no stable way to name a server function.
 *
 * Nothing here decides what may be written. It is the ordinary write: an
 * administrator's session, as `commerceAdminMiddleware` requires, and
 * `saveBinaryFile`, which checks the Theme belongs to the storefront, the
 * path, the format against the bytes, the quota, the Theme's routes, and the
 * source generation and file version.
 *
 * The request names the file in its query and carries the bytes as
 * `application/octet-stream`. That type is not one a cross-site form can
 * send, so a browser asks before sending it from anywhere else.
 */

export type ThemeBinaryUploadUser = Readonly<{ id: string; role?: unknown }>;

export type ThemeBinaryUploadDeps = Readonly<{
  getSessionUser(request: Request): Promise<ThemeBinaryUploadUser | null>;
  saveBinaryFile: ThemeSourceStore["saveBinaryFile"];
}>;

const querySchema = z
  .object({
    storefrontId: z.string().min(1).max(128),
    themeId: z.string().min(1).max(128),
    path: z.string().min(1).max(512),
    expectedSourceGeneration: z.coerce.number().int().min(0),
    expectMissing: z.literal("1").optional(),
    expectedFileId: z.string().min(1).max(128).optional(),
    expectedVersion: z.coerce.number().int().min(1).optional(),
  })
  .refine(
    (query) =>
      Boolean(query.expectMissing) !==
      Boolean(query.expectedFileId && query.expectedVersion !== undefined),
    {
      message:
        "Name either expectMissing=1, or expectedFileId and expectedVersion.",
    },
  );

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const refuse = (status: number, error: string, message: string) =>
  json({ success: false, error, message }, status);

class BodyTooLargeError extends Error {}

/** The body's bytes, refusing as soon as they pass `limit`. */
async function readBoundedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > limit) {
    throw new BodyTooLargeError();
  }
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function handleThemeBinaryUpload(
  request: Request,
  deps: ThemeBinaryUploadDeps,
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

  const contentType = request.headers.get("content-type") ?? "";
  if (
    contentType.split(";")[0]!.trim().toLowerCase() !==
    "application/octet-stream"
  ) {
    return refuse(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Send the file's bytes as application/octet-stream.",
    );
  }

  const url = new URL(request.url);
  const query = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!query.success) {
    return refuse(
      400,
      "INVALID_INPUT",
      query.error.issues.map((issue) => issue.message).join(" "),
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(request, THEME_PUBLIC_LIMITS.maxFileBytes);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return refuse(
        413,
        "FILE_TOO_LARGE",
        `A file may be at most ${THEME_PUBLIC_LIMITS.maxFileBytes} bytes.`,
      );
    }
    throw error;
  }

  const data = query.data;
  try {
    const saved = await deps.saveBinaryFile(
      data.storefrontId,
      data.themeId,
      {
        path: data.path,
        bytes,
        ...(data.expectMissing
          ? { expectMissing: true }
          : {
              expectedFileId: data.expectedFileId,
              expectedVersion: data.expectedVersion,
            }),
      },
      {
        expectedSourceGeneration: data.expectedSourceGeneration,
        createdBy: user.id,
      },
    );
    return json({ success: true, data: saved }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("CONFLICT_")) {
      return refuse(409, message.slice(0, message.indexOf(":")), message);
    }
    if (message.startsWith("THEME_PUBLIC_FILE_REFUSED")) {
      return refuse(422, "THEME_PUBLIC_FILE_REFUSED", message);
    }
    console.error("Theme binary upload failed:", error);
    return refuse(500, "SAVE_FAILED", "Failed to save the file.");
  }
}
