import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  PAGE_SIDEBAR_WIDTH,
  RESPONSIVE_PAGE_SIDEBAR_WIDTH,
  PageSplitLayout,
} from "./page-split-layout";

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

    expect(aside?.className).toContain(RESPONSIVE_PAGE_SIDEBAR_WIDTH);
    expect(aside?.className).toContain("shrink-0");
    // Without `min-w-0` a wide table inside the content column pushes the
    // sidebar off screen instead of scrolling.
    expect(section?.className).toContain("min-w-0");
  });

  it("stacks detail pages below 1280px", () => {
    const { container } = render(
      <PageSplitLayout sidebar={<p>side</p>}>
        <p>main</p>
      </PageSplitLayout>,
    );

    expect(container.firstElementChild?.className).toContain("grid-cols-1");
    expect(container.firstElementChild?.className).toContain(
      "xl:grid-cols-[minmax(0,1fr)_auto]",
    );
  });

  it("allows Assets to keep both columns on one row", () => {
    const { container } = render(
      <PageSplitLayout sidebar={<p>side</p>} stackBelow1280={false}>
        <p>main</p>
      </PageSplitLayout>,
    );

    expect(container.firstElementChild?.className).toContain(
      "grid-cols-[minmax(0,1fr)_auto]",
    );
    expect(container.firstElementChild?.className).not.toContain("grid-cols-1");
    expect(container.querySelector("aside")?.className).toContain(
      PAGE_SIDEBAR_WIDTH,
    );
  });

  it("allows a page to override the shared sidebar width", () => {
    const { container } = render(
      <PageSplitLayout
        sidebar={<p>side</p>}
        sidebarClassName="w-72"
      >
        <p>main</p>
      </PageSplitLayout>,
    );

    expect(container.querySelector("aside")?.className).toContain("w-72");
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
