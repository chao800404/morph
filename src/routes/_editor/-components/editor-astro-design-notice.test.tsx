import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ASTRO_BASIS_UNCONFIRMED_MESSAGE } from "@/lib/storefront/editor/astro-basis-presentation";
import { ASTRO_SELECTION_RECHECKING_MESSAGE } from "@/lib/storefront/editor/astro-design-focus";
import {
  EditorAstroDesignNotice,
  EditorAstroDesignStatusBar,
} from "./editor-astro-design-notice";

// Q2: the Astro basis hint is shown at the top of the Inspector for the
// selected section, through the shared Alert primitive, as a polite status.

// Review finding 1: an Astro click opens Code, where the Inspector is not
// shown. The same notice is said in a status bar that Code mode shows. Its
// status region is mounted before anything is said, so a screen reader hears
// the text when it arrives (review finding 9), not only a region inserted
// already filled.
describe("EditorAstroDesignStatusBar", () => {
  const unconfirmed = {
    sectionId: "hero",
    tone: "unconfirmed",
    message: ASTRO_BASIS_UNCONFIRMED_MESSAGE,
    badge: "Reload preview",
    action: "reload-preview",
  } as const;

  it("is a mounted, empty polite status while nothing is said", () => {
    render(<EditorAstroDesignStatusBar notice={null} />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("data-astro-design-status-bar")).toBe("none");
    expect(status.textContent).toBe("");
  });

  it("says the hint, with its section, in the same mounted node, and empties it again", () => {
    const { rerender } = render(<EditorAstroDesignStatusBar notice={null} />);
    const before = screen.getByRole("status");

    rerender(<EditorAstroDesignStatusBar notice={unconfirmed} />);
    const status = screen.getByRole("status");
    expect(status).toBe(before);
    expect(status.getAttribute("data-astro-design-status-bar")).toBe(
      "unconfirmed",
    );
    expect(status.textContent).toContain(
      "This section can't be edited in Design right now.",
    );
    expect(status.textContent).toContain(ASTRO_BASIS_UNCONFIRMED_MESSAGE);
    expect(status.textContent).toContain("hero");

    rerender(<EditorAstroDesignStatusBar notice={null} />);
    expect(screen.getByRole("status")).toBe(before);
    expect(before.textContent).toBe("");
  });

  it("says it is checking while Core's view is read again", () => {
    render(
      <EditorAstroDesignStatusBar
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
    expect(status.getAttribute("data-astro-design-status-bar")).toBe(
      "checking",
    );
    expect(status.textContent).toContain(
      "Checking whether this section can be edited in Design…",
    );
    expect(status.textContent).toContain(ASTRO_SELECTION_RECHECKING_MESSAGE);
  });

  it("says the selection could not be restored when no section is left", () => {
    render(
      <EditorAstroDesignStatusBar
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
    expect(status.textContent).not.toContain("Section:");
  });
});

describe("EditorAstroDesignNotice", () => {
  it("says what is wrong and what to do when its basis is unconfirmed, without naming the section", () => {
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
    expect(status.textContent).toContain(
      "This section can't be edited in Design right now.",
    );
    expect(status.textContent).toContain(ASTRO_BASIS_UNCONFIRMED_MESSAGE);
    // The Inspector is already scoped to the selected section (dce31fa made
    // the wording plain), so the section id is not repeated here. The status
    // bar, which sits outside any section context, does name it.
    expect(status.textContent).not.toContain("hero");
    expect(status.textContent).not.toContain("Section:");
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
