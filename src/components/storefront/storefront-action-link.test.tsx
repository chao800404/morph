import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { StorefrontDocumentRenderer } from "./storefront-document-renderer";

/**
 * The Inspector's Action Button writes `actionHref` and `actionTarget`.
 *
 * These assert the rendered anchor, because that is where the author's choice
 * either takes effect or silently does nothing.
 */
function renderHero(props: Record<string, unknown>) {
  const document: StorefrontPageDocument = {
    version: 1,
    sections: [
      {
        id: "hero-1",
        type: "hero",
        componentRef: "hero.default",
        enabled: true,
        props: { actionLabel: "Go", ...props },
      },
    ],
  };
  const { container } = render(
    <StorefrontDocumentRenderer document={document} />,
  );
  return container.querySelector<HTMLAnchorElement>(
    '[data-storefront-field="actionLabel"]',
  );
}

describe("action link destination", () => {
  it("keeps an in-store path", () => {
    const anchor = renderHero({ actionHref: "/collections/new" });
    expect(anchor?.getAttribute("href")).toBe("/collections/new");
  });

  it("keeps an external URL", () => {
    const anchor = renderHero({ actionHref: "https://example.com/lookbook" });
    expect(anchor?.getAttribute("href")).toBe("https://example.com/lookbook");
  });

  it("drops a script destination rather than rendering it", () => {
    // The href is omitted entirely, which leaves an inert anchor instead of one
    // that would run the script when activated.
    const anchor = renderHero({ actionHref: "javascript:alert(1)" });
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBeNull();
    expect(anchor?.outerHTML).not.toContain("javascript:");
  });
});

describe("action link target", () => {
  it("stays in the same tab by default", () => {
    const anchor = renderHero({ actionHref: "/a" });
    expect(anchor?.getAttribute("target")).toBeNull();
    expect(anchor?.getAttribute("rel")).toBeNull();
  });

  it("stays in the same tab when explicitly set", () => {
    const anchor = renderHero({ actionHref: "/a", actionTarget: "_self" });
    expect(anchor?.getAttribute("target")).toBeNull();
  });

  it("opens an in-store path in a new tab without leaking opener", () => {
    const anchor = renderHero({ actionHref: "/a", actionTarget: "_blank" });
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noopener");
  });

  it("opens an external URL in a new tab with noopener and noreferrer", () => {
    // Without noopener the opened site can redirect this tab through
    // window.opener (reverse tabnabbing).
    const anchor = renderHero({
      actionHref: "https://example.com",
      actionTarget: "_blank",
    });
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("ignores a target it does not recognise", () => {
    const anchor = renderHero({ actionHref: "/a", actionTarget: "_parent" });
    expect(anchor?.getAttribute("target")).toBeNull();
  });
});
