import { afterEach, describe, expect, it } from "vitest";
import {
  contentFieldsComponentPath,
  contentFieldsSidecarPath,
  isContentFieldsSidecarPath,
  readComponentContentFields,
} from "./theme-content-fields-declaration";

const component = `export default function Hero({ heading }: { heading?: string }) {
  return <h1>{heading}</h1>;
}`;
const declaration = `export const contentFields = {
  heading: { type: "text", label: "Heading" },
  image: { type: "image", label: "Image" },
} as const;`;
const path = "src/components/Hero.tsx";

describe("contentFieldsSidecarPath", () => {
  it("names the sibling of a component source", () => {
    expect(contentFieldsSidecarPath("src/components/Hero.tsx")).toBe(
      "src/components/Hero.fields.ts",
    );
    expect(contentFieldsSidecarPath("src/sections/hero/index.jsx")).toBe(
      "src/sections/hero/index.fields.ts",
    );
  });

  it("has none for files that are not component sources", () => {
    expect(contentFieldsSidecarPath("src/lib/util.ts")).toBeNull();
    expect(contentFieldsSidecarPath("public/hero.tsx")).toBeNull();
  });

  it("recognises a sibling declaration path", () => {
    expect(isContentFieldsSidecarPath("src/components/Hero.fields.ts")).toBe(
      true,
    );
    expect(isContentFieldsSidecarPath("src/components/Hero.tsx")).toBe(false);
  });
});

describe("readComponentContentFields", () => {
  it("reads the component's own declaration when there is no sibling", () => {
    const result = readComponentContentFields({
      path,
      source: `${declaration}\n${component}`,
    });
    expect(result).toMatchObject({
      declaration: "valid",
      origin: "component",
      duplicate: null,
    });
    expect(Object.keys(result.fields ?? {})).toEqual(["heading", "image"]);
  });

  it("reads the sibling when the component declares nothing", () => {
    const result = readComponentContentFields({
      path,
      source: component,
      sidecar: declaration,
    });
    expect(result).toMatchObject({
      declaration: "valid",
      origin: "sidecar",
      duplicate: null,
      diagnostics: [],
    });
    expect(result.fields?.heading).toEqual({ type: "text", label: "Heading" });
  });

  it("uses equal declarations, in any key order, and asks for one to go", () => {
    const reordered = `export const contentFields = {
  image: { label: "Image", type: "image" },
  heading: { label: "Heading", type: "text" },
} as const;`;
    const result = readComponentContentFields({
      path,
      source: `${reordered}\n${component}`,
      sidecar: declaration,
    });
    expect(result).toMatchObject({
      declaration: "valid",
      origin: "sidecar",
      duplicate: "same",
    });
    // The sidecar's order is the panel order.
    expect(Object.keys(result.fields ?? {})).toEqual(["heading", "image"]);
    expect(result.diagnostics.join("\n")).toContain(
      `remove the one in ${path}`,
    );
  });

  it("refuses two declarations that differ, naming both files", () => {
    const result = readComponentContentFields({
      path,
      source: `export const contentFields = { heading: { type: "textarea" } } as const;\n${component}`,
      sidecar: declaration,
    });
    expect(result).toMatchObject({
      declaration: "invalid",
      fields: null,
      duplicate: "different",
    });
    expect(result.diagnostics[0]).toContain(path);
    expect(result.diagnostics[0]).toContain("src/components/Hero.fields.ts");
  });

  it("refuses a sibling that declares no contentFields", () => {
    const result = readComponentContentFields({
      path,
      source: `${declaration}\n${component}`,
      sidecar: "export const fields = {};",
    });
    expect(result.declaration).toBe("invalid");
    expect(result.diagnostics[0]).toContain("does not declare");
  });

  it("refuses a sibling whose declaration is not a static literal", () => {
    const result = readComponentContentFields({
      path,
      source: component,
      sidecar: `const make = () => ({ heading: { type: "text" } });
export const contentFields = make();`,
    });
    expect(result.declaration).toBe("invalid");
  });

  it("refuses a sibling that exists but could not be read", () => {
    const result = readComponentContentFields({
      path,
      source: `${declaration}\n${component}`,
      sidecar: null,
    });
    expect(result.declaration).toBe("invalid");
    expect(result.diagnostics[0]).toContain("could not be read");
  });

  it("refuses when the component's own declaration is unreadable, whatever the sibling says", () => {
    const result = readComponentContentFields({
      path,
      source: `export const contentFields = build();\n${component}`,
      sidecar: declaration,
    });
    expect(result.declaration).toBe("invalid");
  });

  describe("never runs either file", () => {
    afterEach(() => {
      delete (globalThis as Record<string, unknown>).__sidecarRan;
    });

    it("parses a sibling with top-level code without evaluating it", () => {
      const result = readComponentContentFields({
        path,
        source: component,
        sidecar: `globalThis.__sidecarRan = true;
${declaration}`,
      });
      expect(result.declaration).toBe("valid");
      expect(
        (globalThis as Record<string, unknown>).__sidecarRan,
      ).toBeUndefined();
    });
  });
});

// M2 plan v2 §3 (PR-C): an `.astro` component declares its fields only in its
// sibling `<Name>.fields.ts`. The `.astro` file itself is never read as
// JavaScript: Babel cannot parse a template, and finding the frontmatter is
// the Astro parser's job (Core never looks for `---` itself).
describe("an .astro component's content fields", () => {
  const astroPath = "src/components/Hero.astro";
  const astroSource = `---
const { title, desc } = Astro.props;
---
<h1>{title}</h1>
<p>{desc}</p>
`;
  const sidecar = `export const contentFields = {
  title: { type: "text", label: "Title" },
  desc: { type: "textarea", label: "Description" },
} as const;`;

  it("names Hero.fields.ts as the sibling of Hero.astro", () => {
    expect(contentFieldsSidecarPath(astroPath)).toBe(
      "src/components/Hero.fields.ts",
    );
    expect(
      contentFieldsComponentPath("src/components/Hero.fields.ts", [
        "src/components/Hero.fields.ts",
        astroPath,
      ]),
    ).toBe(astroPath);
  });

  it("still has none for an .astro file outside src/", () => {
    expect(contentFieldsSidecarPath("public/Hero.astro")).toBeNull();
  });

  it("reads the sibling declaration", () => {
    const result = readComponentContentFields({
      path: astroPath,
      source: astroSource,
      sidecar,
    });
    expect(result).toMatchObject({
      declaration: "valid",
      origin: "sidecar",
      duplicate: null,
    });
    expect(result.fields).toEqual({
      title: { type: "text", label: "Title" },
      desc: { type: "textarea", label: "Description" },
    });
  });

  it("has no declaration without a sibling, even when the file reads as one", () => {
    // Valid JavaScript declaring contentFields: a .tsx with this text would be
    // `valid`. An .astro file is not read as JavaScript at all.
    const result = readComponentContentFields({
      path: astroPath,
      source: declaration,
    });
    expect(result).toMatchObject({
      declaration: "absent",
      fields: null,
      origin: null,
      duplicate: null,
    });
  });

  it("never touches a parsed source AST handed in for an .astro file", () => {
    const untouchable = new Proxy(
      {},
      {
        get() {
          throw new Error("the .astro source AST was read");
        },
      },
    ) as never;
    const result = readComponentContentFields({
      path: astroPath,
      source: astroSource,
      sidecar,
      parsedSourceAst: untouchable,
    });
    expect(result.declaration).toBe("valid");
  });

  it("uses only the sibling when the .astro text also looks like a declaration", () => {
    // No "declared in both" reconciliation: the .astro text is not a
    // declaration Morph reads, so it can neither duplicate nor contradict.
    const result = readComponentContentFields({
      path: astroPath,
      source: `export const contentFields = { other: { type: "text" } } as const;`,
      sidecar,
    });
    expect(result).toMatchObject({
      declaration: "valid",
      origin: "sidecar",
      duplicate: null,
    });
    expect(Object.keys(result.fields ?? {})).toEqual(["title", "desc"]);
  });

  it("refuses an unreadable or empty sibling as for any component", () => {
    expect(
      readComponentContentFields({
        path: astroPath,
        source: astroSource,
        sidecar: null,
      }).declaration,
    ).toBe("invalid");
    expect(
      readComponentContentFields({
        path: astroPath,
        source: astroSource,
        sidecar: "export const other = 1;",
      }).declaration,
    ).toBe("invalid");
  });
});
