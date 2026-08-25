import { describe, expect, it } from "vitest";
import {
  filterThemeContentProps,
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
});
