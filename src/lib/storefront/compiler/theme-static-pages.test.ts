import { describe, expect, it } from "vitest";
import { starterThemeWorkspaceFiles } from "../starter-theme-files";
import type {
  StorefrontThemeBuildInput,
  ThemeBuildContentSnapshot,
} from "../dto/storefront-theme-build.dto";
import type { CanonicalThemeBuildManifest } from "./theme-build-artifact-store.types";
import {
  readRegisteredStaticPages,
  registerThemeStaticPages,
} from "./theme-static-pages";

const SHA_HOME = "a".repeat(64);
const SHA_ACCOUNT = "b".repeat(64);

function starterFiles() {
  return starterThemeWorkspaceFiles().map((file) => ({
    path: file.path,
    content: file.content,
    mimeType: file.mimeType,
  }));
}

function snapshot(
  documents: Array<{ templateType: string; renderPolicy?: unknown; routePath?: string }>,
): ThemeBuildContentSnapshot {
  return {
    publicationId: "pub",
    storefrontId: "sf",
    themeId: "th",
    documents: documents.map((doc, index) => ({
      item: {
        id: `item-${index}`,
        publicationId: "pub",
        itemType: "template",
        contentId: `tpl-${index}`,
        revisionId: `rev-${index}`,
        metadata: {
          templateType: doc.templateType,
          ...(doc.routePath ? { routePath: doc.routePath } : {}),
        },
      },
      document: {
        version: 1,
        sections: [],
        ...(doc.renderPolicy ? { renderPolicy: doc.renderPolicy } : {}),
      },
    })) as ThemeBuildContentSnapshot["documents"],
  };
}

function buildInput(
  overrides: Partial<StorefrontThemeBuildInput> = {},
): StorefrontThemeBuildInput {
  return {
    buildId: "bld",
    storefrontId: "sf",
    themeId: "th",
    sourceRevisionId: "rev",
    revisionNumber: 1,
    files: starterFiles() as StorefrontThemeBuildInput["files"],
    entry: "src/routes/index.tsx",
    inputHash: "h".repeat(64),
    compilerId: "tailwind-v4-build",
    compilerVersion: "1",
    framework: "tanstack-start",
    ...overrides,
  };
}

const uploaded = [
  { path: "runtime/client/index.html", sha256: SHA_HOME },
  { path: "runtime/client/account/index.html", sha256: SHA_ACCOUNT },
  { path: "runtime/client/assets/app.js", sha256: "c".repeat(64) },
];

describe("registerThemeStaticPages", () => {
  it("registers the eligible page the sealed content asks to be static, with its HTML's hash", () => {
    expect(
      registerThemeStaticPages({
        buildInput: buildInput({
          contentSnapshot: snapshot([
            { templateType: "index", renderPolicy: { mode: "ssg" } },
          ]),
        }),
        clientAssetsDirectory: "runtime/client",
        files: uploaded,
      }),
    ).toEqual([
      { path: "/", artifactPath: "runtime/client/index.html", sha256: SHA_HOME },
    ]);
  });

  it("registers nothing for a source-only build or an SSR page", () => {
    const files = uploaded;
    expect(
      registerThemeStaticPages({
        buildInput: buildInput(),
        clientAssetsDirectory: "runtime/client",
        files,
      }),
    ).toEqual([]);
    expect(
      registerThemeStaticPages({
        buildInput: buildInput({
          contentSnapshot: snapshot([
            { templateType: "index", renderPolicy: { mode: "ssr" } },
          ]),
        }),
        clientAssetsDirectory: "runtime/client",
        files,
      }),
    ).toEqual([]);
  });

  it("refuses a client's SSG claim on a route the server allow list does not hold", () => {
    expect(() =>
      registerThemeStaticPages({
        buildInput: buildInput({
          contentSnapshot: snapshot([
            {
              templateType: "account",
              routePath: "/account",
              renderPolicy: { mode: "ssg" },
            },
          ]),
        }),
        clientAssetsDirectory: "runtime/client",
        files: uploaded,
      }),
    ).toThrow(/SSG_PAGE_NOT_ELIGIBLE: \/account/);
  });

  it("refuses an SSG claim on the home once its source is not the Starter's", () => {
    const files = starterFiles().map((file) =>
      file.path === "src/components/Header.tsx"
        ? { ...file, content: `${file.content}\n// edited\n` }
        : file,
    );
    expect(() =>
      registerThemeStaticPages({
        buildInput: buildInput({
          files: files as StorefrontThemeBuildInput["files"],
          contentSnapshot: snapshot([
            { templateType: "index", renderPolicy: { mode: "ssg" } },
          ]),
        }),
        clientAssetsDirectory: "runtime/client",
        files: uploaded,
      }),
    ).toThrow(/SSG_PAGE_NOT_ELIGIBLE: \/:/);
  });

  it("refuses a registered page whose HTML the build did not upload", () => {
    expect(() =>
      registerThemeStaticPages({
        buildInput: buildInput({
          contentSnapshot: snapshot([
            { templateType: "index", renderPolicy: { mode: "ssg" } },
          ]),
        }),
        clientAssetsDirectory: "runtime/client",
        files: uploaded.filter((file) => file.path !== "runtime/client/index.html"),
      }),
    ).toThrow("INCOMPLETE_SSG_ARTIFACT");
  });
});

function manifest(
  runtime: Record<string, unknown>,
  files = uploaded,
): CanonicalThemeBuildManifest {
  return {
    files: files.map((file) => ({
      ...file,
      contentType: "text/html",
      sizeBytes: 1,
    })),
    runtime,
  } as unknown as CanonicalThemeBuildManifest;
}

describe("readRegisteredStaticPages", () => {
  const runtime = {
    kind: "cloudflare-worker",
    workerEntry: "runtime/server/index.js",
    clientAssetsDirectory: "runtime/client",
  };

  it("reads no pages from a manifest that registers none", () => {
    expect(readRegisteredStaticPages(manifest(runtime))).toEqual({
      ok: true,
      pages: [],
    });
  });

  it("reads the frozen list", () => {
    const pages = [
      { path: "/", artifactPath: "runtime/client/index.html", sha256: SHA_HOME },
    ];
    expect(
      readRegisteredStaticPages(manifest({ ...runtime, staticPages: pages })),
    ).toEqual({ ok: true, pages });
  });

  it.each([
    ["not a list", { staticPages: "/" }],
    [
      "a file outside the manifest",
      {
        staticPages: [
          {
            path: "/about",
            artifactPath: "runtime/client/about/index.html",
            sha256: SHA_HOME,
          },
        ],
      },
    ],
    [
      "a hash that is not the file's",
      {
        staticPages: [
          {
            path: "/",
            artifactPath: "runtime/client/index.html",
            sha256: SHA_ACCOUNT,
          },
        ],
      },
    ],
    [
      "a path that escapes the client directory",
      {
        staticPages: [
          {
            path: "/",
            artifactPath: "runtime/server/index.html",
            sha256: SHA_HOME,
          },
        ],
      },
    ],
    [
      "the same page twice",
      {
        staticPages: [
          { path: "/", artifactPath: "runtime/client/index.html", sha256: SHA_HOME },
          { path: "/", artifactPath: "runtime/client/index.html", sha256: SHA_HOME },
        ],
      },
    ],
  ])("refuses a registration with %s, never reading it as no pages", (_, extra) => {
    expect(
      readRegisteredStaticPages(manifest({ ...runtime, ...extra })).ok,
    ).toBe(false);
  });
});
