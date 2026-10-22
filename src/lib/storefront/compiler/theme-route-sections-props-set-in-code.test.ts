import { describe, expect, it } from "vitest";
import { readSlotPropsSetInCode } from "./theme-route-sections";

/**
 * Which of a slot's props the page's code sets in place of the stored ones,
 * read from the call sites that spread the slot: what the Inspector withholds
 * from a section's Content form.
 */
const ROUTE = "src/routes/index.tsx";

function read(body: string, preamble = "") {
  const files = [
    {
      path: ROUTE,
      content: `import { content } from "../morph/content";
import Hero from "../components/Hero";
${preamble}
export function Home() {
  return <main>${body}</main>;
}`,
    },
  ];
  const result = readSlotPropsSetInCode(files, [ROUTE], "hero");
  return result === "any" || result === null ? result : [...result].sort();
}

describe("readSlotPropsSetInCode", () => {
  it.each([
    [
      "a literal after content()",
      `<Hero {...content("hero")} title="Sale" />`,
      ["title"],
    ],
    [
      "another section's value after content()",
      `<Hero {...content("hero")} title={other.title} />`,
      ["title"],
    ],
    [
      "several attributes after the spread",
      `<Hero {...content("hero")} title="A" badge={null} />`,
      ["badge", "title"],
    ],
    [
      "children between the tags",
      `<Hero {...content("hero")}>Child</Hero>`,
      ["children"],
    ],
    ["a page member", `<Hero {...home.hero} title="Sale" />`, ["title"]],
    [
      "a computed page member",
      `<Hero {...home["hero"]} title="Sale" />`,
      ["title"],
    ],
    [
      "a local named for the slot",
      `<Hero {...hero} title="Sale" />`,
      ["title"],
    ],
  ])("%s", (_, body, expected) => {
    expect(read(body)).toEqual(expected);
  });

  it("a local the slot is destructured into under another name", () => {
    expect(
      read(`<Hero {...h} title="Sale" />`, `const { hero: h } = { hero: {} };`),
    ).toEqual(["title"]);
  });

  it("a later spread may set any prop", () => {
    expect(read(`<Hero {...content("hero")} {...extra} />`)).toBe("any");
  });

  it.each([
    ["a sole spread", `<Hero {...content("hero")} />`],
    ["a key", `<Hero key="k" {...content("hero")} />`],
    [
      "a prop before the spread, which the spread replaces",
      `<Hero title="Sale" {...content("hero")} />`,
    ],
    ["another slot's call site", `<Hero {...content("other")} title="Sale" />`],
    [
      "whitespace that spans a line break",
      `<Hero {...content("hero")}>\n</Hero>`,
    ],
  ])("nothing for %s", (_, body) => {
    expect(read(body)).toBeNull();
  });

  it("reads every file it is given, a layout as well as the route", () => {
    const layout = "src/layouts/Shell.tsx";
    const files = [
      { path: ROUTE, content: `export function Home() { return <main />; }` },
      {
        path: layout,
        content: `import { content } from "../morph/content";
import Header from "../components/Header";
export default function Shell() {
  return <Header {...content("hero")} title="Shop" />;
}`,
      },
    ];
    expect(readSlotPropsSetInCode(files, [ROUTE], "hero")).toBeNull();
    expect([
      ...(readSlotPropsSetInCode(
        files,
        [ROUTE, layout],
        "hero",
      ) as Set<string>),
    ]).toEqual(["title"]);
  });

  it("a file that does not parse names nothing", () => {
    expect(
      readSlotPropsSetInCode(
        [{ path: ROUTE, content: "<<<" }],
        [ROUTE],
        "hero",
      ),
    ).toBeNull();
  });
});
