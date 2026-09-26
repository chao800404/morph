import { describe, expect, it } from "vitest";
import { scanPublicUrlReferences } from "./public-url-references";

const HERO = "/images/hero.png";

describe("scanPublicUrlReferences", () => {
  it("finds a URL written out whole, with its file and line", () => {
    const scan = scanPublicUrlReferences(
      [
        {
          path: "src/components/Hero.tsx",
          content: `export default () => (\n  <img src="${HERO}" alt="" />\n);\n`,
        },
        {
          path: "src/styles.css",
          content: `.hero { background: url(${HERO}); }\n`,
        },
      ],
      [HERO],
    );

    expect(scan.known).toEqual([
      {
        url: HERO,
        path: "src/components/Hero.tsx",
        line: 2,
        excerpt: `<img src="${HERO}" alt="" />`,
      },
      {
        url: HERO,
        path: "src/styles.css",
        line: 1,
        excerpt: `.hero { background: url(${HERO}); }`,
      },
    ]);
  });

  it("does not take a longer path, or another host's, for the URL", () => {
    const scan = scanPublicUrlReferences(
      [
        {
          path: "src/a.tsx",
          content: [
            `const a = "${HERO}.bak";`,
            `const b = "/images/hero.png2";`,
            `const c = "https://cdn.example.com${HERO}";`,
            `const d = "/other${HERO}";`,
          ].join("\n"),
        },
      ],
      [HERO],
    );
    expect(scan.known).toEqual([]);
  });

  it("reports a line that may build the URL as possible, not known", () => {
    const scan = scanPublicUrlReferences(
      [
        {
          path: "src/Gallery.tsx",
          content: [
            "const src = `/images/${name}.png`;",
            'const alt = "/images/" + name;',
            'const plain = "/images/other.png";',
          ].join("\n"),
        },
      ],
      [HERO],
    );

    expect(scan.known).toEqual([]);
    expect(scan.possible.map((ref) => [ref.line, ref.url])).toEqual([
      [1, "/images/"],
      [2, "/images/"],
    ]);
  });

  it("reports nothing for text that names neither the URL nor its folder", () => {
    expect(
      scanPublicUrlReferences(
        [{ path: "src/a.tsx", content: "const x = `${y}` + z;" }],
        [HERO],
      ),
    ).toEqual({ known: [], possible: [] });
  });
});
