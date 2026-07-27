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
});
