import { describe, expect, it } from "vitest";
import type {
  StorefrontThemeBinaryFileDTO,
  StorefrontThemeFileDTO,
  StorefrontThemeWorkspaceEntryDTO,
} from "../dto/storefront-theme-file.dto";
import { planThemeBinaryCopies } from "./theme-binary-copies";

const common = {
  storefrontId: "store-1",
  themeId: "theme-1",
  isEntry: false,
  createdAt: "",
  updatedAt: "",
};

const image = (
  path: string,
  overrides: Partial<StorefrontThemeBinaryFileDTO> = {},
): StorefrontThemeBinaryFileDTO => ({
  ...common,
  id: `id-${path}`,
  path,
  encoding: "binary",
  blobDigest: "a".repeat(64),
  sizeBytes: 100,
  mimeType: "image/png",
  version: 2,
  ...overrides,
});

const source = (path: string, content: string): StorefrontThemeFileDTO => ({
  ...common,
  id: `id-${path}`,
  path,
  content,
  mimeType: "text/typescript",
  version: 1,
});

const ROUTE = source(
  "src/routes/lookbook[.]png.tsx",
  'import { createFileRoute } from "@tanstack/react-router"; export const Route = createFileRoute("/lookbook.png")({ component: () => null });',
);

const entries: StorefrontThemeWorkspaceEntryDTO[] = [
  source(
    "src/routes/__root.tsx",
    'import { createRootRoute } from "@tanstack/react-router"; export const Route = createRootRoute({});',
  ),
  ROUTE,
  image("public/images/hero.png"),
  image("public/images/logo.png", { blobDigest: "b".repeat(64) }),
];

const copy = (from: string, to: string, version = 2) => ({
  from,
  to,
  expectedFileId: `id-${from}`,
  expectedVersion: version,
});

const plan = (
  copies: ReturnType<typeof copy>[],
  extra: {
    deletions?: { path: string }[];
    writes?: { path: string; content: string }[];
    entries?: StorefrontThemeWorkspaceEntryDTO[];
  } = {},
) =>
  planThemeBinaryCopies({
    entries: extra.entries ?? entries,
    copies,
    writes: extra.writes ?? [],
    deletions: extra.deletions ?? [],
  });

describe("planThemeBinaryCopies", () => {
  it("carries the source's digest, size and type — never the client's", () => {
    expect(
      plan([copy("public/images/logo.png", "public/img/logo.png")]),
    ).toEqual({
      ok: true,
      copies: [
        {
          from: "public/images/logo.png",
          to: "public/img/logo.png",
          sourceFileId: "id-public/images/logo.png",
          sourceVersion: 2,
          blobDigest: "b".repeat(64),
          sizeBytes: 100,
          mimeType: "image/png",
        },
      ],
    });
  });

  it("reports a source that changed since as a conflict", () => {
    const result = plan([copy("public/images/hero.png", "public/x.png", 1)]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/^CONFLICT_VERSION_MISMATCH/);
    expect(plan([copy("src/routes/__root.tsx", "public/root.png", 1)]).ok).toBe(
      false,
    );
  });

  it("refuses a destination that exists, even one this batch deletes", () => {
    for (const result of [
      plan([copy("public/images/hero.png", "public/images/logo.png")]),
      // A swap: each destination is the other's source.
      plan(
        [
          copy("public/images/hero.png", "public/images/logo.png"),
          copy("public/images/logo.png", "public/images/hero.png"),
        ],
        {
          deletions: [
            { path: "public/images/hero.png" },
            { path: "public/images/logo.png" },
          ],
        },
      ),
    ]) {
      expect(result.ok).toBe(false);
      expect(!result.ok && result.message).toContain("already taken");
    }
  });

  it("refuses two copies to one destination, and a chain through a source", () => {
    expect(
      plan([
        copy("public/images/hero.png", "public/a.png"),
        copy("public/images/logo.png", "public/a.png"),
      ]).ok,
    ).toBe(false);
    expect(
      plan([
        copy("public/images/hero.png", "public/a.png"),
        copy("public/a.png", "public/b.png"),
      ]).ok,
    ).toBe(false);
  });

  it("refuses a destination a source write in the same batch takes", () => {
    expect(
      plan([copy("public/images/hero.png", "public/new.png")], {
        writes: [{ path: "public/new.png", content: "x" }],
      }).ok,
    ).toBe(false);
  });

  it("keeps the format the bytes are: no new extension", () => {
    const result = plan([
      copy("public/images/hero.png", "public/images/hero.jpg"),
    ]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("different format");
  });

  it("keeps binary files in public/", () => {
    expect(plan([copy("public/images/hero.png", "src/hero.png")]).ok).toBe(
      false,
    );
  });

  it("refuses a destination one of the revision's routes answers", () => {
    const result = plan([
      copy("public/images/hero.png", "public/lookbook.png"),
    ]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("already answers");
  });

  it("counts a copy's source too, against the whole of public/", () => {
    // Nine files at the 5 MiB limit: 45 MiB, beside the two small images.
    const full = [
      ...entries,
      ...Array.from({ length: 9 }, (_, index) =>
        image(`public/big-${index}.png`, {
          sizeBytes: 5 * 1024 * 1024,
          blobDigest: String(index).repeat(64),
        }),
      ),
    ];
    const grow = copy("public/big-0.png", "public/big-copy.png");
    // A copy keeps its source: 50 MiB and more, past the total.
    expect(plan([grow], { entries: full }).ok).toBe(false);
    // The same as a move leaves the total where it was.
    expect(
      plan([grow], {
        entries: full,
        deletions: [{ path: "public/big-0.png" }],
      }).ok,
    ).toBe(true);
  });
});
