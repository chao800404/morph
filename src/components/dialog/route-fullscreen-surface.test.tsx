import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RouteFullscreenSurface } from "./route-fullscreen-surface";

describe("RouteFullscreenSurface", () => {
  it("owns the shared viewport shell and close affordance", () => {
    const onClose = vi.fn();
    const { container } = render(
      <RouteFullscreenSurface onClose={onClose}>
        Preview
      </RouteFullscreenSurface>,
    );

    const shell = container.firstElementChild;
    expect(shell?.classList.contains("fixed")).toBe(true);
    expect(shell?.classList.contains("inset-0")).toBe(true);
    expect(shell?.classList.contains("p-2")).toBe(true);
    expect(screen.getByText("esc").getAttribute("data-slot")).toBe("kbd");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reserves separate rows for the header, body and footer", () => {
    const { container } = render(
      <RouteFullscreenSurface onClose={vi.fn()} footer={<p>Actions</p>}>
        Content
      </RouteFullscreenSurface>,
    );

    const surface = container.querySelector("section");
    const body = container.querySelector("main");

    expect(surface?.className).toContain("grid");
    expect(surface?.className).toContain(
      "grid-rows-[auto_minmax(0,1fr)_auto]",
    );
    expect(body?.className).toContain("min-h-0");
    expect(body?.className).toContain("overflow-hidden");
  });

  it("places leading header content beside the close controls", () => {
    render(
      <RouteFullscreenSurface
        onClose={vi.fn()}
        headerLeading={<nav aria-label="Steps">Steps</nav>}
      >
        Content
      </RouteFullscreenSurface>,
    );

    const closeButton = screen.getByRole("button", { name: "Close" });
    const steps = screen.getByRole("navigation", { name: "Steps" });
    const leadingRegion = closeButton.parentElement?.parentElement;

    expect(leadingRegion?.contains(steps)).toBe(true);
  });
});
