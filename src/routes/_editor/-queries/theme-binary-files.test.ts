import { afterEach, describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import { writeThemePublicTextFile } from "./theme-binary-files";
import { classifyAuthFailure } from "@/lib/auth/auth-failure";

const input = {
  storefrontId: "store",
  themeId: "theme",
  path: "public/data.json",
  content: '{"title":"中文"}\n',
  expectedSourceGeneration: 12,
  precondition: {
    expectMissing: false as const,
    expectedFileId: "file",
    expectedVersion: 3,
  },
};
afterEach(() => vi.unstubAllGlobals());
describe("Monaco public text bytes writes", () => {
  it("sends exact bytes and OCC through the existing HTTP endpoint", async () => {
    // jsdom's legacy Blob has no text(); the real browser Blob does.
    vi.stubGlobal("Blob", NodeBlob);
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.headers).toMatchObject({
        "content-type": "application/octet-stream",
      });
      expect(await (options.body as Blob).text()).toBe(input.content);
      return Response.json({
        success: true,
        data: {
          id: "file",
          storefrontId: "store",
          themeId: "theme",
          path: input.path,
          encoding: "binary",
          blobDigest: "a".repeat(64),
          sizeBytes: new TextEncoder().encode(input.content).length,
          mimeType: "application/json",
          version: 4,
          isEntry: false,
          createdAt: "",
          updatedAt: "",
          sourceGeneration: 13,
        },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await writeThemePublicTextFile(input);
    expect(result.success).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = new URL(fetcher.mock.calls[0]![0], "http://localhost");
    expect(url.pathname).toBe("/api/storefront/theme-binary-file");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      expectedSourceGeneration: "12",
      expectedFileId: "file",
      expectedVersion: "3",
    });
    expect(url.searchParams.has("expectMissing")).toBe(false);
    if (!result.success) throw new Error(result.message);
    expect(result.data.content).toBe(input.content);
    expect(result.data.sourceGeneration).toBe(13);
  });
  it.each([
    [401, "UNAUTHORIZED", "AUTH_REQUIRED"],
    [403, "FORBIDDEN", "ACCESS_DENIED"],
    [409, "ACCOUNT_CHANGED", "ACCOUNT_CHANGED"],
  ] as const)(
    "keeps auth refusal semantics (%s)",
    async (status, error, expected) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({ error, message: "refused" }, { status }),
        ),
      );
      await writeThemePublicTextFile(input).then(
        () => {
          throw new Error("Expected refusal");
        },
        (failure) => {
          expect(classifyAuthFailure(failure)).toBe(expected);
        },
      );
    },
  );
  it.each([
    ["CONFLICT_SOURCE_GENERATION_MISMATCH", "SOURCE_GENERATION_CONFLICT"],
    ["CONFLICT_VERSION_MISMATCH", "FILE_VERSION_CONFLICT"],
  ])("retains actionable OCC failures: %s", async (error, expected) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error, message: "conflict" }, { status: 409 }),
      ),
    );
    expect(await writeThemePublicTextFile(input)).toMatchObject({
      success: false,
      error: expected,
    });
  });
  it("does not classify an unhandled 500 as a definite refusal or resend", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        { error: "SAVE_FAILED", message: "unknown" },
        { status: 500 },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(writeThemePublicTextFile(input)).rejects.toThrow("unknown");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
