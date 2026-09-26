import type { StorefrontThemeBinaryFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";

/**
 * Where the editor writes a binary Theme file (`handleThemeBinaryUpload`),
 * and reads one back (`handleThemeBinaryRead`).
 */
export const THEME_BINARY_FILE_ENDPOINT = "/api/storefront/theme-binary-file";

/**
 * The URL of one version of a binary file's bytes, for the admin's own
 * previews. It names the digest, so once the file is replaced it stops
 * answering rather than showing other bytes.
 */
export function themeBinaryFileUrl(input: {
  storefrontId: string;
  themeId: string;
  path: string;
  blobDigest: string;
}): string {
  return `${THEME_BINARY_FILE_ENDPOINT}?${new URLSearchParams({
    storefrontId: input.storefrontId,
    themeId: input.themeId,
    path: input.path,
    digest: input.blobDigest,
  })}`;
}

export type ThemeBinaryWritePrecondition =
  | Readonly<{ expectMissing: true }>
  | Readonly<{ expectedFileId: string; expectedVersion: number }>;

export type ThemeBinaryWriteResult =
  | Readonly<{
      ok: true;
      file: StorefrontThemeBinaryFileDTO;
      sourceGeneration: number;
    }>
  | Readonly<{ ok: false; status: number; error: string; message: string }>;

/**
 * Writes one binary file's bytes as they are, named by the source generation
 * and the file precondition every Theme write carries. The session cookie is
 * what authorizes it; the server decides everything else.
 */
export async function writeThemeBinaryFile(input: {
  storefrontId: string;
  themeId: string;
  path: string;
  bytes: Blob;
  expectedSourceGeneration: number;
  precondition: ThemeBinaryWritePrecondition;
}): Promise<ThemeBinaryWriteResult> {
  const query = new URLSearchParams({
    storefrontId: input.storefrontId,
    themeId: input.themeId,
    path: input.path,
    expectedSourceGeneration: String(input.expectedSourceGeneration),
    ...("expectMissing" in input.precondition
      ? { expectMissing: "1" }
      : {
          expectedFileId: input.precondition.expectedFileId,
          expectedVersion: String(input.precondition.expectedVersion),
        }),
  });
  const response = await fetch(`${THEME_BINARY_FILE_ENDPOINT}?${query}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: input.bytes,
    credentials: "same-origin",
  });
  const body = (await response.json().catch(() => null)) as {
    success?: boolean;
    data?: StorefrontThemeBinaryFileDTO & { sourceGeneration: number };
    error?: string;
    message?: string;
  } | null;
  if (response.ok && body?.success && body.data) {
    const { sourceGeneration, ...file } = body.data;
    return { ok: true, file, sourceGeneration };
  }
  return {
    ok: false,
    status: response.status,
    error: body?.error ?? "SAVE_FAILED",
    message:
      body?.message ?? `The file could not be saved (${response.status}).`,
  };
}
