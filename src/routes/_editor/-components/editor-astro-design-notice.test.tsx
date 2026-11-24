import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ASTRO_BASIS_UNCONFIRMED_MESSAGE } from "@/lib/storefront/editor/astro-basis-presentation";
import { ASTRO_SELECTION_RECHECKING_MESSAGE } from "@/lib/storefront/editor/astro-design-focus";
import { EditorAstroDesignNotice } from "./editor-astro-design-notice";

// Q2: the Astro basis hint is shown at the top of the Inspector for the
// selected section, through the shared Alert primitive, as a polite status.

describe("EditorAstroDesignNotice", () => {
  it("names the section and says what to do when its basis is unconfirmed", () => {
    render(
      <EditorAstroDesignNotice
        notice={{
          sectionId: "hero",
          tone: "unconfirmed",
          message: ASTRO_BASIS_UNCONFIRMED_MESSAGE,
          badge: "Reload preview",
          action: "reload-preview",
        }}
      />,
    );
    const status = screen.getByRole("status");
    expect(status.getAttribute("data-astro-design-notice")).toBe("unconfirmed");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain("hero");
    expect(status.textContent).toContain(ASTRO_BASIS_UNCONFIRMED_MESSAGE);
  });

  it("says the selection could not be restored when there is no section any more", () => {
    render(
      <EditorAstroDesignNotice
        notice={{
          sectionId: null,
          tone: "unconfirmed",
          message: "Reload the preview, then select it again.",
          badge: "Reload preview",
          action: "reload-preview",
        }}
      />,
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toContain(
      "Couldn't restore your selection. Select the section again.",
    );
    expect(status.textContent).toContain(
      "Reload the preview, then select it again.",
    );
  });

  it("says it is checking while Core's view is read again", () => {
    render(
      <EditorAstroDesignNotice
        notice={{
          sectionId: "hero",
          tone: "checking",
          message: ASTRO_SELECTION_RECHECKING_MESSAGE,
          badge: "Checking…",
          action: null,
        }}
      />,
    );
    const status = screen.getByRole("status");
    expect(status.getAttribute("data-astro-design-notice")).toBe("checking");
    expect(status.textContent).toContain(ASTRO_SELECTION_RECHECKING_MESSAGE);
    expect(status.textContent).toContain(
      "Checking whether this section can be edited in Design…",
    );
  });
});
