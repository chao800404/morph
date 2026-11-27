import { describe, expect, it } from "vitest";
import { parseEditorToPreviewMessage } from "./preview-protocol";
import { resolvePreviewSectionLinks } from "./preview-section-links";

describe("resolvePreviewSectionLinks", () => {
  it("gives the frame the link published content gives a Theme, rel included, and leaves the stored props alone", () => {
    const stored = {
      heading: "Hi",
      guide: { href: "https://example.com/docs", target: "_blank" },
      rows: [{ link: { href: "/about", target: "_blank" } }],
    };
    const sent = resolvePreviewSectionLinks(stored);

    expect(sent).toMatchObject({
      heading: "Hi",
      guide: {
        href: "https://example.com/docs",
        target: "_blank",
        rel: "noopener noreferrer",
      },
      rows: [{ link: { href: "/about", target: "_blank", rel: "noopener" } }],
    });
    expect(stored.guide).toEqual({
      href: "https://example.com/docs",
      target: "_blank",
    });
    // What it sends is what the frame accepts: JSON, no undefined parts.
    expect(
      parseEditorToPreviewMessage({
        type: "morph:storefront-preview-update-section-props",
        sectionId: "cta",
        props: sent,
      }),
    ).not.toBeNull();
  });

  it("passes a post with no props through", () => {
    expect(resolvePreviewSectionLinks(undefined)).toBeUndefined();
  });
});
