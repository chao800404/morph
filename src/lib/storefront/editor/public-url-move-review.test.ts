import { describe, expect, it } from "vitest";
import { reviewPublicUrlMove } from "./public-url-move-review";

const MOVE = { from: "public/images/hero.png", to: "public/img/hero.png" };
const saved = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    path: "src/Hero.tsx",
    content: 'export const src = "/images/hero.png";',
    version: 2,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    path: "src/Footer.tsx",
    content: "export const year = 2026;",
    version: 1,
  },
];
const base = {
  saved,
  drafts: new Map<string, string>(),
  files: [],
  deletions: [{ path: MOVE.from }],
  binaryMoves: [MOVE],
};

describe("reviewPublicUrlMove", () => {
  it("shows the URL change and the references the move updates", () => {
    const review = reviewPublicUrlMove(base);
    expect(review.changes).toEqual([
      { from: "/images/hero.png", to: "/img/hero.png" },
    ]);
    expect(review.rewrite).toMatchObject({
      kind: "ready",
      summary: { paths: ["src/Hero.tsx"], rewriteCount: 1, unresolvedCount: 0 },
    });
  });

  it("stops the rewrite while an unsaved draft names a URL, in either version", () => {
    // The draft adds a reference the saved file does not have.
    expect(
      reviewPublicUrlMove({
        ...base,
        drafts: new Map([
          ["src/Footer.tsx", 'export const logo = "/images/hero.png";'],
        ]),
      }).rewrite,
    ).toEqual({ kind: "blocked", unsavedPaths: ["src/Footer.tsx"] });
    // The draft removes one the saved file has.
    expect(
      reviewPublicUrlMove({
        ...base,
        drafts: new Map([["src/Hero.tsx", "export const src = null;"]]),
      }).rewrite,
    ).toEqual({ kind: "blocked", unsavedPaths: ["src/Hero.tsx"] });
  });

  it("does not stop for a draft that names no URL, or one the batch writes", () => {
    const review = reviewPublicUrlMove({
      ...base,
      drafts: new Map([
        ["src/Footer.tsx", "export const year = 2027;"],
        ["src/Hero.tsx", 'export const src = "/images/hero.png"; // draft'],
      ]),
      files: [
        {
          path: "src/Hero.tsx",
          content: 'export const src = "/images/hero.png"; // draft',
          expectedFileId: saved[0]!.id,
          expectedVersion: 2,
        },
      ],
    });
    expect(review.rewrite).toMatchObject({
      kind: "ready",
      summary: { paths: ["src/Hero.tsx"], rewriteCount: 1 },
    });
  });
});
