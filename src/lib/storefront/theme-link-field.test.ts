import { describe, expect, it } from "vitest";
import { parseColocatedContentFields } from "./ast/theme-content-fields-source";
import { filterThemeContentProps } from "./theme-content-capabilities";
import {
  normalizeThemeLinkValue,
  themeLinkAttributes,
} from "./theme-link";

/**
 * `type: "link"` is the declaration a Theme author writes to get a destination
 * picker instead of a raw text box. These cover the three places it has to hold
 * together: parsing the declaration, validating a stored value, and turning
 * that value into anchor attributes.
 */
describe("declaring a link field", () => {
  it("is accepted in a component's own contentFields", () => {
    const result = parseColocatedContentFields(`
export const contentFields = {
  action: { type: "link", label: "Action Button" },
} as const;

export default function Hero() {
  return <section />;
}
`);

    expect(result.diagnostics).toEqual([]);
    expect(result.fields).toEqual({
      action: { type: "link", label: "Action Button" },
    });
  });

  it("is accepted inside a repeated row", () => {
    const result = parseColocatedContentFields(`
export const contentFields = {
  items: {
    type: "array",
    fields: {
      title: { type: "text" },
      link: { type: "link", label: "Destination" },
    },
  },
} as const;

export default function Cards() {
  return <section />;
}
`);

    expect(result.diagnostics).toEqual([]);
    expect(result.fields?.items).toMatchObject({
      type: "array",
      fields: { link: { type: "link", label: "Destination" } },
    });
  });

  it("rejects an option the link field does not define", () => {
    const result = parseColocatedContentFields(`
export const contentFields = {
  action: { type: "link", maxLength: 10 },
} as const;
`);

    expect(result.diagnostics.length).toBeGreaterThan(0);
    // Declared but exposing nothing, which is not the same as not declaring:
    // `null` is reserved for a module with no declaration, and only that may
    // fall back to the manifest.
    expect(result.declaration).toBe("valid");
    expect(result.fields).toEqual({});
  });
});

const linkCapability = {
  fields: { action: { type: "link" as const, label: "Action" } },
} as never;

describe("storing a link value", () => {
  it("keeps a full link", () => {
    const value = {
      href: "/about",
      target: "_blank" as const,
      nofollow: true,
      title: "About us",
      ariaLabel: "Read about us",
    };
    expect(filterThemeContentProps({ action: value }, linkCapability)).toEqual({
      action: value,
    });
  });

  it("keeps a bare string so a url field can become a link without migrating", () => {
    expect(
      filterThemeContentProps({ action: "/about" }, linkCapability),
    ).toEqual({ action: "/about" });
  });

  it("refuses a destination that would run script", () => {
    expect(() =>
      filterThemeContentProps(
        { action: { href: "javascript:alert(1)" } },
        linkCapability,
      ),
    ).toThrow(/INVALID_THEME_CONTENT_FIELD_VALUE/);
  });

  it("refuses an unknown key rather than storing it unchecked", () => {
    expect(() =>
      filterThemeContentProps(
        { action: { href: "/a", onclick: "steal()" } },
        linkCapability,
      ),
    ).toThrow(/INVALID_THEME_CONTENT_FIELD_VALUE/);
  });

  it("refuses a target the renderer would not honour", () => {
    expect(() =>
      filterThemeContentProps(
        { action: { href: "/a", target: "_parent" } },
        linkCapability,
      ),
    ).toThrow(/INVALID_THEME_CONTENT_FIELD_VALUE/);
  });
});

describe("normalizeThemeLinkValue", () => {
  it("reads a bare string as the destination", () => {
    expect(normalizeThemeLinkValue("/about")).toEqual({
      href: "/about",
      target: "_self",
    });
  });

  it("survives a missing or malformed value", () => {
    expect(normalizeThemeLinkValue(undefined).href).toBe("");
    expect(normalizeThemeLinkValue(["/a"]).href).toBe("");
  });
});

describe("themeLinkAttributes", () => {
  it("emits nothing extra for a plain in-store link", () => {
    expect(themeLinkAttributes({ href: "/about" })).toEqual({
      href: "/about",
      target: undefined,
      rel: undefined,
      title: undefined,
      "aria-label": undefined,
    });
  });

  it("protects a cross-origin new tab without being asked", () => {
    expect(themeLinkAttributes({ href: "https://x.com", target: "_blank" })).toMatchObject(
      { target: "_blank", rel: "noopener noreferrer" },
    );
  });

  it("adds nofollow alongside the protection it cannot replace", () => {
    expect(
      themeLinkAttributes({
        href: "https://x.com",
        target: "_blank",
        nofollow: true,
      }).rel,
    ).toBe("noopener noreferrer nofollow");
  });

  it("adds nofollow on its own for a same-tab link", () => {
    expect(themeLinkAttributes({ href: "https://x.com", nofollow: true }).rel).toBe(
      "nofollow",
    );
  });

  it("drops a script destination, leaving an inert anchor", () => {
    expect(themeLinkAttributes({ href: "javascript:alert(1)" }).href).toBeUndefined();
  });

  it("passes through the advisory and accessible names", () => {
    expect(
      themeLinkAttributes({ href: "/a", title: "T", ariaLabel: "A" }),
    ).toMatchObject({ title: "T", "aria-label": "A" });
  });
});
