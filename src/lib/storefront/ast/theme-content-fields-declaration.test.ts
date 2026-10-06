import { afterEach, describe, expect, it } from "vitest";
import {
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
