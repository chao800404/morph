import { describe, expect, it, vi } from "vitest";
import {
  handleThemeBinaryRead,
  type ThemeBinaryReadDeps,
} from "./theme-binary-read";

vi.mock("@/server/middleware/auth.middleware", () => ({
  hasAnyRole: (role: unknown, allowed: readonly string[]) =>
    typeof role === "string" &&
    role.split(",").some((value) => allowed.includes(value.trim())),
}));

const DIGEST = "a".repeat(64);
const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function read(query: Record<string, string> = {}) {
  const params = new URLSearchParams({
    storefrontId: "storefront-a",
    themeId: "theme-a",
    path: "public/images/hero.png",
    digest: DIGEST,
    ...query,
  });
  return new Request(
    `http://localhost/api/storefront/theme-binary-file?${params}`,
  );
}

function deps(overrides: Partial<ThemeBinaryReadDeps> = {}) {
  const getBinaryFileByPath = vi.fn(async () => ({
    id: "file-1",
    storefrontId: "storefront-a",
    themeId: "theme-a",
    path: "public/images/hero.png",
    encoding: "binary" as const,
    blobDigest: DIGEST,
    sizeBytes: BYTES.byteLength,
    mimeType: "image/png",
    isEntry: false,
    version: 2,
    createdAt: "now",
    updatedAt: "now",
  }));
  const readBinaryFile = vi.fn(async () => BYTES);
  return {
    getSessionUser: vi.fn(async () => ({ id: "user-1", role: "admin" })),
    getBinaryFileByPath,
    readBinaryFile,
    ...overrides,
  } satisfies ThemeBinaryReadDeps;
}

describe("handleThemeBinaryRead", () => {
  it("sends the bytes at the named digest, uncached and not to be sniffed or run", async () => {
    const d = deps();
    const response = await handleThemeBinaryRead(read(), d);

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain(
      "sandbox",
    );
    expect(d.getBinaryFileByPath).toHaveBeenCalledWith(
      "storefront-a",
      "theme-a",
      "public/images/hero.png",
    );
    expect(d.readBinaryFile).toHaveBeenCalledWith(DIGEST);
  });

  it("refuses without a session, and to anyone but an administrator", async () => {
    const anonymous = deps({ getSessionUser: vi.fn(async () => null) });
    expect((await handleThemeBinaryRead(read(), anonymous)).status).toBe(401);
    expect(anonymous.getBinaryFileByPath).not.toHaveBeenCalled();

    const staff = deps({
      getSessionUser: vi.fn(async () => ({ id: "user-2", role: "staff" })),
    });
    expect((await handleThemeBinaryRead(read(), staff)).status).toBe(403);
    expect(staff.readBinaryFile).not.toHaveBeenCalled();
  });

  it("refuses a digest that is not a SHA-256", async () => {
    const d = deps();
    const response = await handleThemeBinaryRead(
      read({ digest: "../../x" }),
      d,
    );
    expect(response.status).toBe(400);
    expect(d.getBinaryFileByPath).not.toHaveBeenCalled();
  });

  it("finds nothing when the path holds other bytes now, or no binary file", async () => {
    const replaced = deps();
    const response = await handleThemeBinaryRead(
      read({ digest: "b".repeat(64) }),
      replaced,
    );
    expect(response.status).toBe(404);
    // Never the bytes of the digest asked for, which the path no longer holds.
    expect(replaced.readBinaryFile).not.toHaveBeenCalled();

    const missing = deps({ getBinaryFileByPath: vi.fn(async () => null) });
    expect((await handleThemeBinaryRead(read(), missing)).status).toBe(404);
    expect(missing.readBinaryFile).not.toHaveBeenCalled();
  });

  it("reports a blob that cannot be read without its detail", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({
      readBinaryFile: vi.fn(async () => {
        throw new Error("SOURCE_BLOB_DIGEST_MISMATCH: secret detail");
      }),
    });
    const response = await handleThemeBinaryRead(read(), d);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret detail");
    error.mockRestore();
  });
});
