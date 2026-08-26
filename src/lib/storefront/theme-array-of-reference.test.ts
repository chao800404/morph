import { describe, expect, it } from "vitest";
import { resolveThemeContentCapabilitiesFromFiles } from "./theme-content-capability-resolver";

const list = (fieldsDeclaration: string) => ({
  path: "src/components/List.tsx",
  content: `export const contentFields = ${fieldsDeclaration};
export default function List() { return null; }`,
});

const card = {
  path: "src/components/Card.tsx",
  content: `export const contentFields = {
  number: { type: "text", label: "Number", maxLength: 4 },
  title: { type: "text", label: "Title" },
};
export default function Card() { return null; }`,
};

const resolve = (files: { path: string; content: string }[]) =>
  resolveThemeContentCapabilitiesFromFiles(files);

describe("array rows declared by reference", () => {
  it("takes the row shape from the component that renders one row", () => {
    // The row component keeps its own declaration; nothing is repeated in the
    // parent, which is the whole point of extracting a row into a component.
    const result = resolve([
      list(`{ items: { type: "array", label: "Items", of: "./Card" } }`),
      card,
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(
      result.capabilities["src/components/List.tsx"]?.fields.items,
    ).toEqual({
      type: "array",
      label: "Items",
      of: "./Card",
      fields: {
        number: { type: "text", label: "Number", maxLength: 4 },
        title: { type: "text", label: "Title" },
      },
    });
  });

  it("still accepts a row shape declared inline", () => {
    // Both styles must work: extracting a row into its own component is a
    // choice, not a requirement.
    const result = resolve([
      list(
        `{ items: { type: "array", fields: { title: { type: "text" } } } }`,
      ),
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(
      result.capabilities["src/components/List.tsx"]?.fields.items,
    ).toMatchObject({ fields: { title: { type: "text" } } });
  });

  it("reports a reference that resolves to nothing instead of showing an empty list", () => {
    // Silence here is how a mistyped path goes unnoticed — the list would look
    // like it simply had no entries.
    const result = resolve([
      list(`{ items: { type: "array", of: "./Missing" } }`),
      card,
    ]);

    expect(result.diagnostics.join(" ")).toContain("./Missing");
    expect(result.capabilities["src/components/List.tsx"]).toBeUndefined();
  });

  it("refuses a declaration that names both a shape and a reference", () => {
    // Which one wins would otherwise have to be discovered by experiment.
    const result = resolve([
      list(
        `{ items: { type: "array", of: "./Card", fields: { title: { type: "text" } } } }`,
      ),
      card,
    ]);

    expect(
      result.capabilities["src/components/List.tsx"]?.fields.items,
    ).toBeUndefined();
  });

  it("does not let a row component turn a row into a list of lists", () => {
    const nested = {
      path: "src/components/Card.tsx",
      content: `export const contentFields = {
  title: { type: "text" },
  tags: { type: "array", fields: { name: { type: "text" } } },
};
export default function Card() { return null; }`,
    };
    const result = resolve([
      list(`{ items: { type: "array", of: "./Card" } }`),
      nested,
    ]);

    expect(
      (result.capabilities["src/components/List.tsx"]?.fields.items as any)
        ?.fields,
    ).toEqual({ title: { type: "text" } });
  });

  it("resolves a reference that omits the file extension or names a directory", () => {
    const indexCard = {
      path: "src/components/Card/index.tsx",
      content: card.content,
    };
    const result = resolve([
      list(`{ items: { type: "array", of: "./Card" } }`),
      indexCard,
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(
      (result.capabilities["src/components/List.tsx"]?.fields.items as any)
        ?.fields.title,
    ).toEqual({ type: "text", label: "Title" });
  });

  it("refuses a reference that leaves the Theme workspace", () => {
    const result = resolve([
      list(`{ items: { type: "array", of: "../../etc/passwd" } }`),
    ]);

    expect(result.capabilities["src/components/List.tsx"]).toBeUndefined();
  });
});
