// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeRevisionSnapshot } from "./theme-build-materializer";
import { computeThemeInputHash } from "./theme-compiler-hasher";
import { CloudflareSandboxViteThemeBuildRunner } from "./cloudflare-sandbox-vite-theme-build-runner";
import { LocalViteThemeBuildRunner } from "./local-vite-theme-build-runner";

/**
 * Binary files on the way from a frozen revision to a build: carried by
 * reference, checked against that revision's own routes, hashed by digest,
 * and refused by default until every build path has been shown to place
 * them intact.
 */

const DIGEST = "a".repeat(64);

const source = (withAboutRoute: boolean) => [
  {
    path: "morph.theme.json",
    content: JSON.stringify({ entry: "src/routes/index.tsx" }),
  },
  {
    path: "src/routes/index.tsx",
    content:
      'import { createFileRoute } from "@tanstack/react-router"; export const Route = createFileRoute("/")({ component: () => null });',
  },
  ...(withAboutRoute
    ? [
        {
          path: "src/routes/about.tsx",
          content:
            'import { createFileRoute } from "@tanstack/react-router"; export const Route = createFileRoute("/about")({ component: () => null });',
        },
      ]
    : []),
];

const binary = (overrides: Record<string, unknown> = {}) => ({
  path: "public/images/hero.png",
  encoding: "binary",
  blobDigest: DIGEST,
  sizeBytes: 1024,
  mimeType: "image/png",
  isEntry: false,
  ...overrides,
});

describe("normalizeRevisionSnapshot with binary files", () => {
  it("carries them by reference, apart from the source", () => {
    const result = normalizeRevisionSnapshot(
      [...source(false), binary()],
      "rev-1",
    );
    expect(result.files.map((file) => file.path)).toEqual([
      "morph.theme.json",
      "src/routes/index.tsx",
    ]);
    expect(result.binaryFiles).toEqual([
      {
        path: "public/images/hero.png",
        digest: DIGEST,
        sizeBytes: 1024,
        mimeType: "image/png",
      },
    ]);
  });

  it("refuses a reference that is not a well-formed public/ file", () => {
    for (const bad of [
      binary({ path: "src/images/hero.png" }),
      binary({ blobDigest: "A".repeat(64) }),
      binary({ blobDigest: "../x" }),
      binary({ sizeBytes: -1 }),
    ]) {
      expect(() =>
        normalizeRevisionSnapshot([...source(false), bad], "rev-1"),
      ).toThrow("CORRUPT_REVISION_FILE_ENTRY");
    }
    expect(() =>
      normalizeRevisionSnapshot(
        [
          ...source(false),
          { path: "public/images/hero.png", content: "text" },
          binary(),
        ],
        "rev-1",
      ),
    ).toThrow("CORRUPT_REVISION_SNAPSHOT");
  });

  it("judges collisions against the revision's own routes", () => {
    const aboutFile = binary({ path: "public/about" });
    // This revision has an /about page, so the file would take its URL.
    expect(() =>
      normalizeRevisionSnapshot([...source(true), aboutFile], "rev-1"),
    ).toThrow("A page of the Theme already answers this URL.");
    // Without that page in the revision, no route collision is reported.
    let message = "";
    try {
      normalizeRevisionSnapshot([...source(false), aboutFile], "rev-2");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("PUBLIC_FILE_REFUSED");
    expect(message).not.toContain("already answers");
  });

  it("holds each file to the public/ quota", () => {
    expect(() =>
      normalizeRevisionSnapshot(
        [...source(false), binary({ sizeBytes: 5 * 1024 * 1024 + 1 })],
        "rev-1",
      ),
    ).toThrow("limited to 5 MB");
  });
});

describe("the build input hash with binary files", () => {
  const files = [{ path: "src/routes/index.tsx", content: "x" }];
  const entry = "src/routes/index.tsx";
  const image = { path: "public/a.png", digest: DIGEST, sizeBytes: 8 };

  it("is unchanged for a revision without binary files", () => {
    expect(computeThemeInputHash({ files, entry, binaryFiles: [] })).toBe(
      computeThemeInputHash({ files, entry }),
    );
  });

  it("changes with a binary file, and with its digest", () => {
    const withImage = computeThemeInputHash({
      files,
      entry,
      binaryFiles: [image],
    });
    expect(withImage).not.toBe(computeThemeInputHash({ files, entry }));
    expect(
      computeThemeInputHash({
        files,
        entry,
        binaryFiles: [{ ...image, digest: "b".repeat(64) }],
      }),
    ).not.toBe(withImage);
  });
});

describe("the Sandbox build runner with binary files", () => {
  const runner = () =>
    new CloudflareSandboxViteThemeBuildRunner({
      sandboxProvider: {
        getSandbox: async () => {
          throw new Error("must not be reached");
        },
      },
    });
  const input = (overrides: Record<string, unknown> = {}) => {
    const built = runner();
    return {
      built,
      input: {
        buildId: "b",
        storefrontId: "s",
        themeId: "t",
        sourceRevisionId: "r",
        revisionNumber: 1,
        entry: "src/routes/index.tsx",
        inputHash: "h",
        compilerId: (built as unknown as { compilerId: string }).compilerId,
        compilerVersion: (built as unknown as { compilerVersion: string })
          .compilerVersion,
        files: [{ path: "src/routes/index.tsx", content: "x" }],
        binaryFiles: [
          {
            path: "public/a.png",
            digest: DIGEST,
            sizeBytes: 8,
            mimeType: "image/png",
          },
        ],
        ...overrides,
      },
    };
  };

  it("refuses binary files it has nothing to read with, before any sandbox", async () => {
    const { built, input: request } = input();
    const result = await built.run(request);
    expect(result).toMatchObject({
      success: false,
      errorMessage: expect.stringContaining("BINARY_LOADER_MISSING"),
    });
  });

  it("holds binary paths to the workspace containment", async () => {
    const { built, input: request } = input({
      binaryFiles: [
        {
          path: "../escape.png",
          digest: DIGEST,
          sizeBytes: 8,
          mimeType: "image/png",
        },
      ],
      readBinaryFile: async () => new Uint8Array(8),
    });
    const result = await built.run(request);
    expect(result.success).toBe(false);
    expect(result.diagnosticsJson).toMatchObject({
      stage: "security-containment",
    });
  });
});

describe("the local build runner with binary files", () => {
  it("fails a build holding binary files it has nothing to read with", async () => {
    const runner = new LocalViteThemeBuildRunner({
      workDirPrefix: ".morph-builds/binary-test",
    });
    const result = await runner.run({
      buildId: "local-binary",
      storefrontId: "s",
      themeId: "t",
      sourceRevisionId: "r",
      revisionNumber: 1,
      entry: "src/routes/index.tsx",
      inputHash: "h",
      compilerId: runner.compilerId,
      compilerVersion: runner.compilerVersion,
      files: [{ path: "src/routes/index.tsx", content: "export {};" }],
      binaryFiles: [
        {
          path: "public/a.png",
          digest: DIGEST,
          sizeBytes: 8,
          mimeType: "image/png",
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errorMessage).toContain("BINARY_LOADER_MISSING");
  });
});
