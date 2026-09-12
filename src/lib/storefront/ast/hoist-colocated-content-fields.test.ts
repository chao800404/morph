// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hoistColocatedContentFieldsForPreview } from "./hoist-colocated-content-fields";
import { parseColocatedContentFields } from "./theme-content-fields-source";

const hero = (body: string) => ({
  path: "src/components/Hero.tsx",
  content: body,
});

const HERO_SOURCE = `import type { ThemeContentFields } from "../morph/content-fields";

export const contentFields = {
  heading: { type: "text", label: "Heading" },
} as const satisfies ThemeContentFields;

export default function Hero({ heading }: { heading?: string }) {
  return <h1>{heading}</h1>;
}
`;

const contentOf = (
  result: ReturnType<typeof hoistColocatedContentFieldsForPreview>,
  path: string,
) => result.files.find((file) => file.path === path)?.content ?? "";

describe("hoisting co-located contentFields for the preview", () => {
  it("leaves the module exporting only its component", () => {
    const result = hoistColocatedContentFieldsForPreview([hero(HERO_SOURCE)]);
    const output = contentOf(result, "src/components/Hero.tsx");

    expect(result.hoisted).toEqual(["src/components/Hero.tsx"]);
    expect(output).not.toContain("export const contentFields");
    expect(output).toContain("const contentFields = {");
    expect(output).toContain("export default function Hero");
  });

  it("moves no byte, so every JSX source position still points where it did", () => {
    const result = hoistColocatedContentFieldsForPreview([hero(HERO_SOURCE)]);
    const output = contentOf(result, "src/components/Hero.tsx");

    expect(output).toHaveLength(HERO_SOURCE.length);
    expect(output.split("\n")).toHaveLength(HERO_SOURCE.split("\n").length);
    expect(output.indexOf("<h1>")).toBe(HERO_SOURCE.indexOf("<h1>"));
    expect(output.indexOf("export default")).toBe(
      HERO_SOURCE.indexOf("export default"),
    );
  });

  it("produces a copy the editor must never read, and leaves the original intact", () => {
    // The transformed module no longer exports the declaration, so the editor
    // would read it as absent. That is the whole reason this runs on the copy
    // sent to the preview container and never on the Theme's stored source.
    const input = [hero(HERO_SOURCE)];
    const result = hoistColocatedContentFieldsForPreview(input);

    expect(
      parseColocatedContentFields(contentOf(result, "src/components/Hero.tsx"))
        .declaration,
    ).toBe("absent");

    expect(input[0]!.content).toBe(HERO_SOURCE);
    const fromSource = parseColocatedContentFields(HERO_SOURCE);
    expect(fromSource.declaration).toBe("valid");
    expect(Object.keys(fromSource.fields ?? {})).toEqual(["heading"]);
  });

  it("leaves a module alone when another module imports its declaration", () => {
    const result = hoistColocatedContentFieldsForPreview([
      hero(HERO_SOURCE),
      {
        path: "src/components/HeroTwin.tsx",
        content: `import { contentFields } from "./Hero";\nexport default function HeroTwin() { return <span>{Object.keys(contentFields).length}</span>; }\n`,
      },
    ]);

    expect(result.hoisted).toEqual([]);
    expect(contentOf(result, "src/components/Hero.tsx")).toBe(HERO_SOURCE);
    expect(result.skipped[0]?.reason).toContain("Another module imports");
  });

  it("leaves a module alone when the export carries other names too", () => {
    const result = hoistColocatedContentFieldsForPreview([
      hero(
        `const contentFields = {};\nconst other = 1;\nexport { contentFields, other };\n`,
      ),
    ]);

    expect(result.hoisted).toEqual([]);
    expect(result.skipped[0]?.reason).toContain("lone");
  });

  it("removes a lone specifier export as well as a declaration", () => {
    const result = hoistColocatedContentFieldsForPreview([
      hero(
        `const contentFields = { a: { type: "text" } };\nexport { contentFields };\nexport default function Hero() { return null; }\n`,
      ),
    ]);
    const output = contentOf(result, "src/components/Hero.tsx");

    expect(result.hoisted).toEqual(["src/components/Hero.tsx"]);
    expect(output).not.toContain("export { contentFields }");
    expect(output).toContain("const contentFields = {");
  });

  it("touches nothing in a module that declares no fields", () => {
    const source = `export default function Plain() { return <p>hi</p>; }\n`;
    const result = hoistColocatedContentFieldsForPreview([hero(source)]);

    expect(result.hoisted).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(contentOf(result, "src/components/Hero.tsx")).toBe(source);
  });

  it("hands unparseable source back untouched rather than guessing", () => {
    const source = `export const contentFields = { <<< broken`;
    const result = hoistColocatedContentFieldsForPreview([hero(source)]);

    expect(contentOf(result, "src/components/Hero.tsx")).toBe(source);
    expect(result.hoisted).toEqual([]);
    expect(result.skipped[0]?.path).toBe("src/components/Hero.tsx");
  });
});
