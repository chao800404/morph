import { describe, expect, it } from "vitest";
import { THEME_PUBLIC_LIMITS } from "@/lib/storefront/theme-public-files";
import {
  checkPublicFileWrite,
  planBinaryMoveBatch,
  publicFileDestination,
} from "./public-file-operations";

const HERO = { id: "00000000-0000-4000-8000-000000000001", version: 3 };

describe("checkPublicFileWrite", () => {
  const existing = new Set(["public/images/hero.png", "src/routes/index.tsx"]);

  it("lets a new file in public/ through", () => {
    expect(
      checkPublicFileWrite({
        path: "public/images/new.png",
        size: 10,
        replacing: false,
        existingPaths: existing,
      }),
    ).toBeNull();
  });

  it("refuses a path outside public/, a format it does not serve, and an oversized file", () => {
    const check = (path: string, size = 10) =>
      checkPublicFileWrite({
        path,
        size,
        replacing: false,
        existingPaths: existing,
      });
    expect(check("src/new.png")).toContain("public/");
    expect(check("public/images/logo.svg")).not.toBeNull();
    expect(
      check("public/images/big.png", THEME_PUBLIC_LIMITS.maxFileBytes + 1),
    ).not.toBeNull();
  });

  it("refuses to write over an existing file unless replacing it", () => {
    const write = (replacing: boolean) =>
      checkPublicFileWrite({
        path: "public/images/hero.png",
        size: 10,
        replacing,
        existingPaths: existing,
      });
    expect(write(false)).toContain("already exists");
    expect(write(true)).toBeNull();
  });
});

describe("planBinaryMoveBatch", () => {
  const binaryByPath = new Map([["public/images/hero.png", HERO]]);
  const moves = [{ from: "public/images/hero.png", to: "public/img/hero.png" }];

  it("moves by a copy named by the source and the source's deletion", () => {
    expect(
      planBinaryMoveBatch({ moves, binaryByPath, keepSources: false }),
    ).toEqual({
      ok: true,
      batch: {
        binaryCopies: [
          {
            from: "public/images/hero.png",
            to: "public/img/hero.png",
            expectedFileId: HERO.id,
            expectedVersion: 3,
          },
        ],
        deletions: [
          {
            path: "public/images/hero.png",
            expectedFileId: HERO.id,
            expectedVersion: 3,
          },
        ],
      },
    });
  });

  it("copies without deleting", () => {
    const result = planBinaryMoveBatch({
      moves,
      binaryByPath,
      keepSources: true,
    });
    expect(result.ok && result.batch.deletions).toEqual([]);
  });

  it("refuses a file it does not know, a move out of public/, and nothing", () => {
    expect(
      planBinaryMoveBatch({
        moves: [{ from: "public/x.png", to: "public/y.png" }],
        binaryByPath,
        keepSources: false,
      }).ok,
    ).toBe(false);
    expect(
      planBinaryMoveBatch({
        moves: [{ from: "public/images/hero.png", to: "src/hero.png" }],
        binaryByPath,
        keepSources: false,
      }).ok,
    ).toBe(false);
    expect(
      planBinaryMoveBatch({ moves: [], binaryByPath, keepSources: false }).ok,
    ).toBe(false);
  });
});

describe("publicFileDestination", () => {
  it("reads a destination relative to public/, however it is written", () => {
    for (const typed of [
      "banners/hero.png",
      "/banners/hero.png",
      "public/banners/hero.png",
      " banners/hero.png ",
    ]) {
      expect(publicFileDestination(typed)).toEqual({
        ok: true,
        path: "public/banners/hero.png",
      });
    }
  });

  it("refuses a folder alone, an unsafe path and an unserved format", () => {
    expect(publicFileDestination("banners/").ok).toBe(false);
    expect(publicFileDestination("").ok).toBe(false);
    expect(publicFileDestination("../src/hero.png").ok).toBe(false);
    expect(publicFileDestination("banners/hero.svg").ok).toBe(false);
  });
});
