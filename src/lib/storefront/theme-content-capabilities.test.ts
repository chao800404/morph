import { describe, expect, it } from "vitest";
import {
  filterThemeContentProps,
  parseRejectedContentField,
  rejectedContentFieldKey,
  getThemeComponentContentCapability,
  parseThemeContentCapabilities,
} from "./theme-content-capabilities";

const manifest = JSON.stringify({
  components: {
    "promo.default": {
      source: "src/components/Promo.tsx",
      contentFields: {
        heading: { type: "text", label: "Heading", maxLength: 80 },
        body: { type: "textarea", label: "Body" },
        href: { type: "url", label: "Link" },
        image: { type: "image", label: "Image" },
        video: { type: "video", label: "Video", allowExternal: false },
        emphasis: {
          type: "select",
          label: "Emphasis",
          options: [
            { label: "Quiet", value: "quiet" },
            { label: "Strong", value: "strong" },
          ],
        },
      },
    },
  },
  sections: {
    promo: {
      componentRef: "promo.default",
      source: "src/components/Promo.tsx",
    },
  },
});

describe("Theme content capabilities", () => {
  it("parses bounded component content field metadata", () => {
    const result = parseThemeContentCapabilities(manifest);

    expect(result.diagnostics).toEqual([]);
    expect(result.capabilities["promo.default"]?.fields.heading).toEqual({
      type: "text",
      label: "Heading",
      maxLength: 80,
    });
    expect(result.sectionComponentRefs.promo).toBe("promo.default");
  });

  it("keeps valid components isolated from malformed component entries", () => {
    const result = parseThemeContentCapabilities(
      JSON.stringify({
        components: {
          "promo.default": JSON.parse(manifest).components["promo.default"],
          "broken.default": {
            contentFields: { heading: { type: "executable" } },
          },
        },
      }),
    );

    expect(result.capabilities["promo.default"]).toBeDefined();
    expect(result.capabilities["broken.default"]?.fields).toEqual({});
    expect(result.diagnostics).toHaveLength(1);
  });

  it("filters undeclared props and validates declared values", () => {
    const capability = getThemeComponentContentCapability(
      manifest,
      "promo.default",
    );
    expect(capability).not.toBeNull();

    expect(
      filterThemeContentProps(
        {
          heading: "A thoughtful default",
          emphasis: "strong",
          className: "fixed inset-0",
        },
        capability!,
      ),
    ).toEqual({
      heading: "A thoughtful default",
      emphasis: "strong",
    });
  });

  it("rejects invalid types, unsafe URLs, bounds and select values", () => {
    const capability = getThemeComponentContentCapability(
      manifest,
      "promo.default",
    )!;

    expect(() => filterThemeContentProps({ heading: 42 }, capability)).toThrow(
      "INVALID_THEME_CONTENT_FIELD_VALUE:heading",
    );
    expect(() =>
      filterThemeContentProps({ heading: "x".repeat(81) }, capability),
    ).toThrow("INVALID_THEME_CONTENT_FIELD_VALUE:heading");
    expect(() =>
      filterThemeContentProps({ href: "javascript:alert(1)" }, capability),
    ).toThrow("INVALID_THEME_CONTENT_FIELD_VALUE:href");
    expect(() =>
      filterThemeContentProps({ emphasis: "unknown" }, capability),
    ).toThrow("INVALID_THEME_CONTENT_FIELD_VALUE:emphasis");
  });

  it("accepts external and Asset-backed media while rejecting mismatched media", () => {
    const capability = getThemeComponentContentCapability(
      manifest,
      "promo.default",
    )!;

    expect(
      filterThemeContentProps(
        {
          image: {
            source: "asset",
            mediaType: "image",
            assetId: "6550fe95-9fb0-4008-b837-962da1b449d7",
            url: "/cdn/hero.webp",
            name: "Hero",
          },
          video: {
            source: "asset",
            mediaType: "video",
            assetId: "24418689-71d5-4591-a5c7-eff52f7c848f",
            url: "https://cdn.example.com/hero.mp4",
          },
        },
        capability,
      ),
    ).toMatchObject({
      image: {
        source: "asset",
        mediaType: "image",
        assetId: "6550fe95-9fb0-4008-b837-962da1b449d7",
      },
      video: {
        source: "asset",
        mediaType: "video",
        assetId: "24418689-71d5-4591-a5c7-eff52f7c848f",
      },
    });
    expect(() =>
      filterThemeContentProps(
        {
          image: {
            source: "external",
            mediaType: "video",
            url: "https://cdn.example.com/hero.mp4",
          },
        },
        capability,
      ),
    ).toThrow("INVALID_THEME_CONTENT_FIELD_VALUE:image:wrong-media-type");
    expect(() =>
      filterThemeContentProps(
        {
          image: {
            source: "external",
            mediaType: "image",
            url: "javascript:alert(1)",
          },
        },
        capability,
      ),
    ).toThrow("INVALID_THEME_CONTENT_FIELD_VALUE:image:bad-media-url");
    expect(() =>
      filterThemeContentProps(
        { video: "https://cdn.example.com/hero.mp4" },
        capability,
      ),
    ).toThrow(
      "INVALID_THEME_CONTENT_FIELD_VALUE:video:external-media-disabled",
    );
  });
});

const arrayManifest = JSON.stringify({
  components: {
    "principles.default": {
      source: "src/components/Principles.tsx",
      contentFields: {
        label: { type: "text", label: "Section label" },
        items: {
          type: "array",
          label: "Principles",
          minRows: 1,
          maxRows: 3,
          fields: {
            number: { type: "text", maxLength: 4 },
            title: { type: "text" },
            body: { type: "textarea" },
          },
        },
      },
    },
  },
  sections: {},
});

const arrayCapability = () =>
  parseThemeContentCapabilities(arrayManifest).capabilities[
    "principles.default"
  ]!;

const row = (id: string, title: string) => ({
  id,
  number: "01",
  title,
  body: "b",
});

describe("array content fields", () => {
  it("parses a repeated group of row fields", () => {
    const result = parseThemeContentCapabilities(arrayManifest);

    expect(result.diagnostics).toEqual([]);
    expect(result.capabilities["principles.default"]?.fields.items).toEqual({
      type: "array",
      label: "Principles",
      minRows: 1,
      maxRows: 3,
      fields: {
        number: { type: "text", maxLength: 4 },
        title: { type: "text" },
        body: { type: "textarea" },
      },
    });
  });

  it("keeps each row's identity, which styles and ordering are keyed by", () => {
    const filtered = filterThemeContentProps(
      { items: [row("r1", "One"), row("r2", "Two")] },
      arrayCapability(),
    );

    expect(filtered.items).toEqual([row("r1", "One"), row("r2", "Two")]);
  });

  it("drops undeclared row keys instead of rejecting the whole row", () => {
    // A row may still carry runtime data the Design surface never writes;
    // rejecting it would make the section uneditable rather than safe.
    const filtered = filterThemeContentProps(
      { items: [{ ...row("r1", "One"), internalRef: "x" }] },
      arrayCapability(),
    );

    expect(filtered.items).toEqual([row("r1", "One")]);
  });

  it("validates row values against the row field definitions", () => {
    expect(() =>
      filterThemeContentProps(
        { items: [{ ...row("r1", "One"), number: "toolong" }] },
        arrayCapability(),
      ),
    ).toThrow(/INVALID_THEME_CONTENT_FIELD_VALUE:items\.0\.number/);
  });

  it("enforces the declared row bounds", () => {
    expect(() =>
      filterThemeContentProps({ items: [] }, arrayCapability()),
    ).toThrow(/INVALID_THEME_CONTENT_FIELD_VALUE:items/);
    expect(() =>
      filterThemeContentProps(
        { items: [row("a", "1"), row("b", "2"), row("c", "3"), row("d", "4")] },
        arrayCapability(),
      ),
    ).toThrow(/INVALID_THEME_CONTENT_FIELD_VALUE:items/);
  });

  it("refuses a row that is itself a list", () => {
    // Declaring an array inside an array is rejected at parse time, so a value
    // shaped that way can only be malformed input.
    const nested = JSON.stringify({
      components: {
        "x.default": {
          source: "src/components/X.tsx",
          contentFields: {
            items: {
              type: "array",
              fields: {
                inner: { type: "array", fields: { a: { type: "text" } } },
              },
            },
          },
        },
      },
      sections: {},
    });

    const result = parseThemeContentCapabilities(nested);

    // The field is dropped and reported; the component itself survives, the
    // same way any other invalid field is handled.
    expect(result.capabilities["x.default"]?.fields).toEqual({});
    expect(result.diagnostics.join(" ")).toContain("items");
  });
});

describe("rejectedContentFieldKey", () => {
  // The field name is the only thing that tells the editor which of a dozen
  // controls to look at, so it has to survive the trip back to the client.
  it("recovers the field a rejected value belongs to", () => {
    let thrown = "";
    try {
      filterThemeContentProps(
        { heading: 42 },
        { fields: { heading: { type: "text", label: "Heading" } } },
      );
    } catch (error) {
      thrown = error instanceof Error ? error.message : "";
    }

    expect(rejectedContentFieldKey(thrown)).toBe("heading");
  });

  it("keeps the row path when the failure is inside an array", () => {
    let thrown = "";
    try {
      filterThemeContentProps(
        { items: [{ title: "ok" }, { title: 7 }] },
        {
          fields: {
            items: {
              type: "array",
              label: "Items",
              fields: { title: { type: "text", label: "Title" } },
            },
          },
        },
      );
    } catch (error) {
      thrown = error instanceof Error ? error.message : "";
    }

    // Not just "items": the editor can point at the offending row.
    expect(rejectedContentFieldKey(thrown)).toBe("items.1.title");
  });

  it("returns null for an unrelated error", () => {
    expect(
      rejectedContentFieldKey("CONFLICT_SOURCE_GENERATION_MISMATCH"),
    ).toBeNull();
    expect(rejectedContentFieldKey("")).toBeNull();
    expect(
      rejectedContentFieldKey("INVALID_THEME_CONTENT_FIELD_VALUE:"),
    ).toBeNull();
  });
});

describe("parseRejectedContentField", () => {
  const reasonFor = (fields: unknown, value: unknown) => {
    try {
      filterThemeContentProps({ items: value }, {
        fields: { items: fields },
      } as never);
    } catch (error) {
      return parseRejectedContentField(
        error instanceof Error ? error.message : "",
      );
    }
    return null;
  };

  const listOf = (extra: Record<string, unknown> = {}) => ({
    type: "array",
    label: "Items",
    fields: { title: { type: "text", label: "Title" } },
    ...extra,
  });

  // Every one of these used to surface as the bare word "items", which told an
  // author nothing about what to change.
  it("says a list was not a list", () => {
    expect(reasonFor(listOf(), "not a list")).toEqual({
      fieldKey: "items",
      reason: "not-a-list",
    });
  });

  it("says the row shape was never declared", () => {
    expect(
      reasonFor({ type: "array", label: "Items" }, [{ title: "a" }]),
    ).toEqual({ fieldKey: "items", reason: "row-shape-not-declared" });
  });

  it("says which row is not an object, and which one", () => {
    expect(reasonFor(listOf(), [{ title: "ok" }, "oops"])).toEqual({
      fieldKey: "items",
      reason: "row-1-is-not-an-object",
    });
  });

  it("says the row count broke a declared bound", () => {
    expect(reasonFor(listOf({ maxRows: 1 }), [{}, {}])).toEqual({
      fieldKey: "items",
      reason: "allows-at-most-1-rows",
    });
    expect(reasonFor(listOf({ minRows: 2 }), [{}])).toEqual({
      fieldKey: "items",
      reason: "needs-at-least-2-rows",
    });
  });

  // A row-level failure keeps its path and needs no separate reason.
  it("keeps a dotted row path intact", () => {
    expect(reasonFor(listOf(), [{ title: 7 }])).toEqual({
      fieldKey: "items.0.title",
      reason: null,
    });
  });

  it("returns null for an unrelated error", () => {
    expect(parseRejectedContentField("SOMETHING_ELSE")).toBeNull();
  });
});
