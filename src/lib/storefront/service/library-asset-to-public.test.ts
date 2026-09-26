import { describe, expect, it, vi } from "vitest";
import { THEME_PUBLIC_LIMITS } from "@/lib/storefront/theme-public-files";
import {
  copyLibraryAssetToPublic,
  type LibraryAssetToPublicDeps,
} from "./library-asset-to-public";

const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const INPUT = {
  storefrontId: "storefront-a",
  themeId: "theme-a",
  assetId: ASSET_ID,
  path: "public/images/logo.png",
  expectedSourceGeneration: 4,
  createdBy: "user-1",
};

function deps(overrides: Partial<LibraryAssetToPublicDeps> = {}) {
  return {
    findAsset: vi.fn(async () => ({
      id: ASSET_ID,
      url: `/assets/${ASSET_ID}.png`,
      size: BYTES.byteLength,
    })),
    readAssetBytes: vi.fn(async () => BYTES),
    saveBinaryFile: vi.fn(
      async (_s: string, _t: string, file: { path: string }) => ({
        id: "file-1",
        storefrontId: "storefront-a",
        themeId: "theme-a",
        path: file.path,
        encoding: "binary" as const,
        blobDigest: "d".repeat(64),
        sizeBytes: BYTES.byteLength,
        mimeType: "image/png",
        isEntry: false,
        version: 1,
        createdAt: "now",
        updatedAt: "now",
        sourceGeneration: 5,
      }),
    ),
    ...overrides,
  } satisfies LibraryAssetToPublicDeps;
}

describe("copyLibraryAssetToPublic", () => {
  it("reads the asset's bytes from its storage key and writes them as a new file", async () => {
    const d = deps();
    const result = await copyLibraryAssetToPublic(d, INPUT);

    expect(d.readAssetBytes).toHaveBeenCalledWith(`assets/${ASSET_ID}.png`);
    expect(d.saveBinaryFile).toHaveBeenCalledWith(
      "storefront-a",
      "theme-a",
      { path: "public/images/logo.png", bytes: BYTES, expectMissing: true },
      { expectedSourceGeneration: 4, createdBy: "user-1" },
    );
    expect(result).toMatchObject({
      ok: true,
      file: { path: "public/images/logo.png" },
      sourceGeneration: 5,
    });
    expect(result.ok && "sourceGeneration" in result.file).toBe(false);
  });

  it("finds nothing for an asset the library does not hold, or whose file is gone", async () => {
    const missing = deps({ findAsset: vi.fn(async () => null) });
    expect(await copyLibraryAssetToPublic(missing, INPUT)).toMatchObject({
      ok: false,
      error: "ASSET_NOT_FOUND",
    });
    expect(missing.readAssetBytes).not.toHaveBeenCalled();

    const noBytes = deps({ readAssetBytes: vi.fn(async () => null) });
    expect(await copyLibraryAssetToPublic(noBytes, INPUT)).toMatchObject({
      ok: false,
      error: "ASSET_NOT_FOUND",
    });
    expect(noBytes.saveBinaryFile).not.toHaveBeenCalled();
  });

  it("refuses a file over the limit, before reading it when the row says so", async () => {
    const rowTooLarge = deps({
      findAsset: vi.fn(async () => ({
        id: ASSET_ID,
        url: `/assets/${ASSET_ID}.png`,
        size: THEME_PUBLIC_LIMITS.maxFileBytes + 1,
      })),
    });
    expect(await copyLibraryAssetToPublic(rowTooLarge, INPUT)).toMatchObject({
      ok: false,
      error: "FILE_TOO_LARGE",
    });
    expect(rowTooLarge.readAssetBytes).not.toHaveBeenCalled();

    // A row that understates its size is judged by the bytes.
    const bytesTooLarge = deps({
      readAssetBytes: vi.fn(
        async () => new Uint8Array(THEME_PUBLIC_LIMITS.maxFileBytes + 1),
      ),
    });
    expect(await copyLibraryAssetToPublic(bytesTooLarge, INPUT)).toMatchObject({
      ok: false,
      error: "FILE_TOO_LARGE",
    });
    expect(bytesTooLarge.saveBinaryFile).not.toHaveBeenCalled();
  });
});
