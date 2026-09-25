import { describe, expect, it, vi } from "vitest";
import { THEME_PUBLIC_LIMITS } from "@/lib/storefront/theme-public-files";
import { THEME_BINARY_UPLOAD_FLAG } from "@/lib/storefront/service/theme-binary-gates";
import {
  handleThemeBinaryUpload,
  type ThemeBinaryUploadDeps,
} from "./theme-binary-upload";

vi.mock("@/server/middleware/auth.middleware", () => ({
  hasAnyRole: (role: unknown, allowed: readonly string[]) =>
    typeof role === "string" &&
    role.split(",").some((value) => allowed.includes(value.trim())),
}));

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 250, 251, 0, 255,
]);

const QUERY =
  "storefrontId=storefront-a&themeId=theme-a&path=public%2Fimages%2Fhero.png&expectedSourceGeneration=3&expectMissing=1";

function upload(
  body: BodyInit | null = PNG,
  {
    query = QUERY,
    contentType = "application/octet-stream",
    headers = {},
  }: {
    query?: string;
    contentType?: string | null;
    headers?: Record<string, string>;
  } = {},
) {
  return new Request(`http://localhost/api/dev/theme-binary-file?${query}`, {
    method: "POST",
    headers: {
      ...(contentType ? { "content-type": contentType } : {}),
      ...headers,
    },
    body,
    // Node's fetch requires this for a streamed body.
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  } as RequestInit);
}

function deps(overrides: Partial<ThemeBinaryUploadDeps> = {}) {
  const saveBinaryFile = vi.fn(
    async (
      _s: string,
      _t: string,
      file: { path: string; bytes: Uint8Array },
    ) => ({
      id: "file-1",
      storefrontId: "storefront-a",
      themeId: "theme-a",
      path: file.path,
      encoding: "binary" as const,
      blobDigest: "d".repeat(64),
      sizeBytes: file.bytes.byteLength,
      mimeType: "image/png",
      version: 1,
      sourceGeneration: 4,
    }),
  );
  return {
    saveBinaryFile,
    deps: {
      vars: { [THEME_BINARY_UPLOAD_FLAG]: "1" },
      isProduction: false,
      getSessionUser: async () => ({ id: "user-1", role: "admin" }),
      saveBinaryFile:
        saveBinaryFile as unknown as ThemeBinaryUploadDeps["saveBinaryFile"],
      ...overrides,
    } satisfies ThemeBinaryUploadDeps,
  };
}

async function errorOf(response: Response) {
  return ((await response.json()) as { error: string }).error;
}

describe("the binary upload entry", () => {
  it("answers as absent without the flag, and in production with it", async () => {
    const closed = deps({ vars: {} });
    const off = await handleThemeBinaryUpload(upload(), closed.deps);
    expect(off.status).toBe(404);
    expect(await errorOf(off)).toBe("THEME_BINARY_UPLOAD_DISABLED");

    const production = deps({ isProduction: true });
    const prod = await handleThemeBinaryUpload(upload(), production.deps);
    expect(prod.status).toBe(404);
    expect(production.saveBinaryFile).not.toHaveBeenCalled();
  });

  it("requires a signed-in administrator", async () => {
    const anonymous = deps({ getSessionUser: async () => null });
    expect(
      (await handleThemeBinaryUpload(upload(), anonymous.deps)).status,
    ).toBe(401);

    const failing = deps({
      getSessionUser: async () => {
        throw new Error("auth down");
      },
    });
    expect((await handleThemeBinaryUpload(upload(), failing.deps)).status).toBe(
      401,
    );

    const member = deps({
      getSessionUser: async () => ({ id: "user-2", role: "user" }),
    });
    expect((await handleThemeBinaryUpload(upload(), member.deps)).status).toBe(
      403,
    );
    expect(member.saveBinaryFile).not.toHaveBeenCalled();
  });

  it("takes only raw bytes, which a cross-site form cannot send", async () => {
    for (const contentType of [
      "text/plain",
      "multipart/form-data; boundary=x",
      "application/x-www-form-urlencoded",
      null,
    ]) {
      const { deps: d, saveBinaryFile } = deps();
      const response = await handleThemeBinaryUpload(
        upload(PNG, { contentType }),
        d,
      );
      expect(response.status, String(contentType)).toBe(415);
      expect(saveBinaryFile).not.toHaveBeenCalled();
    }
  });

  it("requires one write precondition and a source generation", async () => {
    for (const query of [
      "storefrontId=storefront-a&themeId=theme-a&path=public%2Fa.png&expectMissing=1",
      "storefrontId=storefront-a&themeId=theme-a&path=public%2Fa.png&expectedSourceGeneration=3",
      "storefrontId=storefront-a&themeId=theme-a&path=public%2Fa.png&expectedSourceGeneration=3&expectMissing=1&expectedFileId=f&expectedVersion=2",
    ]) {
      const { deps: d } = deps();
      const response = await handleThemeBinaryUpload(upload(PNG, { query }), d);
      expect(response.status, query).toBe(400);
    }
  });

  it("refuses a body past the file limit, declared or streamed", async () => {
    const declared = deps();
    const tooLarge = await handleThemeBinaryUpload(
      upload(PNG, {
        headers: {
          "content-length": String(THEME_PUBLIC_LIMITS.maxFileBytes + 1),
        },
      }),
      declared.deps,
    );
    expect(tooLarge.status).toBe(413);

    const streamed = deps();
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > THEME_PUBLIC_LIMITS.maxFileBytes) {
          controller.close();
          return;
        }
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const response = await handleThemeBinaryUpload(
      upload(stream),
      streamed.deps,
    );
    expect(response.status).toBe(413);
    expect(streamed.saveBinaryFile).not.toHaveBeenCalled();
  });

  it("hands the exact bytes to the ordinary write, as the signed-in user", async () => {
    const { deps: d, saveBinaryFile } = deps();
    const response = await handleThemeBinaryUpload(upload(), d);

    expect(response.status).toBe(200);
    expect(saveBinaryFile).toHaveBeenCalledTimes(1);
    const [storefrontId, themeId, file, options] = saveBinaryFile.mock
      .calls[0] as unknown as [
      string,
      string,
      { path: string; bytes: Uint8Array; expectMissing?: boolean },
      { expectedSourceGeneration: number; createdBy?: string },
    ];
    expect([storefrontId, themeId]).toEqual(["storefront-a", "theme-a"]);
    expect(file.path).toBe("public/images/hero.png");
    expect(file.expectMissing).toBe(true);
    expect(Array.from(file.bytes)).toEqual(Array.from(PNG));
    expect(options).toEqual({
      expectedSourceGeneration: 3,
      createdBy: "user-1",
    });
  });

  it("reports a stale write as a conflict and a refused file as such", async () => {
    const stale = deps({
      saveBinaryFile: async () => {
        throw new Error(
          "CONFLICT_SOURCE_GENERATION_MISMATCH: Server source generation is 5, but expected 3.",
        );
      },
    });
    const conflict = await handleThemeBinaryUpload(upload(), stale.deps);
    expect(conflict.status).toBe(409);
    expect(await errorOf(conflict)).toBe("CONFLICT_SOURCE_GENERATION_MISMATCH");

    const refused = deps({
      saveBinaryFile: async () => {
        throw new Error(
          "THEME_PUBLIC_FILE_REFUSED: public/images/hero.png: The file's content is not the format its name says.",
        );
      },
    });
    const response = await handleThemeBinaryUpload(upload(), refused.deps);
    expect(response.status).toBe(422);
  });
});
