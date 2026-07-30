import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageSplitLayout } from "./page-split-layout";

/**
 * The split's widths belong to this component. Assets and the category detail
 * page had drifted to different sidebar widths before it existed, so the test
 * pins the metrics rather than trusting each page to repeat them.
 */
describe("PageSplitLayout", () => {
  it("gives the sidebar a fixed width and lets the content take the rest", () => {
    const { container } = render(
      <PageSplitLayout sidebar={<p>side</p>}>
        <p>main</p>
      </PageSplitLayout>,
    );

    const aside = container.querySelector("aside");
    const section = container.querySelector("section");

    expect(aside?.className).toContain("w-md");
    expect(aside?.className).toContain("shrink-0");
    expect(section?.className).toContain("flex-1");
    // Without `min-w-0` a wide table inside the content column pushes the
    // sidebar off screen instead of scrolling.
    expect(section?.className).toContain("min-w-0");
  });

  it("keeps both columns on one row", () => {
    // Stacking would push the sidebar a full viewport down, because the assets
    // explorer's card is `h-content`.
    const { container } = render(
      <PageSplitLayout sidebar={<p>side</p>}>
        <p>main</p>
      </PageSplitLayout>,
    );

    expect(container.firstElementChild?.className).toContain("flex");
    expect(container.firstElementChild?.className).not.toContain("flex-col");
  });

  it("sets no height or alignment of its own", () => {
    // Only Assets locks to the viewport, and it does that on its own cards.
    // Anything here would apply to every split page.
    const { container } = render(
      <PageSplitLayout sidebar={<p>side</p>}>
        <p>main</p>
      </PageSplitLayout>,
    );

    const markup = container.innerHTML;
    for (const height of ["h-full", "h-content", "min-h-content", "items-"]) {
      expect(markup).not.toContain(height);
    }
  });
});
