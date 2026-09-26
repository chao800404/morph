import { describe, expect, it } from "vitest";
import {
  planPublicUrlRewrites,
  type PublicUrlMove,
  type PublicUrlRewritePlan,
} from "./public-url-rewrite";

const HERO = "/images/hero.png";
const MOVED = "/banners/hero.png";
const MOVE: PublicUrlMove = { from: HERO, to: MOVED };

function plan(
  files: Record<string, string>,
  moves: readonly PublicUrlMove[] = [MOVE],
): PublicUrlRewritePlan {
  const result = planPublicUrlRewrites(
    Object.entries(files).map(([path, content]) => ({ path, content })),
    moves,
  );
  if (!result.ok) throw new Error(result.reason);
  return result.plan;
}

function written(result: PublicUrlRewritePlan, path: string) {
  return result.writes.find((write) => write.path === path)?.content;
}

function reasons(result: PublicUrlRewritePlan) {
  return result.unresolved.map((item) => [item.path, item.line, item.reason]);
}

describe("planPublicUrlRewrites in TS and JS", () => {
  it("rewrites a JSX attribute, a string and a template without ${}", () => {
    const source = [
      "export const HERO = '/images/hero.png';",
      "export const again = `/images/hero.png`;",
      'export default () => <img src="/images/hero.png" alt="" />;',
    ].join("\n");
    const result = plan({ "src/Hero.tsx": source });

    expect(written(result, "src/Hero.tsx")).toBe(
      source.replaceAll(HERO, MOVED),
    );
    expect(
      result.rewrites.map((item) => [item.line, item.from, item.to]),
    ).toEqual([
      [1, HERO, MOVED],
      [2, HERO, MOVED],
      [3, HERO, MOVED],
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it("keeps a query or hash after the URL", () => {
    const result = plan({
      "src/a.ts":
        'const a = "/images/hero.png?v=2";\nconst b = "/images/hero.png#top";',
    });
    expect(written(result, "src/a.ts")).toBe(
      'const a = "/banners/hero.png?v=2";\nconst b = "/banners/hero.png#top";',
    );
  });

  it("rewrites Tailwind url() values in a class string and nothing else in it", () => {
    const source = [
      "<div className=\"p-4 bg-[url('/images/hero.png')] md:bg-[url(/images/hero.png)]\" />;",
      'const style = { backgroundImage: "url(\\"/images/hero.png\\")" };',
      "const plain = { backgroundImage: 'url(/images/hero.png)' };",
    ].join("\n");
    const result = plan({ "src/a.tsx": source });

    expect(written(result, "src/a.tsx")).toBe(
      [
        "<div className=\"p-4 bg-[url('/banners/hero.png')] md:bg-[url(/banners/hero.png)]\" />;",
        // Escaped quotes: the value is not the text, so it is left alone.
        'const style = { backgroundImage: "url(\\"/images/hero.png\\")" };',
        "const plain = { backgroundImage: 'url(/banners/hero.png)' };",
      ].join("\n"),
    );
    expect(reasons(result)).toEqual([["src/a.tsx", 2, "escaped"]]);
  });

  it("reports URLs built at runtime and leaves them as written", () => {
    const source = [
      "const a = `/images/${name}.png`;",
      "const b = '/images/' + name;",
      "const c = base + '/images/hero.png';",
      "const d = `${cdn}/images/hero.png`;",
      "const e = '/images/';",
      "let f = x; f += '/images/hero.png';",
      "const g = '/images/hero' + ext;",
    ].join("\n");
    const result = plan({ "src/Gallery.tsx": source });

    expect(result.writes).toEqual([]);
    expect(result.rewrites).toEqual([]);
    expect(
      result.unresolved.map((item) => [item.line, item.url, item.reason]),
    ).toEqual([
      [1, "/images/", "built-at-runtime"],
      [2, "/images/", "built-at-runtime"],
      [3, HERO, "built-at-runtime"],
      [4, HERO, "built-at-runtime"],
      [5, "/images/", "built-at-runtime"],
      [6, HERO, "built-at-runtime"],
      [7, HERO, "built-at-runtime"],
    ]);
  });

  it("reports a srcSet, JSX text and escapes instead of editing them", () => {
    const source = [
      'const a = <img srcSet="/images/hero.png 1x, /images/hero@2x.png 2x" />;',
      "const b = <p>/images/hero.png</p>;",
      'const c = "\\u002Fimages/hero.png";',
      'const d = "\\/images\\/hero.png";',
    ].join("\n");
    const result = plan({ "src/a.tsx": source });

    expect(result.writes).toEqual([]);
    expect(reasons(result)).toEqual([
      ["src/a.tsx", 1, "inside-longer-text"],
      ["src/a.tsx", 2, "inside-longer-text"],
      ["src/a.tsx", 3, "escaped"],
      ["src/a.tsx", 4, "escaped"],
    ]);
  });

  it("leaves longer paths, other hosts and comments alone, unreported", () => {
    const result = plan({
      "src/a.ts": [
        'const a = "/images/hero.png.bak";',
        'const b = "https://cdn.example.com/images/hero.png";',
        'const c = "/other/images/hero.png";',
        "// was /images/hero.png",
        "/* see /images/hero.png */",
      ].join("\n"),
    });
    expect(result).toEqual({ writes: [], rewrites: [], unresolved: [] });
  });

  it("applies several moves at once, each against the file as it was", () => {
    const result = plan(
      {
        "src/a.tsx":
          "<div className=\"bg-[url('/images/a.png')] after:bg-[url('/images/b.png')]\" />;",
      },
      [
        { from: "/images/a.png", to: "/images/b.png" },
        { from: "/images/b.png", to: "/images/c.png" },
      ],
    );
    expect(written(result, "src/a.tsx")).toBe(
      "<div className=\"bg-[url('/images/b.png')] after:bg-[url('/images/c.png')]\" />;",
    );
  });

  it("reports a file that does not parse, with lines that may build the URL", () => {
    const source = [
      'const a = "/images/hero.png"',
      "const b = `/images/${x}`;",
      "export default (",
    ].join("\n");
    const result = plan({ "src/Broken.tsx": source });

    expect(result.writes).toEqual([]);
    expect(reasons(result)).toEqual([
      ["src/Broken.tsx", 1, "unparsed"],
      ["src/Broken.tsx", 2, "built-at-runtime"],
    ]);
  });
});

describe("planPublicUrlRewrites in CSS", () => {
  it("rewrites url(), quoted or not, image-set strings and custom properties", () => {
    const source = [
      ".a { background: url(/images/hero.png); }",
      ".b { background: url( '/images/hero.png' ) no-repeat; }",
      '.c { background-image: image-set("/images/hero.png" 1x); }',
      "@theme { --hero: url(/images/hero.png); }",
      "/* url(/images/hero.png) */",
    ].join("\n");
    const result = plan({ "src/styles.css": source });

    expect(written(result, "src/styles.css")).toBe(
      [
        ".a { background: url(/banners/hero.png); }",
        ".b { background: url( '/banners/hero.png' ) no-repeat; }",
        '.c { background-image: image-set("/banners/hero.png" 1x); }',
        "@theme { --hero: url(/banners/hero.png); }",
        "/* url(/images/hero.png) */",
      ].join("\n"),
    );
    expect(result.rewrites.map((item) => item.line)).toEqual([1, 2, 3, 4]);
    expect(result.unresolved).toEqual([]);
  });

  it("rewrites a Tailwind url() in @apply, which CSS reads as a url token", () => {
    const result = plan({
      "src/styles.css": ".hero { @apply bg-[url(/images/hero.png)] p-4; }",
    });
    expect(written(result, "src/styles.css")).toBe(
      ".hero { @apply bg-[url(/banners/hero.png)] p-4; }",
    );
    expect(result.unresolved).toEqual([]);
  });

  it("reports an escaped url()", () => {
    const result = plan({
      "src/styles.css": ".a { background: url(/images/hero\\.png); }",
    });
    expect(result.writes).toEqual([]);
    expect(reasons(result)).toEqual([["src/styles.css", 1, "escaped"]]);
  });
});

describe("planPublicUrlRewrites with a new URL that needs escaping", () => {
  const move = { from: HERO, to: "/images/hero(1).png" };

  it("reports it where the URL sits unquoted, and rewrites it where quoted", () => {
    const result = plan(
      {
        "src/styles.css": [
          ".a { background: url(/images/hero.png); }",
          '.b { background: url("/images/hero.png"); }',
        ].join("\n"),
        "src/a.tsx": [
          "<div className=\"bg-[url('/images/hero.png')]\" />;",
          'const src = "/images/hero.png";',
        ].join("\n"),
      },
      [move],
    );

    expect(written(result, "src/styles.css")).toBe(
      [
        ".a { background: url(/images/hero.png); }",
        '.b { background: url("/images/hero(1).png"); }',
      ].join("\n"),
    );
    expect(written(result, "src/a.tsx")).toBe(
      [
        "<div className=\"bg-[url('/images/hero.png')]\" />;",
        'const src = "/images/hero(1).png";',
      ].join("\n"),
    );
    expect(reasons(result)).toEqual([
      ["src/styles.css", 1, "new-url-needs-escaping"],
      ["src/a.tsx", 1, "new-url-needs-escaping"],
    ]);
  });
});

describe("planPublicUrlRewrites elsewhere", () => {
  it("reports files it does not analyse and edits none", () => {
    const result = plan({
      "morph.theme.json": '{ "image": "/images/hero.png" }',
      "README.md": "The hero (/images/hero.png) is wide.",
    });
    expect(result.writes).toEqual([]);
    expect(reasons(result)).toEqual([
      ["morph.theme.json", 1, "unsupported-file"],
      ["README.md", 1, "unsupported-file"],
    ]);
  });

  it("refuses moves that are not /… URLs, go nowhere, or repeat", () => {
    const check = (moves: PublicUrlMove[]) =>
      planPublicUrlRewrites([], moves).ok;
    expect(check([{ from: "images/hero.png", to: MOVED }])).toBe(false);
    expect(check([{ from: HERO, to: "/a b.png" }])).toBe(false);
    expect(check([{ from: HERO, to: HERO }])).toBe(false);
    expect(check([MOVE, { from: HERO, to: "/x.png" }])).toBe(false);
    expect(check([MOVE])).toBe(true);
  });
});
