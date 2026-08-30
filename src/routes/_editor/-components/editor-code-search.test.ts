import { describe, expect, it } from "vitest";
import {
  findEditorCodeMatches,
  replaceEditorCodeMatches,
} from "./editor-code-search";

const files = [
  {
    path: "src/components/Hero.tsx",
    content: "const Hero = () => <h1>Hero title</h1>;\nexport default Hero;",
  },
  {
    path: "src/routes/index.tsx",
    content: 'import Hero from "../components/Hero";\n<Hero />;',
  },
];

describe("editor code workspace search", () => {
  it("finds matches with source positions across files", () => {
    const matches = findEditorCodeMatches(files, "Hero", {
      matchCase: true,
      wholeWord: true,
      useRegex: false,
    });

    expect(matches).toHaveLength(6);
    expect(matches[0]).toMatchObject({
      path: "src/components/Hero.tsx",
      line: 1,
      column: 7,
    });
    expect(matches.at(-1)).toMatchObject({
      path: "src/routes/index.tsx",
      line: 2,
      column: 2,
    });
  });

  it("supports regular expressions and bounded replacement", () => {
    const replacements = replaceEditorCodeMatches(
      files,
      "Hero(?= title)",
      "Banner",
      { matchCase: true, wholeWord: false, useRegex: true },
    );

    expect(replacements).toEqual([
      {
        path: "src/components/Hero.tsx",
        content:
          "const Hero = () => <h1>Banner title</h1>;\nexport default Hero;",
        replacementCount: 1,
      },
    ]);
  });

  it("returns no results for an invalid regular expression", () => {
    expect(
      findEditorCodeMatches(files, "[", {
        matchCase: false,
        wholeWord: false,
        useRegex: true,
      }),
    ).toEqual([]);
  });
});
