import { describe, expect, it } from "vitest";
import {
  confirmPublicUrlRewrites,
  summarizePublicUrlRewrite,
  withPublicUrlRewrites,
  type PublicUrlBatchInput,
} from "./public-url-move-batch";

const FILE_ID = "00000000-0000-4000-8000-000000000001";
const COPY = { from: "public/images/hero.png", to: "public/banners/hero.png" };
const DELETE_SOURCE = [{ path: COPY.from }];

function input(
  overrides: Partial<PublicUrlBatchInput> = {},
): PublicUrlBatchInput {
  return {
    saved: [
      {
        id: FILE_ID,
        path: "src/Hero.tsx",
        content: 'export default () => <img src="/images/hero.png" />;',
        version: 4,
        mimeType: "text/typescript",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        path: "src/Other.tsx",
        content: "export default () => null;",
        version: 1,
      },
    ],
    files: [],
    deletions: DELETE_SOURCE,
    binaryCopies: [COPY],
    rewrites: [COPY],
    ...overrides,
  };
}

describe("withPublicUrlRewrites", () => {
  it("adds each rewritten file, held to the version it was planned from", () => {
    const result = withPublicUrlRewrites(input());
    if (!result.ok) throw new Error(result.reason);

    expect(result.files).toEqual([
      {
        path: "src/Hero.tsx",
        content: 'export default () => <img src="/banners/hero.png" />;',
        mimeType: "text/typescript",
        expectedFileId: FILE_ID,
        expectedVersion: 4,
      },
    ]);
    expect(result.urlMoves).toEqual([
      { from: "/images/hero.png", to: "/banners/hero.png" },
    ]);
    expect(result.removesOldUrls).toBe(true);
  });

  it("rewrites the batch's own writes, and not files the batch deletes", () => {
    const result = withPublicUrlRewrites(
      input({
        files: [
          {
            path: "src/sections/Hero.tsx",
            content: 'export const src = "/images/hero.png";',
            expectMissing: true,
          },
        ],
        deletions: [...DELETE_SOURCE, { path: "src/Hero.tsx" }],
      }),
    );
    if (!result.ok) throw new Error(result.reason);

    expect(result.files).toEqual([
      {
        path: "src/sections/Hero.tsx",
        content: 'export const src = "/banners/hero.png";',
        expectMissing: true,
      },
    ]);
  });

  it("only follows a copy that is in the batch, within public/", () => {
    expect(
      withPublicUrlRewrites(
        input({ rewrites: [{ from: COPY.from, to: "public/elsewhere.png" }] }),
      ).ok,
    ).toBe(false);
    const outside = { from: "src/a.png", to: "src/b.png" };
    expect(
      withPublicUrlRewrites(
        input({ binaryCopies: [outside], rewrites: [outside] }),
      ).ok,
    ).toBe(false);
    expect(withPublicUrlRewrites(input({ rewrites: [] })).ok).toBe(false);
  });

  it("reports a copy that keeps its source as not removing old URLs", () => {
    const result = withPublicUrlRewrites(input({ deletions: [] }));
    expect(result.ok && result.removesOldUrls).toBe(false);
  });
});

describe("confirmPublicUrlRewrites", () => {
  const reviewed = (batch: PublicUrlBatchInput) => {
    const result = withPublicUrlRewrites(batch);
    if (!result.ok) throw new Error(result.reason);
    return summarizePublicUrlRewrite(result.plan);
  };

  it("writes the plan the author confirmed", () => {
    const result = confirmPublicUrlRewrites({
      ...input(),
      expected: reviewed(input()),
      acknowledgeUnresolved: false,
    });
    expect(result.ok && result.files.map((file) => file.path)).toEqual([
      "src/Hero.tsx",
    ]);
  });

  it("refuses when the saved files no longer give that plan", () => {
    const expected = reviewed(input());
    const changed = input();
    const result = confirmPublicUrlRewrites({
      ...changed,
      saved: [
        ...changed.saved.slice(0, 1),
        {
          ...changed.saved[1]!,
          content: 'export const other = "/images/hero.png";',
          version: 2,
        },
      ],
      expected,
      acknowledgeUnresolved: false,
    });
    expect(result).toMatchObject({
      ok: false,
      error: "PUBLIC_URL_REWRITE_STALE",
    });
  });

  it("removes an old URL with unresolved references only when acknowledged", () => {
    const dynamic = input();
    const withDynamic: PublicUrlBatchInput = {
      ...dynamic,
      saved: [
        ...dynamic.saved,
        {
          id: "00000000-0000-4000-8000-000000000003",
          path: "src/Gallery.tsx",
          content: "export const src = `/images/${name}.png`;",
          version: 1,
        },
      ],
    };
    const expected = reviewed(withDynamic);
    expect(expected.unresolvedCount).toBe(1);

    expect(
      confirmPublicUrlRewrites({
        ...withDynamic,
        expected,
        acknowledgeUnresolved: false,
      }),
    ).toMatchObject({ ok: false, error: "PUBLIC_URL_REWRITE_UNACKNOWLEDGED" });
    expect(
      confirmPublicUrlRewrites({
        ...withDynamic,
        expected,
        acknowledgeUnresolved: true,
      }).ok,
    ).toBe(true);

    // Keeping the old file needs no acknowledgement: its URL still works.
    const kept = { ...withDynamic, deletions: [] };
    expect(
      confirmPublicUrlRewrites({
        ...kept,
        expected: reviewed(kept),
        acknowledgeUnresolved: false,
      }).ok,
    ).toBe(true);
  });
});
