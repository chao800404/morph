import type { AssetDTO } from "@/lib/asset/dto/asset.dto";
import { assetStorageKey } from "@/lib/asset/storage-key";
import type { StorefrontThemeBinaryFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import type { ThemeSourceStore } from "@/lib/storefront/storage/theme-storage.types";
import { THEME_PUBLIC_LIMITS } from "@/lib/storefront/theme-public-files";

/**
 * Copies a media-library asset into a Theme's `public/`.
 *
 * A copy, not a link: the bytes become the Theme's own, versioned with its
 * source, so a later change or deletion in the library leaves the site as
 * it was. They are read here, on the server, from the library's storage —
 * never sent by the browser — and written through the one binary write,
 * which checks the path, the format against the bytes, the quota, the
 * Theme's routes, and the source generation. A format the public folder
 * does not serve, such as SVG or video, is refused there like an upload.
 */

export type LibraryAssetToPublicDeps = Readonly<{
  findAsset(id: string): Promise<Pick<AssetDTO, "id" | "url" | "size"> | null>;
  /** The object's bytes, or null when storage has none. */
  readAssetBytes(key: string): Promise<Uint8Array | null>;
  saveBinaryFile: ThemeSourceStore["saveBinaryFile"];
}>;

export type LibraryAssetToPublicInput = Readonly<{
  storefrontId: string;
  themeId: string;
  assetId: string;
  path: string;
  expectedSourceGeneration: number;
  createdBy?: string;
}>;

export type LibraryAssetToPublicResult =
  | Readonly<{
      ok: true;
      file: StorefrontThemeBinaryFileDTO;
      sourceGeneration: number;
    }>
  | Readonly<{
      ok: false;
      error: "ASSET_NOT_FOUND" | "FILE_TOO_LARGE";
      message: string;
    }>;

const tooLarge = (): LibraryAssetToPublicResult => ({
  ok: false,
  error: "FILE_TOO_LARGE",
  message: `A file in public/ may be at most ${THEME_PUBLIC_LIMITS.maxFileBytes} bytes.`,
});

export async function copyLibraryAssetToPublic(
  deps: LibraryAssetToPublicDeps,
  input: LibraryAssetToPublicInput,
): Promise<LibraryAssetToPublicResult> {
  const asset = await deps.findAsset(input.assetId);
  if (!asset) {
    return {
      ok: false,
      error: "ASSET_NOT_FOUND",
      message: "That asset is not in the library.",
    };
  }
  // The row's size refuses a large file before its bytes are read; the
  // bytes' own length decides.
  if (asset.size > THEME_PUBLIC_LIMITS.maxFileBytes) return tooLarge();
  const bytes = await deps.readAssetBytes(assetStorageKey(asset.url));
  if (!bytes) {
    return {
      ok: false,
      error: "ASSET_NOT_FOUND",
      message: "That asset's file is missing from storage.",
    };
  }
  if (bytes.byteLength > THEME_PUBLIC_LIMITS.maxFileBytes) return tooLarge();

  const saved = await deps.saveBinaryFile(
    input.storefrontId,
    input.themeId,
    { path: input.path, bytes, expectMissing: true },
    {
      expectedSourceGeneration: input.expectedSourceGeneration,
      ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    },
  );
  const { sourceGeneration, ...file } = saved;
  return { ok: true, file, sourceGeneration };
}
